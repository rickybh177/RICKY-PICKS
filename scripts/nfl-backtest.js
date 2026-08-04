#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — modelo NFL contra la temporada 2025.

   Validación honesta, sin fuga de datos (receta de mx-backtest):
   1. Ajusta ratings SOLO con 2023+2024 (regular+playoffs),
      asOf 1-sep-2025, y aplica el carry de temporada nueva.
   2. Recorre la 2025 en orden: predice cada juego con los
      ratings vigentes (misma learnRatings del runtime, con
      onPredict) y DESPUÉS aprende el resultado.
   3. Reporta: Brier del ML vs base de localía, calibración por
      decil, MAE del margen y del total, sesgo del total (lo que
      muShift debe corregir), sensibilidad a carry/K/muShift y
      validación de la varianza del motor de drives.
   4. PRETEMPORADA: parámetros ajustados solo con 2024 (agosto),
      probados contra la pretemporada 2025.

   Uso:  node scripts/nfl-backtest.js
   ============================================================ */
const { getSeasonGames } = require('./nfl-history');
const { fitRatings, fitPreseason } = require('../lib/nfl/fit');
const { learnRatings } = require('../lib/nfl/model');
const { simulateGame, marketsFromSims } = require('../lib/nfl/engine');

const SIMS_SEED = 'bt';

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/* pasada walk-forward: regresa filas {g, expH, expA} */
function walk(testSet, priors, { mu, hfa, k, muShiftOn }) {
  const rows = [];
  learnRatings(testSet, { priors, mu, hfa, k, muShiftOn }, (g, expH, expA) => {
    rows.push({ g, expH, expA });
  });
  return rows;
}

/* métricas de una pasada (ML analítico con sd=13.4 para ir rápido
   en los grids; la validación del motor de drives va aparte) */
const MARGIN_SD = 13.4;
function metrics(rows) {
  let brier = 0, nMl = 0, mae = 0, maeT = 0, biasT = 0, n = 0;
  for (const { g, expH, expA } of rows) {
    const margin = g.home.score - g.away.score;
    const total = g.home.score + g.away.score;
    const em = expH - expA, et = expH + expA;
    if (margin !== 0) {
      const pH = normCdf(em / MARGIN_SD);
      brier += (pH - (margin > 0 ? 1 : 0)) ** 2;
      nMl++;
    }
    mae += Math.abs(margin - em);
    maeT += Math.abs(total - et);
    biasT += total - et;
    n++;
  }
  return {
    brier: brier / nMl,
    mae: mae / n,
    maeT: maeT / n,
    biasT: biasT / n,
    n,
  };
}

(async () => {
  /* ---- datos ---- */
  const fitSet = [];
  for (const y of [2023, 2024]) {
    fitSet.push(...await getSeasonGames(y, 2));
    fitSet.push(...await getSeasonGames(y, 3));
  }
  const testSet = (await getSeasonGames(2025, 2))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`ajuste: ${fitSet.length} juegos (2023-24) · prueba: ${testSet.length} juegos (2025 regular)`);

  const fit = fitRatings(fitSet, { asOf: new Date('2025-09-01T00:00:00Z').getTime() });
  console.log(`fit: mu=${fit.mu} hfa=${fit.hfa} resid_sd=${fit.diag.resid_sd}\n`);

  const priorsWith = carry => {
    const P = {};
    for (const t in fit.ratings) P[t] = { off: fit.ratings[t].off * carry, def: fit.ratings[t].def * carry };
    return P;
  };

  /* base: localía pura (prob fija de que gane el local) */
  {
    let wins = 0, nMl = 0;
    for (const g of testSet) { const m = g.home.score - g.away.score; if (m !== 0) { nMl++; if (m > 0) wins++; } }
    const pBase = wins / nMl;
    let brier = 0;
    for (const g of testSet) { const m = g.home.score - g.away.score; if (m !== 0) brier += (pBase - (m > 0 ? 1 : 0)) ** 2; }
    console.log(`BASE localía (p=${pBase.toFixed(3)}): Brier ML=${(brier / nMl).toFixed(4)}`);
  }

  /* ---- sensibilidad al CARRY (K=0.10, muShift on) ---- */
  console.log('\nCarry (cuánto 2023-24 se hereda a 2025):');
  for (const carry of [0.35, 0.5, 0.6, 0.75, 1.0]) {
    const m = metrics(walk(testSet, priorsWith(carry), { mu: fit.mu, hfa: fit.hfa, k: 0.10, muShiftOn: true }));
    console.log(`  carry=${carry}: Brier ML=${m.brier.toFixed(4)} · MAE margen=${m.mae.toFixed(2)} · MAE total=${m.maeT.toFixed(2)}`);
  }

  /* ---- sensibilidad a K (mejor carry) ---- */
  const CARRY = 0.6;
  console.log(`\nK (ritmo de aprendizaje, carry=${CARRY}):`);
  for (const k of [0, 0.05, 0.08, 0.10, 0.15, 0.25]) {
    const m = metrics(walk(testSet, priorsWith(CARRY), { mu: fit.mu, hfa: fit.hfa, k, muShiftOn: true }));
    console.log(`  K=${k}: Brier ML=${m.brier.toFixed(4)} · MAE margen=${m.mae.toFixed(2)} · MAE total=${m.maeT.toFixed(2)}`);
  }

  /* ---- muShift on/off ---- */
  console.log('\nmuShift (corrección del entorno anotador):');
  for (const on of [false, true]) {
    const m = metrics(walk(testSet, priorsWith(CARRY), { mu: fit.mu, hfa: fit.hfa, k: 0.10, muShiftOn: on }));
    console.log(`  ${on ? 'ON ' : 'OFF'}: sesgo total=${m.biasT >= 0 ? '+' : ''}${m.biasT.toFixed(2)} pts/juego · MAE total=${m.maeT.toFixed(2)} · Brier ML=${m.brier.toFixed(4)}`);
  }

  /* ---- pasada de producción: calibración + motor de drives ---- */
  console.log('\nPasada de producción (carry=0.6, K=0.10, muShift on, motor de drives 2,000 sims):');
  const rows = walk(testSet, priorsWith(CARRY), { mu: fit.mu, hfa: fit.hfa, k: 0.10, muShiftOn: true });
  const buckets = {};
  let brierSim = 0, nMl = 0, coverFair = 0, nCover = 0;
  let sumM = 0, sumM2 = 0, sumT = 0, sumT2 = 0, simM = 0, simM2 = 0, simT = 0, simT2 = 0, nS = 0;
  const N = 2000;
  for (const { g, expH, expA } of rows) {
    const agg = simulateGame({ expHome: Math.max(8, expH), expAway: Math.max(8, expA), seed: SIMS_SEED + g.id });
    agg.n = N; // usar solo las primeras N muestras sería complejo; simulateGame ya corre N_SIMS
    const mk = marketsFromSims(agg, null);
    const margin = g.home.score - g.away.score;
    const total = g.home.score + g.away.score;
    if (margin !== 0) {
      const pH = mk.moneyline.home / (mk.moneyline.home + mk.moneyline.away);
      brierSim += (pH - (margin > 0 ? 1 : 0)) ** 2; nMl++;
      const b = Math.min(9, Math.floor(Math.max(pH, 1 - pH) * 10));
      buckets[b] = buckets[b] || { n: 0, hits: 0, sum: 0 };
      buckets[b].n++; buckets[b].sum += Math.max(pH, 1 - pH);
      if ((pH >= 0.5) === (margin > 0)) buckets[b].hits++;
    }
    // ¿el margen real cae de cada lado de la línea justa ~50/50?
    const fl = mk.spread.fair_line;
    if (margin + fl !== 0) { nCover++; if (margin + fl > 0) coverFair++; }
    // varianza real vs varianza del motor
    sumM += margin; sumM2 += margin * margin;
    sumT += total; sumT2 += total * total;
    const em = (agg.homePts - agg.awayPts) / agg.samples.margins.length;
    const et = (agg.homePts + agg.awayPts) / agg.samples.margins.length;
    let vm = 0, vt = 0;
    for (let i = 0; i < agg.samples.margins.length; i++) {
      vm += (agg.samples.margins[i] - em) ** 2;
      vt += (agg.samples.totals[i] - et) ** 2;
    }
    simM2 += vm / agg.samples.margins.length; simT2 += vt / agg.samples.margins.length;
    nS++;
  }
  console.log(`  Brier ML (drives)=${(brierSim / nMl).toFixed(4)}`);
  console.log(`  Línea justa del modelo: el local la cubre ${(coverFair / nCover * 100).toFixed(1)}% (sano ≈ 50%)`);
  const realSdM = Math.sqrt(sumM2 / nS - (sumM / nS) ** 2);
  const realSdT = Math.sqrt(sumT2 / nS - (sumT / nS) ** 2);
  console.log(`  sd real: margen=${realSdM.toFixed(1)} · total=${realSdT.toFixed(1)}  |  sd motor: margen=${Math.sqrt(simM2 / nS).toFixed(1)} · total=${Math.sqrt(simT2 / nS).toFixed(1)}`);
  console.log('  Calibración del favorito ML (decil → predicho vs real):');
  for (const b of Object.keys(buckets).sort()) {
    const x = buckets[b];
    console.log(`    ${b * 10}–${(+b + 1) * 10}%: pred ${(x.sum / x.n * 100).toFixed(1)}% · real ${(x.hits / x.n * 100).toFixed(1)}% (n=${x.n})`);
  }

  /* ---- PRETEMPORADA: ajustar con 2024, probar contra 2025 ---- */
  console.log('\nPretemporada (parámetros de 2024 → prueba 2025):');
  const histFor = async year => {
    const h = [];
    for (const y of [year - 2, year - 1]) { h.push(...await getSeasonGames(y, 2)); h.push(...await getSeasonGames(y, 3)); }
    return h;
  };
  const f24 = fitRatings(await histFor(2024), { asOf: new Date('2024-08-01T00:00:00Z').getTime() });
  const R24 = {};
  for (const t in f24.ratings) R24[t] = { off: f24.ratings[t].off * CARRY, def: f24.ratings[t].def * CARRY };
  const pre24 = await getSeasonGames(2024, 1);
  const pre = fitPreseason(pre24, { 2024: R24 });
  console.log(`  fit 2024: mu=${pre.mu} hfa=${pre.hfa} beta=${pre.beta}`);
  const f25 = fitRatings(await histFor(2025), { asOf: new Date('2025-08-01T00:00:00Z').getTime() });
  const R25 = {};
  for (const t in f25.ratings) R25[t] = { off: f25.ratings[t].off * CARRY, def: f25.ratings[t].def * CARRY };
  const pre25 = await getSeasonGames(2025, 1);
  for (const beta of [pre.beta, 0.3]) {
    let brier = 0, nMl2 = 0, biasT = 0, maeT = 0, n = 0, baseB = 0;
    let homeWins = 0, dec = 0;
    for (const g of pre25) { const m = g.home.score - g.away.score; if (m !== 0) { dec++; if (m > 0) homeWins++; } }
    const pBase = homeWins / dec;
    for (const g of pre25) {
      const rh = R25[g.home.abbr], ra = R25[g.away.abbr];
      if (!rh || !ra) continue;
      const expH = pre.mu + pre.hfa / 2 + beta * (rh.off - ra.def);
      const expA = pre.mu - pre.hfa / 2 + beta * (ra.off - rh.def);
      const margin = g.home.score - g.away.score;
      if (margin !== 0) {
        const pH = normCdf((expH - expA) / 12.5);
        brier += (pH - (margin > 0 ? 1 : 0)) ** 2;
        baseB += (pBase - (margin > 0 ? 1 : 0)) ** 2;
        nMl2++;
      }
      biasT += (g.home.score + g.away.score) - (expH + expA);
      maeT += Math.abs((g.home.score + g.away.score) - (expH + expA));
      n++;
    }
    console.log(`  beta=${beta}: Brier ML=${(brier / nMl2).toFixed(4)} (base localía=${(baseB / nMl2).toFixed(4)}) · sesgo total=${(biasT / n) >= 0 ? '+' : ''}${(biasT / n).toFixed(2)} · MAE total=${(maeT / n).toFixed(2)} (n=${n})`);
  }
})().catch(e => { console.error(e); process.exit(1); });
