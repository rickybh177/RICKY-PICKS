/* ============================================================
   EUROPA (Premier, LaLiga, Bundesliga…) — capa de datos. Solo backend.
   Generaliza lib/mx/data.js por liga: cada función recibe el
   leagueId de lib/euro/leagues.js ('epl', 'laliga', 'bundesliga')
   y pega al código ESPN correspondiente (eng.1, esp.1, ger.1).
   - ESPN site API (gratis, sin key): calendario, resultados,
     forma (WLDDL) y momios DraftKings del scoreboard: moneyline
     de 3 vías, total de goles y spread (solo juegos por venir).
   - Summary por partido: tiros, tiros a puerta, córneres y
     posesión (mercado de córneres y ajuste por tiros del fit).
   Caché in-memory con TTL, mismo patrón que lib/mx/data.js.

   IDENTIDAD POR ID, NO POR ABREVIATURA. En Liga MX el equipo se
   identifica por abreviatura porque son 18 clubes fijos; en
   Europa suben y bajan 3 por año y ESPN cambia abreviaturas entre
   temporadas (Man City: "MCI" → "MNC") y las repite entre ligas
   ("MUN" = Bayern en ger.1 y Man United en eng.1). Por eso cada
   lado del evento trae `id` (id de equipo de ESPN como STRING) y
   ratings, priors, córneres y momios se indexan por ese id. La
   abreviatura queda solo para mostrar.

   4-ago-2026: site.api.espn.com regresa 403 a IPs de datacenter
   (Vercel) con UA no-navegador. El espejo site.web.api.espn.com
   sirve el mismo API sin bloquear: primario, y el clásico queda
   de respaldo en el último intento (mismo fix que lib/mx/data.js).
   ============================================================ */

const { LEAGUES } = require('./leagues');

const ESPN_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_FALLBACK_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.espn.com/',
};

/* Config de liga o error claro (evita pegarle a ESPN con un código vacío). */
function cfgOf(leagueId) {
  const cfg = LEAGUES[leagueId];
  if (!cfg) throw new Error(`Liga desconocida: ${leagueId}`);
  return cfg;
}
const espnUrl = (leagueId, pathAndQuery) => `${ESPN_BASE}/${cfgOf(leagueId).espn}/${pathAndQuery}`;

const _cache = new Map(); // url -> { at, ttl, value }

/* ttlMs = 0 → no se guarda (los summaries pesan cientos de KB y
   en los scripts se piden por miles; ahí se cachea solo lo parseado). */
async function fetchJson(url, ttlMs = 10 * 60 * 1000) {
  const hit = ttlMs > 0 ? _cache.get(url) : null;
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    // último intento: host clásico, por si el espejo fallara algún día
    const tryUrl = i === 2 && url.startsWith(ESPN_BASE) ? url.replace(ESPN_BASE, ESPN_FALLBACK_BASE) : url;
    try {
      const r = await fetch(tryUrl, { headers: BROWSER_HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${tryUrl}`);
      const j = await r.json();
      if (ttlMs > 0) _cache.set(url, { at: Date.now(), ttl: ttlMs, value: j });
      return j;
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---- momios ---- */
function amNum(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return 100;
  const n = Number(s.replace('+', ''));
  return isFinite(n) && n !== 0 ? n : null;
}
function lineNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/^[ou]/i, ''));
  return isFinite(n) ? n : null;
}
/* close si existe, si no open */
function pickSide(side) {
  if (!side) return { line: null, odds: null };
  const src = (side.close && (side.close.odds != null || side.close.line != null)) ? side.close : side.open;
  if (!src) return { line: null, odds: null };
  return { line: lineNum(src.line), odds: amNum(src.odds) };
}

function parseOdds(oddsArr) {
  const o = (oddsArr || []).find(x => x && (x.moneyline || x.total || x.drawOdds || x.overUnder != null));
  if (!o) return null;
  const mlH = o.moneyline && pickSide(o.moneyline.home);
  const mlA = o.moneyline && pickSide(o.moneyline.away);
  const over = o.total && pickSide(o.total.over);
  const under = o.total && pickSide(o.total.under);
  const spH = o.pointSpread && pickSide(o.pointSpread.home);
  const spA = o.pointSpread && pickSide(o.pointSpread.away);
  return {
    provider: (o.provider && o.provider.displayName) || (o.provider && o.provider.name) || 'sportsbook',
    ml_home: mlH ? mlH.odds : null,
    ml_away: mlA ? mlA.odds : null,
    ml_draw: o.drawOdds && o.drawOdds.moneyLine != null ? amNum(o.drawOdds.moneyLine) : null,
    total_line: (over && over.line != null) ? over.line : (o.overUnder != null ? Number(o.overUnder) : null),
    total_over_odds: over ? over.odds : null,
    total_under_odds: under ? under.odds : null,
    spread_line: spH ? spH.line : null,      // línea del LOCAL (p.ej. -0.5)
    spread_home_odds: spH ? spH.odds : null,
    spread_away_odds: spA ? spA.odds : null,
    details: o.details || null,
  };
}

/* ---- Un evento del scoreboard a nuestro formato ---- */
function parseEvent(ev) {
  const c = (ev.competitions || [])[0] || {};
  const comp = c.competitors || [];
  const homeC = comp.find(x => x.homeAway === 'home') || {};
  const awayC = comp.find(x => x.homeAway === 'away') || {};
  const side = x => ({
    id: x.team && x.team.id != null ? String(x.team.id) : null, // llave de TODO el modelo
    abbr: x.team ? x.team.abbreviation : null,                  // solo para mostrar
    name: x.team ? (x.team.shortDisplayName || x.team.name) : null,
    full: x.team ? x.team.displayName : null,
    form: x.form || '',                       // "WLDDL", más reciente primero
    record: (x.records && x.records[0] && x.records[0].summary) || '',
    score: x.score != null ? Number(x.score) : null,
  });
  const status = (ev.status && ev.status.type) || {};
  const season = ev.season || {};
  return {
    id: ev.id,
    date: ev.date,                           // ISO UTC
    seasonYear: season.year || null,         // 2026 = temporada 2026-27
    seasonSlug: season.slug || '',           // "2026-27-english-premier-league"
    venue: (c.venue && c.venue.fullName) || '',
    venueCity: (c.venue && c.venue.address && c.venue.address.city) || '',
    /* Sede neutral = sin localía. ESPN no marca neutralSite en las
       finales europeas (verificado 2024-25 y 2025-26), así que la
       fase 'final' de una copa cuenta como neutral; las ligas nunca
       traen ese slug. */
    neutral: !!c.neutralSite || season.slug === 'final',
    state: status.state || 'pre',            // pre | in | post
    completed: !!status.completed,
    detail: status.shortDetail || '',
    home: side(homeC),
    away: side(awayC),
    market: parseOdds(c.odds),
  };
}

/* Eventos de la liga en el rango [startISO, endISO] (fechas 'YYYY-MM-DD').
   limit=200: un mes de liga europea cabe de sobra (máx ~50 juegos). */
async function getRange(leagueId, startISO, endISO, ttlMs) {
  const a = startISO.replace(/-/g, ''), b = endISO.replace(/-/g, '');
  const past = new Date(endISO + 'T23:59:59Z') < new Date(Date.now() - 36 * 3600 * 1000);
  const ttl = ttlMs != null ? ttlMs : (past ? 24 * 3600 * 1000 : 5 * 60 * 1000);
  const j = await fetchJson(espnUrl(leagueId, `scoreboard?dates=${a}-${b}&limit=200`), ttl);
  return (j.events || []).map(parseEvent);
}

/* Rango largo en pedazos mensuales (los meses pasados quedan
   cacheados 24h; solo el mes en curso se refresca seguido). */
async function getRangeChunked(leagueId, startISO, endISO) {
  const chunks = [];
  let cur = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (cur <= end) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const to = monthEnd < end ? monthEnd : end;
    chunks.push([cur.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  const all = await Promise.all(chunks.map(([a, b]) => getRange(leagueId, a, b)));
  const seen = new Set(), out = [];
  for (const evs of all) for (const e of evs) {
    if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  out.sort((x, y) => new Date(x.date) - new Date(y.date));
  return out;
}

/* Resultados terminados de la temporada en curso (para que los
   ratings aprendan solos), desde seasonStart de la liga. */
async function getSeasonResults(leagueId) {
  const cfg = cfgOf(leagueId);
  const today = new Date();
  const endISO = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const evs = await getRangeChunked(leagueId, cfg.seasonStart, endISO);
  return evs.filter(g => g.completed && g.home.score != null && g.away.score != null);
}

/* Ventana visible: ayer a +9 días (una jornada completa, o dos con
   fecha entre semana).

   Si la liga está EN PAUSA (fecha FIFA, receso de invierno) y esa
   ventana no trae ningún partido por jugar, se extiende hasta
   encontrar la PRÓXIMA jornada y se muestra completa — misma
   lección de Liga MX del 4-ago-2026, cuando el tablero quedó vacío
   en la pausa de selecciones. */
const WINDOW_DAYS = 9;
const LOOKAHEAD_DAYS = 60;    // cubre pausas largas (fecha FIFA, receso)
const JORNADA_SPAN_DAYS = 5;  // una jornada abarca de viernes a lunes

async function getWindow(leagueId) {
  const now = Date.now();
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const from = day(now - 1 * 86400000);
  const to = day(now + WINDOW_DAYS * 86400000);
  const near = await getRange(leagueId, from, to, 5 * 60 * 1000);
  if (near.some(g => !g.completed)) return near;

  // pausa: traer la próxima jornada completa
  const ahead = await getRange(leagueId, to, day(now + LOOKAHEAD_DAYS * 86400000), 30 * 60 * 1000);
  const upcoming = ahead
    .filter(g => !g.completed)
    .sort((x, y) => new Date(x.date) - new Date(y.date));
  if (!upcoming.length) return near;
  const cutoff = new Date(upcoming[0].date).getTime() + JORNADA_SPAN_DAYS * 86400000;
  const nextJornada = upcoming.filter(g => new Date(g.date).getTime() <= cutoff);

  const seen = new Set(near.map(g => g.id));
  return [...near, ...nextJornada.filter(g => !seen.has(g.id))];
}

/* ---- estadísticas de un partido terminado (córneres, tiros) ---- */
function statNum(stats, name) {
  const s = (stats || []).find(x => x.name === name);
  if (!s) return null;
  const n = Number(s.displayValue);
  return isFinite(n) ? n : null;
}

/* Del JSON del summary a { home:{corners,shots,sot,possession}, away:{…} }
   o null si el boxscore no trae estadísticas (juego sin cubrir o en
   curso). Se exporta aparte para que scripts/euro-history.js decida
   qué cachear en disco (lo parseado, nunca el summary completo). */
function parseMatchStats(j) {
  const teams = (j && j.boxscore && j.boxscore.teams) || [];
  if (teams.length < 2) return null;
  const mk = t => ({
    id: t.team && t.team.id != null ? String(t.team.id) : null,
    abbr: (t.team && t.team.abbreviation) || null,
    corners: statNum(t.statistics, 'wonCorners'),
    shots: statNum(t.statistics, 'totalShots'),
    sot: statNum(t.statistics, 'shotsOnTarget'),
    possession: statNum(t.statistics, 'possessionPct'),
  });
  const bySide = {};
  for (const t of teams) {
    if (t.homeAway === 'home' || t.homeAway === 'away') bySide[t.homeAway] = mk(t);
  }
  // algunos summaries no traen homeAway en boxscore.teams: orden [away, home]
  const out = (bySide.home && bySide.away) ? bySide : { away: mk(teams[0]), home: mk(teams[1]), byOrder: true };
  // sin ninguna estadística útil (partido sin cubrir) → null
  const useful = s => s && (s.corners != null || s.shots != null || s.sot != null);
  return (useful(out.home) || useful(out.away)) ? out : null;
}

/* Caché de lo PARSEADO por partido (chico), no del summary crudo:
   en runtime se piden decenas por tablero y el JSON completo pesa
   cientos de KB. Los errores de red no se cachean (se reintenta en
   la siguiente llamada). */
const _statsCache = new Map(); // `${leagueId}:${eventId}` -> { at, ttl, value }
async function getMatchStats(leagueId, eventId) {
  const key = `${leagueId}:${eventId}`;
  const hit = _statsCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  try {
    const j = await fetchJson(espnUrl(leagueId, `summary?event=${eventId}`), 0);
    const stats = parseMatchStats(j);
    // sin stats puede ser un juego en curso: reintentar en 1h; con stats, 24h
    _statsCache.set(key, { at: Date.now(), ttl: stats ? 24 * 3600 * 1000 : 3600 * 1000, value: stats });
    return stats;
  } catch (e) { return null; }
}

module.exports = {
  fetchJson, parseEvent, parseMatchStats, getRange, getRangeChunked,
  getSeasonResults, getWindow, getMatchStats, BROWSER_HEADERS,
};
