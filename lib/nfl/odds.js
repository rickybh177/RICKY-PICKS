/* ============================================================
   NFL — momios reales y utilidades de probabilidad.

   FUENTE ÚNICA (decisión del dueño 4-ago-2026): The Odds API —
   consenso de varias casas US (mediana de línea y precio) para
   spread, total y moneyline. La pretemporada vive en un sport
   key aparte (americanfootball_nfl_preseason). Sin key o sin
   cobertura, el juego queda SIN mercado y el modelo lo dice
   ("aún sin momios", tope MAYBE) — no se rellena con momios de
   referencia que no se pueden apostar.

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

/* Consenso multi-casas de The Odds API.
   seasontype 1 = pretemporada (sport key propio); 2 = regular.
   Regresa Map(clave "AWAY|HOME|iso-dia") -> {spread, total, ...} */
async function getOddsApiLines(seasontype) {
  if (!KEY) return null;
  const sportKey = Number(seasontype) === 1
    ? 'americanfootball_nfl_preseason'
    : 'americanfootball_nfl';
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
      `?apiKey=${KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    // Plan gratis de The Odds API: 500 créditos/mes compartidos con Liga
    // MX y MLB. Caché de 6h para no agotarlo (ver lib/odds/theoddsapi.js).
    const events = await fetchJson(url, 6 * 3600 * 1000);
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

/* Mercado de un juego: SOLO The Odds API (matcheo por nombres
   completos + día). Devuelve probabilidades implícitas CRUDAS
   (con vig): el precio real que pagarías. El devig (prob "limpia"
   del mercado) se hace en model.js, porque el EV necesita ambas.
   Sin match → null: el juego se muestra sin momios, sin inventar. */
function marketFor(g, oddsMap, fullNames) {
  if (!oddsMap || !fullNames) return null;
  const key = `${fullNames.away}|${fullNames.home}|${(g.date || '').slice(0, 10)}`;
  const m = oddsMap.get(key);
  if (m && (m.spread != null || m.total != null || m.ml_ph != null)) {
    return {
      source: 'consenso ' + m.books + ' casas',
      spread: m.spread, total: m.total,
      ml_home_imp: m.ml_ph, ml_away_imp: m.ml_pa,
      spread_home_imp: m.spread_ph, spread_away_imp: m.spread_pa,
      total_over_imp: m.total_pov, total_under_imp: m.total_pun,
    };
  }
  return null;
}

module.exports = { getOddsApiLines, marketFor, amToProb, probToAm, devigPair, median };
