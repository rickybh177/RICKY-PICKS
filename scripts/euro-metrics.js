/* ============================================================
   EUROPA — métricas del backtest walk-forward, compartidas.

   Las usan scripts/euro-backtest.js (ligas: Premier, LaLiga,
   Bundesliga) y scripts/ucl-backtest.js (Champions, que además
   aprende de las ligas domésticas). Una sola copia para que las
   dos validaciones se lean con la MISMA regla: Brier / log-loss /
   RPS del 1X2 contra la base, calibración del favorito por decil,
   O/U 2.5, ambos anotan, "seguros" de doble oportunidad por barra,
   marcador exacto top-1 y la cordura sin mercado.

   walkForward recorre los resultados con el ciclo de
   lib/euro/core.js (replayResults: predecir → muShift → aprender)
   y registra la predicción ANTES de ver el marcador. shouldRecord
   permite aprender de un conjunto más amplio que el que se evalúa
   (la Champions aprende de la liga de cada club y solo se califican
   sus propios partidos).
   ============================================================ */

const { lambdas, clampLambda, replayResults, restInfo } = require('../lib/euro/core');
const { dcMatrix, marketsFromMatrix } = require('../lib/mx/engine');

const DC_BARS = [0.72, 0.76, 0.80, 0.84];
const BTTS_BARS = [0.535, 0.555, 0.58, 0.60, 0.62];

/* resultado real en 1X2 como vector [H, D, A] */
const outcomeOf = g => {
  const gh = g.home.score, ga = g.away.score;
  return gh > ga ? [1, 0, 0] : gh === ga ? [0, 1, 0] : [0, 0, 1];
};
/* RPS de 3 resultados ordenados (local, empate, visita) */
function rps3(p, o) {
  const c1 = p[0] - o[0], c2 = p[0] + p[1] - o[0] - o[1];
  return 0.5 * (c1 * c1 + c2 * c2);
}
function score3(p, o) {
  let brier = 0, ll = 0;
  for (let i = 0; i < 3; i++) {
    brier += (p[i] - o[i]) ** 2;
    if (o[i]) ll -= Math.log(Math.max(1e-12, p[i]));
  }
  return { brier, ll, rps: rps3(p, o) };
}

/* ---- una pasada walk-forward: devuelve la lista de predicciones ----
   learnSet: juegos de los que se aprende (orden cronológico lo pone
   replayResults). shouldRecord(g): cuáles se evalúan (default: todos). */
function walkForward(learnSet, priors, LG, cal, shouldRecord) {
  const rows = [];
  const lastGame = {}; // id -> ms del último juego (descanso)
  replayResults(learnSet, priors, LG, cal, (g, R, LGdyn) => {
    const ms = new Date(g.date).getTime();
    if (!shouldRecord || shouldRecord(g)) {
      const L = lambdas(R, g, LGdyn);
      const restH = restInfo(lastGame[g.home.id], g.date, cal);
      const restA = restInfo(lastGame[g.away.id], g.date, cal);
      const lh = clampLambda(L.lh * restH.mult), la = clampLambda(L.la * restA.mult);
      const P = dcMatrix(lh, la, LGdyn.rho);
      rows.push({ g, lh, la, mk: marketsFromMatrix(P, lh, la), muShift: LGdyn.mu - LG.mu });
    }
    lastGame[g.home.id] = ms; lastGame[g.away.id] = ms;
  });
  return rows;
}

/* ---- métricas de una pasada ---- */
function evaluate(rows, base, cal) {
  const n = rows.length;
  let brier = 0, ll = 0, rps = 0, bBrier = 0, bLL = 0, bRps = 0;
  const fav = {};                                   // decil → {n, hits, sum}
  let favHits = 0;
  const ou = { brier: 0, pOver: 0, overs: 0 };
  const btts = { brier: 0, pYes: 0, yes: 0 };
  const bars = [...new Set([cal.dcBet, ...DC_BARS])].sort((a, b) => a - b);
  const dc = {};
  for (const b of bars) dc[b] = { n: 0, hits: 0 };
  const bbars = [...new Set([cal.bttsBet, ...BTTS_BARS])].sort((a, b) => a - b);
  const bt = {};
  for (const b of bbars) bt[b] = { n: 0, hits: 0 };
  let exactHits = 0;
  let predTotal = 0, realTotal = 0, predH = 0, predD = 0, predA = 0, realH = 0, realD = 0, realA = 0;
  let lastMuShift = 0;

  for (const { g, lh, la, mk, muShift } of rows) {
    const gh = g.home.score, ga = g.away.score;
    const p = [mk.moneyline.home, mk.moneyline.draw, mk.moneyline.away];
    const o = outcomeOf(g);
    const s = score3(p, o), sb = score3(base.p, o);
    brier += s.brier; ll += s.ll; rps += s.rps;
    bBrier += sb.brier; bLL += sb.ll; bRps += sb.rps;

    // favorito 1X2 por decil
    const fi = p.indexOf(Math.max(...p));
    const bucket = Math.min(8, Math.floor(p[fi] * 10));
    fav[bucket] = fav[bucket] || { n: 0, hits: 0, sum: 0 };
    fav[bucket].n++; fav[bucket].sum += p[fi];
    if (o[fi]) { fav[bucket].hits++; favHits++; }

    // O/U 2.5
    const t25 = mk.totals.find(t => t.line === 2.5);
    const over = gh + ga > 2.5 ? 1 : 0;
    ou.brier += (t25.over - over) ** 2; ou.pOver += t25.over; ou.overs += over;

    // ambos anotan
    const y = gh > 0 && ga > 0 ? 1 : 0;
    btts.brier += (mk.btts.yes - y) ** 2; btts.pYes += mk.btts.yes; btts.yes += y;
    // ambos anotan: el lado que favorece el modelo, a cada barra
    const pB = Math.max(mk.btts.yes, 1 - mk.btts.yes), pickYes = mk.btts.yes >= 0.5;
    for (const b of bbars) if (pB >= b) { bt[b].n++; if ((pickYes && y) || (!pickYes && !y)) bt[b].hits++; }

    // seguros DC: 1X o X2, el mayor, a cada barra
    const dc1x = mk.double_chance.home_draw, dcx2 = mk.double_chance.away_draw;
    const pick1x = dc1x >= dcx2, pDc = Math.max(dc1x, dcx2);
    const hit = (pick1x && gh >= ga) || (!pick1x && ga >= gh);
    for (const b of bars) if (pDc >= b) { dc[b].n++; if (hit) dc[b].hits++; }

    // marcador exacto top-1
    if (mk.exact_scores[0] && mk.exact_scores[0].score === `${gh}-${ga}`) exactHits++;

    // cordura sin mercado
    predTotal += lh + la; realTotal += gh + ga;
    predH += p[0]; predD += p[1]; predA += p[2];
    realH += o[0]; realD += o[1]; realA += o[2];
    lastMuShift = muShift;
  }

  const r4 = x => +x.toFixed(4), r3 = x => +x.toFixed(3);
  const favByDecile = {};
  for (const b of Object.keys(fav).sort()) {
    const x = fav[b];
    favByDecile[`${b * 10}-${(+b + 1) * 10}`] = { n: x.n, pred: r3(x.sum / x.n), real: r3(x.hits / x.n) };
  }
  const dcOut = {};
  for (const b of bars) dcOut[b] = { n: dc[b].n, hits: dc[b].hits, rate: dc[b].n ? r3(dc[b].hits / dc[b].n) : null };
  const btOut = {};
  for (const b of bbars) btOut[b] = { n: bt[b].n, hits: bt[b].hits, rate: bt[b].n ? r3(bt[b].hits / bt[b].n) : null };
  return {
    n,
    brier: r4(brier / n), logloss: r4(ll / n), rps: r4(rps / n),
    base_brier: r4(bBrier / n), base_logloss: r4(bLL / n), base_rps: r4(bRps / n),
    brier_skill: r3(1 - (brier / n) / (bBrier / n)),
    fav_hit_rate: r3(favHits / n),
    fav_by_decile: favByDecile,
    ou25: { brier: r4(ou.brier / n), pred_over: r3(ou.pOver / n), real_over: r3(ou.overs / n), base_over: base.over25 },
    btts: { brier: r4(btts.brier / n), pred_yes: r3(btts.pYes / n), real_yes: r3(btts.yes / n), base_yes: base.btts },
    dc_bars: dcOut,
    btts_bars: btOut,
    exact_top1: r3(exactHits / n),
    sanity: {
      pred_mean_total: r3(predTotal / n), real_mean_total: r3(realTotal / n), base_mean_total: base.meanTotal,
      pred_home: r3(predH / n), real_home: r3(realH / n),
      pred_draw: r3(predD / n), real_draw: r3(realD / n),
      pred_away: r3(predA / n), real_away: r3(realA / n),
    },
    mu_shift_final: r4(lastMuShift),
  };
}

/* base de una competencia: frecuencias 1X2, O2.5, BTTS y goles del set de ajuste */
function baseRates(games) {
  let bH = 0, bD = 0, bA = 0, bOver = 0, bBtts = 0, bTot = 0;
  for (const g of games) {
    const [h, d, a] = outcomeOf(g);
    bH += h; bD += d; bA += a;
    if (g.home.score + g.away.score > 2.5) bOver++;
    if (g.home.score > 0 && g.away.score > 0) bBtts++;
    bTot += g.home.score + g.away.score;
  }
  const nb = games.length || 1;
  return {
    p: [bH / nb, bD / nb, bA / nb],
    over25: +(bOver / nb).toFixed(3), btts: +(bBtts / nb).toFixed(3), meanTotal: +(bTot / nb).toFixed(3),
  };
}

const pct = x => x == null ? '—' : (x * 100).toFixed(1) + '%';

/* detalle legible de una pasada (mismo formato en los dos backtests) */
function printDetail(m, cal, label) {
  console.log(`\nDetalle (${label}):`);
  console.log(`  1X2: Brier ${m.brier} vs base ${m.base_brier} · log-loss ${m.logloss} vs ${m.base_logloss} · RPS ${m.rps} vs ${m.base_rps} · skill ${pct(m.brier_skill)} · favorito acierta ${pct(m.fav_hit_rate)}`);
  console.log('  Calibración del favorito 1X2 (decil → predicho vs real):');
  for (const [k, x] of Object.entries(m.fav_by_decile)) console.log(`    ${k}%: pred ${pct(x.pred)} · real ${pct(x.real)} (n=${x.n})`);
  console.log(`  O/U 2.5: Brier ${m.ou25.brier} · pred over ${pct(m.ou25.pred_over)} · real ${pct(m.ou25.real_over)} (base ${pct(m.ou25.base_over)})`);
  console.log(`  BTTS:    Brier ${m.btts.brier} · pred sí ${pct(m.btts.pred_yes)} · real ${pct(m.btts.real_yes)} (base ${pct(m.btts.base_yes)})`);
  console.log('  Seguros DC (1X o X2) por barra:');
  for (const [b, x] of Object.entries(m.dc_bars)) console.log(`    ≥${b}: ${x.hits}/${x.n} = ${pct(x.rate)}${Number(b) === cal.dcBet ? '  ← barra BET (dcBet)' : ''}`);
  if (m.btts_bars) {
    console.log('  Ambos anotan (lado del modelo) por barra:');
    for (const [b, x] of Object.entries(m.btts_bars)) console.log(`    ≥${b}: ${x.hits}/${x.n} = ${pct(x.rate)}${Number(b) === cal.bttsBet ? '  ← barra BET (bttsBet)' : ''}`);
  }
  console.log(`  Marcador exacto top-1: ${pct(m.exact_top1)} (azar ~5-7%, bueno ~10-12%)`);
  console.log(`  Cordura sin mercado: total predicho ${m.sanity.pred_mean_total} vs real ${m.sanity.real_mean_total} (base ${m.sanity.base_mean_total}) · local ${pct(m.sanity.pred_home)} vs ${pct(m.sanity.real_home)} · empate ${pct(m.sanity.pred_draw)} vs ${pct(m.sanity.real_draw)} · visita ${pct(m.sanity.pred_away)} vs ${pct(m.sanity.real_away)}`);
  console.log(`  muShift al cierre: ${m.mu_shift_final}`);
}

module.exports = { DC_BARS, BTTS_BARS, outcomeOf, rps3, score3, walkForward, evaluate, baseRates, printDetail, pct };
