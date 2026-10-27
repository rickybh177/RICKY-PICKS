/* ============================================================
   NBA — momios reales (The Odds API, FUENTE ÚNICA) y props por evento.

   Mercados de partido: consenso multi-casas (mediana) de h2h,
   spreads y totals del sport key `basketball_nba`, con la caché en
   dos niveles de lib/odds/theoddsapi.js (3 créditos por consulta,
   TTL 30 min, perezoso: solo al haber visitas). Sin key o sin
   cobertura, el juego queda SIN mercado y el modelo lo dice.

   Props de jugador: por evento y bajo demanda (6 créditos por juego:
   puntos, rebotes, asistencias, triples, PRA y doble-doble), con
   caché de 4h en el KV compartido (×8 si quedan pocos créditos) —
   mismo guardián que lib/nfl/odds.js.
   ============================================================ */
const { fetchSport, consensus, isPreGame, amToProb, probToAm, median, devigPair, kvGet, kvPut } = require('../odds/theoddsapi');
const { abbrFromFull } = require('./teams');

const KEY = process.env.ODDS_API_KEY || '';
const SPORT = 'basketball_nba';

/* Lista de consensos pre-juego con nuestras abbr. null = sin key / API caído. */
async function getNbaOdds() {
  const events = await fetchSport(SPORT, 'h2h,spreads,totals');
  if (!events) return null;
  return events.filter(isPreGame)
    .map(ev => ({ ...consensus(ev, false), event_id: ev.id, home: abbrFromFull(ev.home_team), away: abbrFromFull(ev.away_team) }))
    .filter(e => e.home && e.away);
}

/* El consenso de un juego (abbr + fecha ±30 h; los equipos juegan
   cada dos días, así que la ventana es más corta que en fútbol). */
function findNbaOdds(list, homeAbbr, awayAbbr, dateISO) {
  if (!list) return null;
  const t = new Date(dateISO).getTime();
  const c = list
    .filter(e => e.home === homeAbbr && e.away === awayAbbr && Math.abs(new Date(e.commence).getTime() - t) < 30 * 3600e3)
    .sort((x, y) => Math.abs(new Date(x.commence) - t) - Math.abs(new Date(y.commence) - t))[0];
  if (!c) return null;
  return {
    source: 'consenso ' + c.books + ' casas',
    odds_event_id: c.event_id,
    spread: c.rl_point,                 // línea del LOCAL
    total: c.total_line,
    ml_home_imp: amToProb(c.ml_home), ml_away_imp: amToProb(c.ml_away),
    spread_home_imp: amToProb(c.rl_home_odds), spread_away_imp: amToProb(c.rl_away_odds),
    total_over_imp: amToProb(c.total_over_odds), total_under_imp: amToProb(c.total_under_odds),
  };
}

/* ---- props de jugador por evento ---- */
const PROP_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists', 'player_double_double'];
const MARKET_KEY = { player_points: 'pts', player_rebounds: 'reb', player_assists: 'ast', player_threes: 'tpm', player_points_rebounds_assists: 'pra', player_double_double: 'dd' };
const PROPS_TTL_MS = 4 * 3600 * 1000;
const CREDIT_RESERVE = 2000;

function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/* Map nombreNormalizado → { pts:{line, over_imp, under_imp, books}, …, dd:{yes_imp, no_imp, books} } */
function parseProps(ev) {
  const acc = {};
  for (const bk of ev.bookmakers || []) {
    for (const mk of bk.markets || []) {
      const key = MARKET_KEY[mk.key];
      if (!key) continue;
      for (const o of mk.outcomes || []) {
        const name = normName(o.description);
        if (!name) continue;
        acc[name] = acc[name] || {};
        const m = (acc[name][key] = acc[name][key] || { lines: [], over: [], under: [], yes: [], no: [] });
        if (key === 'dd') { if (o.name === 'Yes') m.yes.push(amToProb(o.price)); else if (o.name === 'No') m.no.push(amToProb(o.price)); continue; }
        if (o.name === 'Over') { if (o.point != null) { m.lines.push(Number(o.point)); m.over.push({ point: Number(o.point), imp: amToProb(o.price) }); } }
        else if (o.name === 'Under' && o.point != null) m.under.push({ point: Number(o.point), imp: amToProb(o.price) });
      }
    }
  }
  const out = {};
  for (const name in acc) {
    out[name] = {};
    for (const key in acc[name]) {
      const m = acc[name][key];
      if (key === 'dd') { if (m.yes.length) out[name][key] = { yes_imp: median(m.yes), no_imp: m.no.length ? median(m.no) : null, books: m.yes.length }; continue; }
      if (!m.lines.length) continue;
      /* línea de consenso = la que MÁS casas ofrecen; precios solo entre
         casas en ESA línea (lección de los totales de fútbol) */
      const cnt = new Map();
      for (const p of m.lines) cnt.set(p, (cnt.get(p) || 0) + 1);
      const med = median(m.lines);
      const line = [...cnt.entries()].sort((x, y) => y[1] - x[1] || Math.abs(x[0] - med) - Math.abs(y[0] - med))[0][0];
      out[name][key] = {
        line,
        over_imp: median(m.over.filter(x => x.point === line).map(x => x.imp)),
        under_imp: median(m.under.filter(x => x.point === line).map(x => x.imp)),
        books: cnt.get(line),
      };
    }
  }
  return out;
}

async function getEventProps(oddsEventId) {
  if (!KEY || !oddsEventId) return null;
  const cacheKey = `nba-props-${oddsEventId}`;
  const hit = await kvGet(cacheKey);
  const ttlOf = e => (e && e.remaining != null && e.remaining < CREDIT_RESERVE ? PROPS_TTL_MS * 8 : PROPS_TTL_MS);
  if (hit && hit.at && Date.now() - hit.at < ttlOf(hit)) return hit.value;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${oddsEventId}/odds` +
      `?apiKey=${KEY}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const remaining = Number(r.headers.get('x-requests-remaining'));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ev = await r.json();
    const value = { books: (ev.bookmakers || []).length, players: parseProps(ev) };
    await kvPut(cacheKey, { at: Date.now(), remaining: Number.isFinite(remaining) ? remaining : null, value });
    return value;
  } catch (e) {
    console.error('nba props odds', oddsEventId, e.message);
    return hit ? hit.value : null;
  }
}

module.exports = { getNbaOdds, findNbaOdds, getEventProps, parseProps, normName, amToProb, probToAm, devigPair, median, PROP_MARKETS };
