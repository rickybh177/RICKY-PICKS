/* ============================================================
   MLB — momios reales del mercado (DraftKings vía ESPN, gratis).
   El modelo compara sus probabilidades contra la línea REAL:
   el veredicto pasa de "probabilidad alta" a "valor vs mercado".
   Solo backend.
   ============================================================ */
const { fetchJson } = require('./statsapi');

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';

/* ESPN usa algunas abreviaturas distintas a MLB StatsAPI. */
const ABBR_FIX = { CHW: 'CWS', ARI: 'AZ', OAK: 'ATH' };
const fixAbbr = a => ABBR_FIX[a] || a;

function amToProb(am) {
  const n = Number(String(am).replace('+', ''));
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
function devigPair(pA, pB) {
  if (pA == null || pB == null) return [pA, pB];
  const s = pA + pB;
  return s > 0 ? [pA / s, pB / s] : [pA, pB];
}

const { getMlbOdds } = require('../odds/theoddsapi');

/* Mapa de mercado del día: [{home, away, date, total, mlHome, mlAway}].
   Fuente preferente: consenso multi-casas (The Odds API, mercado
   europeo — el mismo pool de líneas que las casas mexicanas).
   Respaldo: DraftKings vía ESPN. */
async function getMarketMap(dateISO) {
  // 1) consenso multi-casas (si hay ODDS_API_KEY)
  try {
    const cons = await getMlbOdds();
    if (cons && cons.length) {
      // solo los juegos de la fecha pedida (±1 día por husos horarios)
      const t0 = new Date(dateISO + 'T00:00:00-05:00').getTime();
      const dayGames = cons.filter(m => {
        const t = new Date(m.date).getTime();
        return t > t0 - 12 * 3600e3 && t < t0 + 36 * 3600e3;
      });
      if (dayGames.length) return dayGames;
    }
  } catch (e) { /* cae al respaldo */ }

  // 2) respaldo: DraftKings vía ESPN
  try {
    const ymd = dateISO.replace(/-/g, '');
    const j = await fetchJson(`${ESPN}?dates=${ymd}`, 10 * 60 * 1000);
    const out = [];
    for (const ev of (j.events || [])) {
      const c = (ev.competitions || [])[0] || {};
      const h = (c.competitors || []).find(x => x.homeAway === 'home');
      const a = (c.competitors || []).find(x => x.homeAway === 'away');
      const o = (c.odds && c.odds[0]) || null;
      if (!h || !a || !o) continue;
      const mlH = o.moneyline && o.moneyline.home && o.moneyline.home.close && o.moneyline.home.close.odds;
      const mlA = o.moneyline && o.moneyline.away && o.moneyline.away.close && o.moneyline.away.close.odds;
      const [pH, pA] = devigPair(amToProb(mlH), amToProb(mlA));
      out.push({
        home: fixAbbr(h.team.abbreviation),
        away: fixAbbr(a.team.abbreviation),
        date: ev.date,
        total: o.overUnder != null ? Number(o.overUnder) : null,
        ml_home: mlH != null ? Number(String(mlH).replace('+', '')) : null,
        ml_away: mlA != null ? Number(String(mlA).replace('+', '')) : null,
        ml_home_prob: pH, ml_away_prob: pA,     // sin vig
        provider: (o.provider && o.provider.name) || 'ESPN',
      });
    }
    return out;
  } catch (e) { return []; }
}

/* Encuentra el mercado de un juego (maneja doble cartelera por hora). */
function findMarket(map, awayAbbr, homeAbbr, gameDateISO) {
  const cands = map.filter(m => m.home === homeAbbr && m.away === awayAbbr);
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  const t = new Date(gameDateISO).getTime();
  return cands.sort((x, y) =>
    Math.abs(new Date(x.date) - t) - Math.abs(new Date(y.date) - t))[0];
}

module.exports = { getMarketMap, findMarket, amToProb, devigPair };
