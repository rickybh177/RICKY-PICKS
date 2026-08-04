/* ============================================================
   MLB — momios reales del mercado.
   FUENTE ÚNICA (decisión del dueño 4-ago-2026): consenso
   multi-casas de The Odds API. Sin key o sin cobertura, el juego
   queda sin mercado y los veredictos se topan en MAYBE — no se
   rellena con momios de referencia que no se pueden apostar.
   Solo backend.
   ============================================================ */

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

/* Mapa de mercado del día: [{home, away, date, total, ml_home,
   ml_away, ml_home_prob, ml_away_prob, provider}].
   SOLO consenso multi-casas (The Odds API). */
async function getMarketMap(dateISO) {
  try {
    const cons = await getMlbOdds();
    if (!cons || !cons.length) return [];
    // solo los juegos de la fecha pedida (±1 día por husos horarios)
    const t0 = new Date(dateISO + 'T00:00:00-05:00').getTime();
    return cons.filter(m => {
      const t = new Date(m.date).getTime();
      return t > t0 - 12 * 3600e3 && t < t0 + 36 * 3600e3;
    });
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
