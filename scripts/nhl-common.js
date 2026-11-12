/* ============================================================
   NHL — utilidades compartidas por build-nhl-priors y nhl-backtest:
   carga de temporadas, descanso, ajuste con offsets conocidos y
   medición de la dispersión (pesos por diferencia, puerta vacía,
   tiempo extra, 1er periodo). Solo scripts.
   ============================================================ */
const { loadGames } = require('./nhl-history');
const { fitRatings } = require('../lib/nhl/fit');
const { restCategory, cleanGoals } = require('../lib/nhl/core');
const { poisVec, MAXG } = require('../lib/nhl/engine');

/* juegos de varias temporadas, ordenados */
function seasons(years) {
  const out = [];
  for (const y of years) out.push(...loadGames(y));
  return out.sort((a, b) => new Date(a.date) - new Date(b.date) || a.id.localeCompare(b.id));
}

/* ¿Quién venía de jugar la noche anterior? id → { home, away } */
function restLookup(games) {
  const prev = {};
  const out = new Map();
  for (const g of games) {
    const h = g.home.abbr, a = g.away.abbr;
    out.set(g.id, { home: restCategory(prev[h], g.date).cat, away: restCategory(prev[a], g.date).cat });
    const t = new Date(g.date).getTime();
    for (const ab of [h, a]) { (prev[ab] = prev[ab] || []).push(t); if (prev[ab].length > 3) prev[ab].shift(); }
  }
  return out;
}

/* Ajuste con el offset conocido del descanso. */
function fitWith(games, { asOf, halfLife, params, REST, rest }) {
  const withAdj = games.map(g => {
    const rc = rest && REST ? rest.get(g.id) : null;
    if (!rc) return g;
    const bh = rc.home === 'b2b', ba = rc.away === 'b2b';
    return { ...g, adj: { home: (bh ? REST.b2b_att : 0) + (ba ? REST.b2b_def : 0), away: (ba ? REST.b2b_att : 0) + (bh ? REST.b2b_def : 0) } };
  });
  return fitRatings(withAdj, { asOf, halfLife, params });
}

/* Efecto del segundo juego en dos noches: log(goles reales / esperados)
   del equipo cansado (ataque) y de su rival (lo que concede), con el
   fit dado (sin REST), encogido con n/(n+300). */
function estimateRest(games, fit, rest) {
  const acc = { att: [0, 0, 0], def: [0, 0, 0] };
  for (const g of games) {
    const rh = fit.ratings[g.home.abbr], ra = fit.ratings[g.away.abbr];
    const rc = rest.get(g.id);
    if (!rh || !ra || !rc) continue;
    const hf = g.neutral ? 0 : fit.hfa / 2;
    const lh = Math.exp(fit.mu + hf + rh.att - ra.def), la = Math.exp(fit.mu - hf + ra.att - rh.def);
    const yh = cleanGoals(g.home, 1), ya = cleanGoals(g.away, 1);
    /* solo juegos donde UNO de los dos viene cansado: si los dos, se cancela */
    if (rc.home === 'b2b' && rc.away !== 'b2b') { acc.att[0] += yh; acc.att[1] += lh; acc.att[2]++; acc.def[0] += ya; acc.def[1] += la; acc.def[2]++; }
    if (rc.away === 'b2b' && rc.home !== 'b2b') { acc.att[0] += ya; acc.att[1] += la; acc.att[2]++; acc.def[0] += yh; acc.def[1] += lh; acc.def[2]++; }
  }
  const sh = a => (a[2] ? +(Math.log(a[0] / a[1]) * (a[2] / (a[2] + 300))).toFixed(4) : 0);
  return { REST: { b2b_att: sh(acc.att), b2b_def: sh(acc.def) }, detail: { n: acc.att[2], raw_att: acc.att[2] ? +Math.log(acc.att[0] / acc.att[1]).toFixed(4) : 0, raw_def: acc.def[2] ? +Math.log(acc.def[0] / acc.def[1]).toFixed(4) : 0 } };
}

/* Dispersión medida sobre predicciones walk-forward: rows = [{g, lh, la}].
   - MARGIN_W: frecuencia real de cada |diferencia sin puerta vacía|
     entre la que predice el Poisson independiente;
   - EN: P(+1), P(+2) goles a puerta vacía del líder por diferencia;
   - OT_HOME / OT_S: quién gana el tiempo extra (regresión por el origen
     del resultado sobre la ventaja del mejor equipo);
   - P1_SHARE: fracción de los goles limpios que cae en el 1er periodo. */
function measureDispersion(rows) {
  const pred = [0, 0, 0, 0], obs = [0, 0, 0, 0];
  const en = { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0], 4: [0, 0, 0] };
  let p1 = 0, lamSum = 0, n = 0;
  let otN = 0, otHome = 0, sxy = 0, sxx = 0;
  for (const { g, lh, la } of rows) {
    const ph = poisVec(lh, MAXG), pa = poisVec(la, MAXG);
    let pHreg = 0, pAreg = 0;
    for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) { const p = ph[i] * pa[j]; pred[Math.min(3, Math.abs(i - j))] += p; if (i > j) pHreg += p; else if (j > i) pAreg += p; }
    const ch = cleanGoals(g.home, 1), ca = cleanGoals(g.away, 1);
    const d = ch - ca;
    obs[Math.min(3, Math.abs(d))]++;
    if (d !== 0) { const lead = d > 0 ? g.home : g.away; const k = Math.min(4, Math.abs(d)); en[k][Math.min(2, lead.en || 0)]++; }
    p1 += g.home.p[0] + g.away.p[0]; lamSum += lh + la; n++;
    if (g.ot) {
      const hw = g.home.score > g.away.score ? 1 : 0;
      const x = pHreg / (pHreg + pAreg) - 0.5;
      otN++; otHome += hw; sxy += x * (hw - 0.5); sxx += x * x;
    }
  }
  const r = (v, k = 3) => +v.toFixed(k);
  const EN = {};
  for (const k in en) { const t = en[k][0] + en[k][1] + en[k][2]; EN[k] = t ? [r(en[k][1] / t), r(en[k][2] / t)] : [0, 0]; }
  return {
    MARGIN_W: pred.map((p, k) => r(obs[k] / p)),
    EN,
    OT_S: r(Math.max(0, sxy / sxx), 2),
    OT_HOME: r((otHome / otN - 0.5) * (otN / (otN + 400)), 3),
    P1_SHARE: r(p1 / lamSum, 4),
    n, n_ot: otN, ot_rate: r(otN / n), ot_home_raw: r(otHome / otN),
  };
}

module.exports = { seasons, restLookup, fitWith, estimateRest, measureDispersion };
