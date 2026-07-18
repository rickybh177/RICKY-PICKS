/* ============================================================
   LIGA MX — capa de datos. Solo backend.
   - ESPN site API (gratis, sin key): calendario, resultados,
     forma (WLDDL) y momios DraftKings del scoreboard: moneyline
     de 3 vías (local/empate/visita), total de goles y spread.
   - Summary por partido: tiros, tiros a puerta y córneres (para
     el mercado de córneres).
   Caché in-memory con TTL, mismo patrón que lib/nfl/data.js.
   ============================================================ */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1';

const _cache = new Map(); // url -> { at, ttl, value }

async function fetchJson(url, ttlMs = 10 * 60 * 1000) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ricky-picks/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
      const j = await r.json();
      _cache.set(url, { at: Date.now(), ttl: ttlMs, value: j });
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
    provider: (o.provider && o.provider.displayName) || 'sportsbook',
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
    espnId: x.team ? x.team.id : null,
    abbr: x.team ? x.team.abbreviation : null,
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
    seasonYear: season.year || null,
    seasonSlug: season.slug || '',           // "torneo-apertura", "torneo-clausura", liguilla…
    venue: (c.venue && c.venue.fullName) || '',
    venueCity: (c.venue && c.venue.address && c.venue.address.city) || '',
    state: status.state || 'pre',            // pre | in | post
    completed: !!status.completed,
    detail: status.shortDetail || '',
    home: side(homeC),
    away: side(awayC),
    market: parseOdds(c.odds),
  };
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/* Eventos en el rango [startISO, endISO] (fechas 'YYYY-MM-DD'). */
async function getRange(startISO, endISO, ttlMs) {
  const a = startISO.replace(/-/g, ''), b = endISO.replace(/-/g, '');
  const past = new Date(endISO + 'T23:59:59Z') < new Date(Date.now() - 36 * 3600 * 1000);
  const ttl = ttlMs != null ? ttlMs : (past ? 24 * 3600 * 1000 : 5 * 60 * 1000);
  const j = await fetchJson(`${ESPN}/scoreboard?dates=${a}-${b}`, ttl);
  return (j.events || []).map(parseEvent);
}

/* Rango largo en pedazos mensuales (los meses pasados quedan
   cacheados 24h; solo el mes en curso se refresca seguido). */
async function getRangeChunked(startISO, endISO) {
  const chunks = [];
  let cur = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (cur <= end) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const to = monthEnd < end ? monthEnd : end;
    chunks.push([cur.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  const all = await Promise.all(chunks.map(([a, b]) => getRange(a, b)));
  const seen = new Set(), out = [];
  for (const evs of all) for (const e of evs) {
    if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  out.sort((x, y) => new Date(x.date) - new Date(y.date));
  return out;
}

/* Resultados terminados del torneo en curso (para que los
   ratings aprendan solos), desde el arranque del Apertura 2026. */
const SEASON_START = '2026-07-15';
async function getSeasonResults() {
  const today = new Date();
  const endISO = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const evs = await getRangeChunked(SEASON_START, endISO);
  return evs.filter(g => g.completed && g.home.score != null && g.away.score != null);
}

/* Ventana visible: ayer a +9 días (una jornada completa o dos
   con doble fecha entre semana). */
async function getWindow() {
  const now = Date.now();
  const a = new Date(now - 1 * 86400000).toISOString().slice(0, 10);
  const b = new Date(now + 9 * 86400000).toISOString().slice(0, 10);
  return getRange(a, b, 5 * 60 * 1000);
}

/* ---- estadísticas de un partido terminado (córneres, tiros) ---- */
function statNum(stats, name) {
  const s = (stats || []).find(x => x.name === name);
  if (!s) return null;
  const n = Number(s.displayValue);
  return isFinite(n) ? n : null;
}
async function getMatchStats(eventId) {
  try {
    const j = await fetchJson(`${ESPN}/summary?event=${eventId}`, 24 * 3600 * 1000);
    const teams = (j.boxscore && j.boxscore.teams) || [];
    if (teams.length < 2) return null;
    const bySide = {};
    for (const t of teams) {
      const key = t.homeAway === 'home' ? 'home' : t.homeAway === 'away' ? 'away' : null;
      const val = {
        corners: statNum(t.statistics, 'wonCorners'),
        shots: statNum(t.statistics, 'totalShots'),
        sot: statNum(t.statistics, 'shotsOnTarget'),
        possession: statNum(t.statistics, 'possessionPct'),
      };
      if (key) bySide[key] = val;
    }
    // algunos summaries no traen homeAway en boxscore.teams: orden [away, home]
    if (!bySide.home || !bySide.away) {
      const mk = t => ({
        corners: statNum(t.statistics, 'wonCorners'),
        shots: statNum(t.statistics, 'totalShots'),
        sot: statNum(t.statistics, 'shotsOnTarget'),
        possession: statNum(t.statistics, 'possessionPct'),
        abbr: t.team && t.team.abbreviation,
      });
      return { away: mk(teams[0]), home: mk(teams[1]), byOrder: true };
    }
    return bySide;
  } catch (e) { return null; }
}

module.exports = {
  fetchJson, parseEvent, getRange, getRangeChunked,
  getSeasonResults, getWindow, getMatchStats, SEASON_START,
};
