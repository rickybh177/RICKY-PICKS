#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — modelo Liga MX contra el Clausura 2026.

   Validación honesta, sin fuga de datos:
   1. Ajusta Dixon-Coles SOLO con partidos hasta el 5-ene-2026
      (el Clausura 2026 arrancó el 9-ene).
   2. Recorre el Clausura 2026 en orden: predice cada partido con
      los ratings vigentes y DESPUÉS aprende el resultado (mismo
      sgdUpdate del runtime).
   3. Reporta Brier/log-loss del 1X2 vs base de liga, calibración
      del favorito, O/U 2.5, BTTS, "seguros" DC ≥0.82, marcador
      exacto top-1 y sensibilidad al ritmo de aprendizaje K.

   Uso:  node scripts/mx-backtest.js
   ============================================================ */

const { getRangeChunked } = require('../lib/mx/data');
const { fitDixonColes } = require('../lib/mx/fit');
const { lambdas, sgdUpdate } = require('../lib/mx/model');
const { dcMatrix, marketsFromMatrix } = require('../lib/mx/engine');

const FIT_START = '2024-01-01';
const CUTOFF = '2026-01-05';       // víspera del Clausura 2026
const TEST_END = '2026-05-31';     // incluye liguilla

function predict(R, LG, g) {
  const L = lambdas(R, g, LG);
  if (!L) return null;
  const P = dcMatrix(L.lh, L.la, LG.rho);
  return { L, mk: marketsFromMatrix(P, L.lh, L.la) };
}

(async () => {
  console.log(`Datos ${FIT_START} → ${TEST_END}…`);
  const all = await getRangeChunked(FIT_START, TEST_END);
  const done = all.filter(g => g.completed && g.home.score != null && g.away.score != null);
  const fitSet = done.filter(g => g.date < CUTOFF);
  const testSet = done.filter(g => g.date >= CUTOFF).sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`  ajuste: ${fitSet.length} juegos · prueba: ${testSet.length} juegos (Clausura 2026)`);

  const fit = fitDixonColes(fitSet, { asOf: new Date(CUTOFF + 'T00:00:00Z').getTime() });
  const LG = { mu: fit.mu, hfa: fit.hfa, altC: fit.altC, rho: fit.rho };
  console.log(`  fit: mu=${fit.mu} hfa=${fit.hfa} altC=${fit.altC} rho=${fit.rho}`);

  /* walk-forward con la MISMA lógica del runtime: ratings por
     equipo + corrección global del entorno goleador (muShift) */
  function walkForward(K, useMuShift) {
    const R = {};
    for (const t in fit.ratings) R[t] = { ...fit.ratings[t] };
    let obs = 0, pred = 0, n = 0, muShift = 0;
    const rows = [];
    for (const g of testSet) {
      if (!R[g.home.abbr]) R[g.home.abbr] = { att: -0.2, def: 0.12 };
      if (!R[g.away.abbr]) R[g.away.abbr] = { att: -0.2, def: 0.12 };
      const LGdyn = useMuShift ? { ...LG, mu: LG.mu + muShift } : LG;
      const pr = predict(R, LGdyn, g);
      if (pr) rows.push({ g, mk: pr.mk });
      const L = lambdas(R, g, LGdyn);
      obs += g.home.score + g.away.score;
      pred += L.lh + L.la;
      n++;
      muShift = Math.max(-0.08, Math.min(0.08, Math.log((obs + 8) / (pred + 8)) * (n / (n + 80))));
      sgdUpdate(R, g, LGdyn, K);
    }
    return rows;
  }

  /* sensibilidad al ritmo de aprendizaje (con corrección de liga) */
  for (const K of [0, 0.02, 0.025, 0.035, 0.05]) {
    let brier = 0, ll = 0, n = 0;
    for (const { g, mk } of walkForward(K, true)) {
      const { home, draw, away } = mk.moneyline;
      const oH = g.home.score > g.away.score ? 1 : 0;
      const oD = g.home.score === g.away.score ? 1 : 0;
      const oA = 1 - oH - oD;
      brier += ((home - oH) ** 2 + (draw - oD) ** 2 + (away - oA) ** 2);
      ll += -(oH * Math.log(home) + oD * Math.log(draw) + oA * Math.log(away));
      n++;
    }
    console.log(`  K=${K}: Brier 1X2=${(brier / n).toFixed(4)} · log-loss=${(ll / n).toFixed(4)} (n=${n})`);
  }

  /* base de liga (frecuencias del set de ajuste, últimos 2 torneos) */
  const recent = fitSet.filter(g => g.date >= '2025-01-01');
  let bH = 0, bD = 0, bA = 0;
  for (const g of recent) {
    if (g.home.score > g.away.score) bH++;
    else if (g.home.score === g.away.score) bD++;
    else bA++;
  }
  const nb = recent.length;
  const base = { h: bH / nb, d: bD / nb, a: bA / nb };
  let baseBrier = 0, baseLL = 0;
  for (const g of testSet) {
    const oH = g.home.score > g.away.score ? 1 : 0;
    const oD = g.home.score === g.away.score ? 1 : 0;
    const oA = 1 - oH - oD;
    baseBrier += ((base.h - oH) ** 2 + (base.d - oD) ** 2 + (base.a - oA) ** 2);
    baseLL += -(oH * Math.log(base.h) + oD * Math.log(base.d) + oA * Math.log(base.a));
  }
  console.log(`  BASE liga (${base.h.toFixed(2)}/${base.d.toFixed(2)}/${base.a.toFixed(2)}): Brier=${(baseBrier / testSet.length).toFixed(4)} · log-loss=${(baseLL / testSet.length).toFixed(4)}`);

  /* ---- pasada completa con el K del runtime (0.025) + muShift ---- */
  const favBuckets = {}; // decil de prob del favorito → {n, hits}
  let ou = { n: 0, brier: 0, overs: 0, pOver: 0 };
  let btts = { n: 0, brier: 0, yes: 0, pYes: 0 };
  let dc = { n: 0, hits: 0 };           // "seguros" ≥ 0.84
  let exact = { n: 0, hits: 0 };
  {
    for (const { g, mk: m } of walkForward(0.025, true)) {
      const gh = g.home.score, ga = g.away.score;
      // favorito 1X2
      const probs = [['h', m.moneyline.home], ['d', m.moneyline.draw], ['a', m.moneyline.away]].sort((x, y) => y[1] - x[1]);
      const fav = probs[0];
      const won = (fav[0] === 'h' && gh > ga) || (fav[0] === 'd' && gh === ga) || (fav[0] === 'a' && ga > gh);
      const bucket = Math.min(8, Math.floor(fav[1] * 10));
      favBuckets[bucket] = favBuckets[bucket] || { n: 0, hits: 0, sum: 0 };
      favBuckets[bucket].n++; favBuckets[bucket].sum += fav[1];
      if (won) favBuckets[bucket].hits++;
      // O/U 2.5
      const t25 = m.totals.find(t => t.line === 2.5);
      const over = gh + ga > 2.5 ? 1 : 0;
      ou.n++; ou.brier += (t25.over - over) ** 2; ou.overs += over; ou.pOver += t25.over;
      // BTTS
      const y = gh > 0 && ga > 0 ? 1 : 0;
      btts.n++; btts.brier += (m.btts.yes - y) ** 2; btts.yes += y; btts.pYes += m.btts.yes;
      // seguros DC (1X o X2 ≥ 0.84, la barra BET del runtime)
      const dc1x = m.double_chance.home_draw, dcx2 = m.double_chance.away_draw;
      if (Math.max(dc1x, dcx2) >= 0.84) {
        dc.n++;
        const pick1x = dc1x >= dcx2;
        if ((pick1x && gh >= ga) || (!pick1x && ga >= gh)) dc.hits++;
      }
      // marcador exacto top-1
      exact.n++;
      if (m.exact_scores[0] && m.exact_scores[0].score === `${gh}-${ga}`) exact.hits++;
    }
  }
  console.log('\nCalibración del favorito 1X2 (decil → predicho vs real):');
  for (const b of Object.keys(favBuckets).sort()) {
    const x = favBuckets[b];
    console.log(`  ${(b * 10)}–${(+b + 1) * 10}%: pred ${(x.sum / x.n * 100).toFixed(1)}% · real ${(x.hits / x.n * 100).toFixed(1)}% (n=${x.n})`);
  }
  console.log(`\nO/U 2.5: Brier=${(ou.brier / ou.n).toFixed(4)} · pred over ${(ou.pOver / ou.n * 100).toFixed(1)}% · real ${(ou.overs / ou.n * 100).toFixed(1)}%`);
  console.log(`BTTS:    Brier=${(btts.brier / btts.n).toFixed(4)} · pred sí ${(btts.pYes / btts.n * 100).toFixed(1)}% · real ${(btts.yes / btts.n * 100).toFixed(1)}%`);
  console.log(`Seguros DC ≥84%: ${dc.hits}/${dc.n} = ${dc.n ? (dc.hits / dc.n * 100).toFixed(1) : '—'}% (promesa: ~85%+)`);
  console.log(`Marcador exacto top-1: ${exact.hits}/${exact.n} = ${(exact.hits / exact.n * 100).toFixed(1)}% (azar puro ~5-7%, bueno ~10-12%)`);
})().catch(e => { console.error(e); process.exit(1); });
