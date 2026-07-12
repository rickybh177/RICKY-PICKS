/* ============================================================
   NFL — momios reales y utilidades de probabilidad.

   Dos fuentes, en orden:
   1. The Odds API (si ODDS_API_KEY está en el entorno): consenso
      de varias casas US (mediana de línea y precio) para spread,
      total y moneyline.
   2. ESPN scoreboard (siempre disponible): spread + total + ML de
      referencia. Ya viene en el objeto del juego (data.js).

   El edge se calcula contra probabilidades SIN vig (devig).
   ============================================================ */
const { fetchJson } = require('./data');

const KEY = process.env.ODDS_API_KEY || '';

/* americano -> prob implícita (con vig) */
function amToProb(am) {
  const n = Number(am);
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
/* prob -> momio americano justo */
function probToAm(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p > 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}
/* quitar el vig a un par de probabilidades implícitas */
function devigPair(pA, pB) {
  if (pA == null || pB == null) return [pA, pB];
  const s = pA + pB;
  return s > 0 ? [pA / s, pB / s] : [pA, pB];
}
function median(arr) {
  const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* Consenso multi-casas de The Odds API para toda la semana.
   Regresa Map(clave "AWAY@HOME|iso-dia") -> {spread, total, ...} */
async function getOddsApiLines() {
  if (!KEY) return null;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds` +
      `?apiKey=${KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const events = await fetchJson(url, 15 * 60 * 1000);
    if (!Array.isArray(events)) return null;
    const out = new Map();
    for (const ev of events) {
      const spreads = [], totals = [], mlHome = [], mlAway = [];
      const spreadPriceH = [], spreadPriceA = [], totalOver = [], totalUnder = [];
      for (const bk of (ev.bookmakers || [])) {
        for (const mk of (bk.markets || [])) {
          const o = mk.outcomes || [];
          if (mk.key === 'spreads') {
            const h = o.find(x => x.name === ev.home_team), a = o.find(x => x.name === ev.away_team);
            if (h && h.point != null) { spreads.push(Number(h.point)); spreadPriceH.push(amToProb(h.price)); }
            if (a && a.price != null) spreadPriceA.push(amToProb(a.price));
          } else if (mk.key === 'totals') {
            const ov = o.find(x => x.name === 'Over'), un = o.find(x => x.name === 'Under');
            if (ov && ov.point != null) { totals.push(Number(ov.point)); totalOver.push(amToProb(ov.price)); }
            if (un && un.price != null) totalUnder.push(amToProb(un.price));
          } else if (mk.key === 'h2h') {
            const h = o.find(x => x.name === ev.home_team), a = o.find(x => x.name === ev.away_team);
            if (h) mlHome.push(amToProb(h.price));
            if (a) mlAway.push(amToProb(a.price));
          }
        }
      }
      out.set(ev.id, null); // no usamos el id de ellos para el match
      const key = `${ev.away_team}|${ev.home_team}|${(ev.commence_time || '').slice(0, 10)}`;
      out.set(key, {
        books: (ev.bookmakers || []).length,
        spread: median(spreads),               // línea del local
        spread_ph: median(spreadPriceH), spread_pa: median(spreadPriceA),
        total: median(totals),
        total_pov: median(totalOver), total_pun: median(totalUnder),
        ml_ph: median(mlHome), ml_pa: median(mlAway),
      });
    }
    return out;
  } catch (e) { return null; }
}

/* Junta el mejor mercado disponible para un juego:
   The Odds API (consenso) > ESPN scoreboard > null.
   `g` es el juego parseado de data.js; `oddsMap` viene de arriba. */
function marketFor(g, oddsMap, fullNames) {
  // 1) The Odds API — matchear por nombres completos + día
  if (oddsMap && fullNames) {
    const key = `${fullNames.away}|${fullNames.home}|${(g.date || '').slice(0, 10)}`;
    const m = oddsMap.get(key);
    if (m && (m.spread != null || m.total != null)) {
      const [mlH, mlA] = devigPair(m.ml_ph, m.ml_pa);
      const [spH, spA] = devigPair(m.spread_ph, m.spread_pa);
      const [tOv, tUn] = devigPair(m.total_pov, m.total_pun);
      return {
        source: 'consenso ' + m.books + ' casas',
        spread: m.spread, total: m.total,
        ml_home_prob: mlH, ml_away_prob: mlA,
        spread_home_prob: spH, spread_away_prob: spA,
        total_over_prob: tOv, total_under_prob: tUn,
      };
    }
  }
  // 2) ESPN scoreboard
  if (g.market && (g.market.spread != null || g.market.over_under != null)) {
    const [mlH, mlA] = devigPair(amToProb(g.market.home_ml), amToProb(g.market.away_ml));
    return {
      source: 'ESPN BET',
      spread: g.market.spread,          // línea del local (negativa si favorito)
      total: g.market.over_under,
      ml_home_prob: mlH, ml_away_prob: mlA,
      spread_home_prob: null, spread_away_prob: null, // -110 estándar
      total_over_prob: null, total_under_prob: null,
    };
  }
  return null;
}

module.exports = { getOddsApiLines, marketFor, amToProb, probToAm, devigPair, median };
