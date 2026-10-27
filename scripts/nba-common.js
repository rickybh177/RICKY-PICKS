/* ============================================================
   NBA — utilidades compartidas por build-nba-priors y nba-backtest:
   carga de temporadas, ausencias históricas (del boxscore: quién de
   la rotación no jugó), ajuste con offsets conocidos (descanso y
   ausencias) y medición de dispersiones. Solo scripts.
   ============================================================ */
const { loadGames } = require('./nba-history');
const { fitRatings } = require('../lib/nba/fit');
const { loadHistory, buildIndex, absencesInGame } = require('../lib/nba/players');
const { restCategory, restPts } = require('../lib/nba/core');
const { TEAMS } = require('../lib/nba/teams');

const ALT_TEAMS = new Set(Object.keys(TEAMS).filter(ab => TEAMS[ab].altM > 1200));

/* juegos de varias temporadas, ordenados */
function seasons(years) {
  const out = [];
  for (const y of years) out.push(...loadGames(y));
  return out.sort((a, b) => new Date(a.date) - new Date(b.date) || a.id.localeCompare(b.id));
}

/* Ausencias históricas de cada equipo-juego, calculadas una vez.
   Regresa (g, side) → valor (Game Score sobre reemplazo de los
   ausentes de la rotación). */
function absenceLookup(years) {
  const idx = buildIndex(loadHistory({ years }));
  const cache = new Map();
  const fn = (g, side) => {
    const team = g[side].abbr;
    const k = team + '|' + g.id;
    if (!cache.has(k)) cache.set(k, absencesInGame(idx, team, g.id).value);
    return cache.get(k);
  };
  fn.idx = idx;
  return fn;
}

/* Categorías de descanso de cada equipo-juego (orden cronológico). */
function restLookup(games) {
  const prev = {};
  const out = new Map(); // id -> { home: cat, away: cat }
  for (const g of games) {
    const h = g.home.abbr, a = g.away.abbr;
    out.set(g.id, { home: restCategory(prev[h], g.date).cat, away: restCategory(prev[a], g.date).cat });
    const t = new Date(g.date).getTime();
    for (const ab of [h, a]) { (prev[ab] = prev[ab] || []).push(t); if (prev[ab].length > 3) prev[ab].shift(); }
  }
  return out;
}

/* Ajuste con offsets conocidos: descanso (REST) y ausencias (ABS_C). */
function fitWith(games, { asOf, REST, ABS_C = 0, absences, rest, halfLife }) {
  const withAdj = games.map(g => {
    const rc = rest ? rest.get(g.id) : null;
    const ah = absences ? absences(g, 'home') : 0, aa = absences ? absences(g, 'away') : 0;
    const adjH = (rc && REST ? restPts(rc.home, true, REST) : 0) - ABS_C * ah / 2 + ABS_C * aa / 2;
    const adjA = (rc && REST ? restPts(rc.away, false, REST) : 0) - ABS_C * aa / 2 + ABS_C * ah / 2;
    return { ...g, adj: { home: adjH, away: adjA } };
  });
  return fitRatings(withAdj, { asOf, halfLife });
}

/* Efecto del descanso: media del residuo de eficiencia (pts/100) por
   categoría, con el fit dado (sin REST) y encogido con n/(n+200). */
function estimateRest(games, fit, rest, { absences, ABS_C = 0 } = {}) {
  const acc = {};
  const add = (k, v) => { acc[k] = acc[k] || { s: 0, n: 0 }; acc[k].s += v; acc[k].n++; };
  for (const g of games) {
    const rh = fit.ratings[g.home.abbr], ra = fit.ratings[g.away.abbr];
    if (!rh || !ra) continue;
    const poss = (g.home.poss && g.away.poss) ? (g.home.poss + g.away.poss) / 2 : fit.poss;
    const ah = absences ? absences(g, 'home') : 0, aa = absences ? absences(g, 'away') : 0;
    const hfaHalf = g.neutral ? 0 : fit.hfa / 2;
    const eh = fit.mu + hfaHalf + rh.off - ra.def - ABS_C * ah / 2 + ABS_C * aa / 2;
    const ea = fit.mu - hfaHalf + ra.off - rh.def - ABS_C * aa / 2 + ABS_C * ah / 2;
    const resH = 100 * g.home.score / poss - eh, resA = 100 * g.away.score / poss - ea;
    const rc = rest.get(g.id);
    if (!rc) continue;
    add(rc.home === 'b2b' ? 'b2b_home' : rc.home, resH);
    add(rc.away === 'b2b' ? 'b2b_away' : rc.away, resA);
  }
  const out = { b2b_home: 0, b2b_away: 0, three_in_four: 0, rested: 0, long: 0, normal: 0 };
  const detail = {};
  for (const k in acc) { const m = acc[k].s / acc[k].n; out[k] = +(m * (acc[k].n / (acc[k].n + 200))).toFixed(2); detail[k] = { n: acc[k].n, raw: +m.toFixed(2) }; }
  // "normal" es la referencia: se centra en 0
  const base = out.normal; for (const k in out) out[k] = +(out[k] - base).toFixed(2);
  delete out.normal;
  return { REST: out, detail };
}

/* Dispersiones: sd del residuo de margen/total y parámetros de 1ª
   mitad / 1er cuarto medidos sobre los parciales reales. rows:
   [{g, expH, expA}] */
function measureDispersion(rows) {
  let n = 0, sm2 = 0, st2 = 0, sm = 0, st = 0;
  let n1 = 0, h1t = 0, h1m2 = 0, h1t2 = 0, h1mShare = 0, h1mShareW = 0, q1t = 0, q1m2 = 0, q1t2 = 0, q1mShare = 0;
  for (const { g, expH, expA } of rows) {
    const m = g.home.score - g.away.score, t = g.home.score + g.away.score;
    const em = expH - expA, et = expH + expA;
    sm += m - em; sm2 += (m - em) ** 2; st += t - et; st2 += (t - et) ** 2; n++;
    if (g.home.q && g.away.q && g.home.q.length >= 4) {
      const hq = g.home.q, aq = g.away.q;
      const h1 = hq[0] + hq[1] + aq[0] + aq[1], h1m = hq[0] + hq[1] - aq[0] - aq[1];
      const q1 = hq[0] + aq[0], q1m = hq[0] - aq[0];
      h1t += h1 / et; q1t += q1 / et; n1++;
      // regresión por el origen del margen parcial sobre el margen esperado
      h1mShare += h1m * em; q1mShare += q1m * em; h1mShareW += em * em;
      h1t2 += h1; q1t2 += q1;
      h1m2 += h1m; q1m2 += q1m;
    }
  }
  const sdM = Math.sqrt(sm2 / n - (sm / n) ** 2), sdT = Math.sqrt(st2 / n - (st / n) ** 2);
  const H1_SHARE_TOTAL = h1t / n1, Q1_SHARE_TOTAL = q1t / n1;
  const H1_SHARE_MARGIN = h1mShare / h1mShareW, Q1_SHARE_MARGIN = q1mShare / h1mShareW;
  // sd de parciales alrededor de su esperado
  let s1 = 0, s1m = 0, sq = 0, sqm = 0, k = 0;
  for (const { g, expH, expA } of rows) {
    if (!(g.home.q && g.away.q && g.home.q.length >= 4)) continue;
    const em = expH - expA, et = expH + expA;
    const hq = g.home.q, aq = g.away.q;
    s1 += (hq[0] + hq[1] + aq[0] + aq[1] - H1_SHARE_TOTAL * et) ** 2;
    s1m += (hq[0] + hq[1] - aq[0] - aq[1] - H1_SHARE_MARGIN * em) ** 2;
    sq += (hq[0] + aq[0] - Q1_SHARE_TOTAL * et) ** 2;
    sqm += (hq[0] - aq[0] - Q1_SHARE_MARGIN * em) ** 2;
    k++;
  }
  const r = v => +v.toFixed(3);
  return {
    SD_MARGIN: r(sdM), SD_TOTAL: r(sdT), bias_margin: r(sm / n), bias_total: r(st / n),
    H1_SHARE_TOTAL: r(H1_SHARE_TOTAL), SD_H1_TOTAL: r(Math.sqrt(s1 / k)), H1_SHARE_MARGIN: r(H1_SHARE_MARGIN), SD_H1_MARGIN: r(Math.sqrt(s1m / k)),
    Q1_SHARE_TOTAL: r(Q1_SHARE_TOTAL), SD_Q1_TOTAL: r(Math.sqrt(sq / k)), Q1_SHARE_MARGIN: r(Q1_SHARE_MARGIN), SD_Q1_MARGIN: r(Math.sqrt(sqm / k)),
    n, n_quarters: k,
  };
}

module.exports = { seasons, absenceLookup, restLookup, fitWith, estimateRest, measureDispersion, ALT_TEAMS };
