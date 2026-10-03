// Pronos Lab : serveur local. Sert l'appli et relaie API-Football en gardant la clé secrète.
// Lancer : API_KEY=votre_clé node server.js   puis ouvrir http://localhost:3000   (Node 18+)
const http = require("http"), fs = require("fs"), path = require("path");
const KEY = process.env.API_KEY, PORT = process.env.PORT || 3000, BASE = "https://v3.football.api-sports.io";
const GAP = 6500;                                   // 10 requêtes/minute maximum (plan gratuit)
const TTL = { fixtures: 48 * 36e5, odds: 3 * 36e5 };  // durée de cache : 48 h, cotes 3 h
const FILE = path.join(__dirname, "cache.json"), ALLOWED = /^\/(fixtures|odds)(\?|$)/;
let cache = {}; try { cache = JSON.parse(fs.readFileSync(FILE)); } catch {}
let remaining = 100, chain = Promise.resolve(), last = 0, aiDay = "", aiCount = 0;

function fetchApi(p) {                              // file d'attente : une requête toutes les 6,5 s
  const job = chain.then(async () => {
    const w = last + GAP - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w));
    last = Date.now();
    const r = await fetch(BASE + p, { headers: { "x-apisports-key": KEY } });
    const q = r.headers.get("x-ratelimit-requests-remaining"); if (q !== null) remaining = +q;
    return { status: r.status, body: await r.text() };
  });
  chain = job.catch(() => {}); return job;
}

http.createServer(async (req, res) => {
  if (req.url === "/ai" && req.method === "POST") {  // filtre/analyse par prompts via l'API Anthropic (clé et code sur le serveur)
    const send = (s, o) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const AK = process.env.ANTHROPIC_API_KEY, CODE = process.env.APP_CODE;
    if (!AK || !CODE) return send(503, { error: "IA désactivée : ANTHROPIC_API_KEY et APP_CODE manquants sur le serveur." });
    let raw = ""; for await (const ch of req) { raw += ch; if (raw.length > 200000) return send(413, { error: "Requête trop grande." }); }
    let b; try { b = JSON.parse(raw); } catch { return send(400, { error: "JSON invalide." }); }
    if (b.code !== CODE) return send(401, { error: "Code d'accès incorrect." });
    const day = new Date().toISOString().slice(0, 10); if (aiDay !== day) { aiDay = day; aiCount = 0; }
    if (aiCount >= (+process.env.AI_MAX_PER_DAY || 60)) return send(429, { error: "Limite quotidienne d'appels IA atteinte." });
    const prompt = String(b.prompt || "").slice(0, 6000), ms = (b.matches || []).slice(0, 30);
    if (!prompt.trim() || !ms.length) return send(400, { error: "Prompt ou matchs manquants." });
    const f = b.type === "f";
    const system = "Tu es un analyste football. Tu appliques UNIQUEMENT le prompt de l'utilisateur aux données fournies. N'invente aucune statistique ni information absente des données : si une donnée manque pour décider, dis-le. Les moyennes sont calculées sur les derniers matchs de chaque équipe. Réponds uniquement par un tableau JSON valide, sans texte autour.";
    const format = f ? 'Pour CHAQUE match, renvoie {"id":<id>,"keep":true|false,"why":"raison en 25 mots maximum"}.' : 'Pour CHAQUE match, renvoie {"id":<id>,"analyse":"analyse en 60 mots maximum"}.';
    const content = `Marché : ${b.market}\n\nPrompt de l'utilisateur :\n${prompt}\n\nMatchs (JSON) :\n${JSON.stringify(ms)}\n\n${format}`;
    try {
      aiCount++;
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AK, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 2000, system, messages: [{ role: "user", content }] }) });
      const j = await r.json();
      if (!r.ok) return send(502, { error: (j.error && j.error.message) || "Erreur API Anthropic " + r.status });
      const m = (j.content || []).map(x => x.text || "").join("").match(/\[[\s\S]*\]/);
      return send(200, { results: m ? JSON.parse(m[0]) : [] });
    } catch (e) { return send(502, { error: String(e) }); }
  }
  if (req.url.startsWith("/csv/")) {                 // données gratuites football-data.co.uk (sans clé), cache 6 h
    const p = req.url.slice(4);
    if (!/^\/(fixtures\.csv|mmz4281\/\d{4}\/(E0|E1|E2|E3|EC|SC0|SC1|SC2|SC3|SP1|SP2|F1|F2|D1|D2|I1|I2|N1|P1|B1|T1|G1)\.csv)$/.test(p)) { res.writeHead(403); return res.end(); }
    const c = cache["csv:" + p], H = { "Content-Type": "text/csv; charset=utf-8" };
    if (c && Date.now() - c.t < 6 * 36e5) { res.writeHead(200, H); return res.end(c.b); }
    try {
      const r = await fetch("https://www.football-data.co.uk" + p); if (!r.ok) throw new Error("HTTP " + r.status);
      const b = new TextDecoder("latin1").decode(await r.arrayBuffer());
      cache["csv:" + p] = { t: Date.now(), b }; fs.writeFile(FILE, JSON.stringify(cache), () => {});
      res.writeHead(200, H); return res.end(b);
    } catch (e) { res.writeHead(502); return res.end(String(e)); }
  }
  if (req.url.startsWith("/api/")) {
    const p = req.url.slice(4), send = (s, b) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(b); };
    if (!KEY) return send(500, JSON.stringify({ errors: { cle: "API_KEY manquante côté serveur" } }));
    if (!ALLOWED.test(p)) return send(403, "{}");
    const c = cache[p], ttl = p.startsWith("/odds") ? TTL.odds : TTL.fixtures;
    if (c && Date.now() - c.t < ttl) return send(200, c.b);
    if (remaining <= 3) return send(429, JSON.stringify({ errors: { quota: "Quota quotidien presque épuisé" } }));
    try {
      const r = await fetchApi(p);
      if (r.status === 200 && !/"errors":\s*\{\s*"/.test(r.body)) { cache[p] = { t: Date.now(), b: r.body }; fs.writeFile(FILE, JSON.stringify(cache), () => {}); }
      send(r.status, r.body);
    } catch (e) { send(502, JSON.stringify({ errors: { reseau: String(e) } })); }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(__dirname, "index.html")));
}).listen(PORT, () => console.log("Pronos Lab : http://localhost:" + PORT));
