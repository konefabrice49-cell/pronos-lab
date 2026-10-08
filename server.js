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

// Logos des équipes : écussons de football-data.org (clé gratuite FD_TOKEN), chargés en arrière-plan puis gardés 30 jours
const LOGO_COMPS = ["PL", "PD", "BL1", "SA", "FL1", "CL", "DED", "PPL"];
let logosBusy = false;
async function loadLogosBg() {
  logosBusy = true; const out = [];
  try {
    for (const k of LOGO_COMPS) {
      try {
        const r = await fetch("https://api.football-data.org/v4/competitions/" + k + "/teams", { headers: { "X-Auth-Token": process.env.FD_TOKEN } });
        if (r.ok) { const j = await r.json(); for (const t of j.teams || []) out.push({ n: t.name, s: t.shortName, t: t.tla, c: t.crest }); }
      } catch {}
      await new Promise(r => setTimeout(r, +process.env.LOGO_GAP_MS || 6500));   // 10 requêtes/minute maximum
    }
    cache.logos = out.length ? { t: Date.now(), v: out } : { t: Date.now(), fail: true };
    fs.writeFile(FILE, JSON.stringify(cache), () => {});
  } finally { logosBusy = false; }
}
function logosRoute(res) {
  const send = (s, o) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (!process.env.FD_TOKEN) return send(503, { error: "FD_TOKEN manquant côté serveur" });
  const c = cache.logos;
  if (c && !c.fail && Date.now() - c.t < 30 * 864e5) return send(200, c.v);
  if (c && c.fail && Date.now() - c.t < 6e5) return send(502, { error: "Échec du chargement des logos, nouvel essai dans 10 minutes" });
  if (!logosBusy) loadLogosBg();
  return send(202, { pending: true });
}

// Scores en direct : flux public de ESPN (non officiel, sans clé), uniquement pour les championnats de l'appli, cache 45 s
const ESPN = { "eng.1": "Premier League", "esp.1": "La Liga", "fra.1": "Ligue 1", "ger.1": "Bundesliga", "ita.1": "Serie A", "uefa.champions": "Ligue des champions", "uefa.europa": "Europa League",
  "ned.1": "Eredivisie", "por.1": "Primeira Liga", "bel.1": "Pro League belge", "sco.1": "Premiership écossaise", "tur.1": "Süper Lig", "gre.1": "Super League grecque" };
let liveCache = { t: 0, v: [] };
async function liveRoute(res) {
  const send = (s, o) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (Date.now() - liveCache.t < 45e3) return send(200, liveCache.v);
  const out = [], slugs = Object.keys(ESPN);
  for (let i = 0; i < slugs.length; i += 6) {
    await Promise.all(slugs.slice(i, i + 6).map(async sl => {
      try {
        // d'abord la période hier → +4 jours (calendrier complet), sinon le tableau par défaut d'ESPN
        const base = "https://site.api.espn.com/apis/site/v2/sports/soccer/" + sl + "/scoreboard", fd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
        let j = null;
        for (const u of [base + "?dates=" + fd(Date.now() - 864e5) + "-" + fd(Date.now() + 4 * 864e5) + "&limit=200", base]) {
          try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) continue; const x = await r.json(); if ((x.events || []).length) { j = x; break; } } catch {}
        }
        if (!j) return;
        for (const e of j.events || []) {
          const c = (e.competitions || [])[0]; if (!c) continue;
          const H = (c.competitors || []).find(x => x.homeAway === "home"), A = (c.competitors || []).find(x => x.homeAway === "away"); if (!H || !A) continue;
          const st = c.status || e.status || {}, ty = st.type || {};
          const ev = (c.details || []).filter(d => d && (d.scoringPlay || d.yellowCard || d.redCard)).sort((x, y) => ((x.clock || {}).value || 0) - ((y.clock || {}).value || 0)).map(d => ({
            s: String((d.team || {}).id) === String(H.team.id) ? "h" : "a", m: (d.clock || {}).displayValue || "", n: ((d.athletesInvolved || [])[0] || {}).shortName || ((d.athletesInvolved || [])[0] || {}).displayName || "",
            g: !!d.scoringPlay, y: !!d.yellowCard, r: !!d.redCard, p: !!d.penaltyKick, o: !!d.ownGoal }));
          out.push({ comp: ESPN[sl], home: H.team.displayName, away: A.team.displayName, hl: H.team.logo, al: A.team.logo, date: e.date, state: ty.state, name: ty.name, clock: st.displayClock, hs: +H.score || 0, as: +A.score || 0, ev, id: e.id, lg: sl, hid: H.team.id, aid: A.team.id });
        }
      } catch {}
    }));
  }
  liveCache = { t: Date.now(), v: out };
  send(200, out);
}

// Détail d'un match (chronologie : buts, passes, cartons, remplacements ; statistiques), cache 30 s
const mcache = {};
async function matchRoute(req, res) {
  const send = (s, o) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, "http://x"), sl = u.searchParams.get("league"), ev = u.searchParams.get("event"), hid = u.searchParams.get("h");
  if (!ESPN[sl] || !/^\d{4,12}$/.test(ev || "")) return send(400, { error: "Paramètres invalides" });
  const key = sl + ev; if (mcache[key] && Date.now() - mcache[key].t < 30e3) return send(200, mcache[key].v);
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/" + sl + "/summary?event=" + ev, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return send(502, { error: "ESPN a répondu " + r.status });
    const j = await r.json(), side = t => String((t || {}).id) === String(hid) ? "h" : "a";
    const events = (j.keyEvents || []).map(e => {
      const ty = ((e.type || {}).text || "").toLowerCase(), tx = e.text || e.shortText || "", P = (e.participants || []).map(p => (p.athlete || {}).displayName).filter(Boolean);
      let k = null;
      if (/half ?time/.test(ty)) k = "ht"; else if (/full time|end regular time|end of match/.test(ty)) k = "ft";
      else if (/own goal/.test(ty)) k = "og"; else if (/penalty - scored|^goal|goal -|^goal$/.test(ty) || (e.scoringPlay && !/miss|disallow/.test(ty))) k = "g";
      else if (/second yellow|red card/.test(ty)) k = "r"; else if (/yellow/.test(ty)) k = "y"; else if (/substitution/.test(ty)) k = "sub"; else return null;
      const o = { s: side(e.team), k, m: (e.clock || {}).displayValue || "", t: (e.clock || {}).value || 0, n: P[0] || "", p: /penalty/.test(ty) };
      if (k === "g" || k === "og") { const a = /Assisted by ([^.]+?)(?: with | following |\.|$)/i.exec(tx); if (a) o.a = a[1].trim(); }
      if (k === "sub") { const m2 = /([^.]+?) replaces ([^.]+?)(?: because.*|\.)?$/i.exec(tx.replace(/^Substitution,[^.]*\.\s*/i, "")); o.on = m2 ? m2[1].trim() : P[0] || ""; o.off = m2 ? m2[2].trim() : P[1] || ""; }
      return o;
    }).filter(Boolean).sort((a, b) => a.t - b.t);
    const stats = ((j.boxscore || {}).teams || []).map(t => ({ s: side(t.team), st: (t.statistics || []).map(x => ({ n: x.name, l: x.label, v: x.displayValue })) }));
    const out = { events, stats }; mcache[key] = { t: Date.now(), v: out }; send(200, out);
  } catch (e) { send(502, { error: "Réponse illisible" }); }
}

http.createServer(async (req, res) => {
  if (req.url === "/logos") return logosRoute(res);
  if (req.url === "/live") return liveRoute(res);
  if (req.url.startsWith("/match?")) return matchRoute(req, res);
  if (req.url.startsWith("/csv/")) {                 // données gratuites football-data.co.uk (sans clé), cache 6 h
    const p = req.url.slice(4);
    if (!/^\/(fixtures\.csv|mmz4281\/\d{4}\/(E0|SC0|SP1|F1|D1|I1|N1|P1|B1|T1|G1)\.csv)$/.test(p)) { res.writeHead(403); return res.end(); }
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
