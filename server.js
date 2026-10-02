// Pronos Lab : serveur local. Sert l'appli et relaie API-Football en gardant la clé secrète.
// Lancer : API_KEY=votre_clé node server.js   puis ouvrir http://localhost:3000   (Node 18+)
const http = require("http"), fs = require("fs"), path = require("path");
const KEY = process.env.API_KEY, PORT = process.env.PORT || 3000, BASE = "https://v3.football.api-sports.io";
const GAP = 6500;                                   // 10 requêtes/minute maximum (plan gratuit)
const TTL = { fixtures: 48 * 36e5, odds: 3 * 36e5 };  // durée de cache : 48 h, cotes 3 h
const FILE = path.join(__dirname, "cache.json"), ALLOWED = /^\/(fixtures|odds)(\?|$)/;
let cache = {}; try { cache = JSON.parse(fs.readFileSync(FILE)); } catch {}
let remaining = 100, chain = Promise.resolve(), last = 0;

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
