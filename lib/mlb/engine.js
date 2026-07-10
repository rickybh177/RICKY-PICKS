/* ============================================================
   MOTOR DE SIMULACIÓN MLB — Monte Carlo a nivel de turno al bate.

   Cada plate appearance (PA) se resuelve con log5 (odds ratio):
   tasas del bateador × tasas del pitcher ÷ baseline de liga,
   ajustado por parque, clima y times-through-the-order.
   El juego se corre inning por inning con máquina de estados
   base-out, cambio al bullpen y reglas reales (walk-off, extras
   con corredor fantasma). ~10,000 simulaciones por juego.

   Los outcomes de un PA: bb (BB+HBP), k, hr, d3, d2, s1, out.
   Solo backend: nada de esto se expone al navegador.
   ============================================================ */

const OUTCOMES = ['bb', 'k', 'hr', 'd3', 'd2', 's1'];

// Baseline de liga de respaldo (per PA, MLB 2026 al 7-jul). Se
// reemplaza en runtime con el agregado real de la API.
const FALLBACK_LEAGUE = {
  bb: 0.1014, k: 0.2211, hr: 0.0306, d3: 0.0035, d2: 0.0414, s1: 0.1411,
};

/* ---- RNG con semilla (mulberry32): reproducible y rápido ---- */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- log5 / odds ratio: combina bateador vs pitcher vs liga ---- */
function oddsRatio(pB, pP, pL) {
  if (pL <= 0 || pL >= 1) return (pB + pP) / 2;
  const num = (pB * pP) / pL;
  const den = num + ((1 - pB) * (1 - pP)) / (1 - pL);
  return den > 0 ? num / den : 0;
}

/* Penalización times-through-the-order del abridor: la 2ª y 3ª
   vuelta al lineup el pitcher rinde peor (~ +10 / +20 pts de wOBA). */
const TTO_MULT = [1.0, 1.035, 1.075]; // vuelta 1, 2, 3+

/* Calibración global de eventos positivos. El shrinkage hacia la
   media de liga hace ver mejores a los pitchers de lo que son (la
   liga mezcla abridores con bullpen); sin esto el total promedio
   de un día real sale ~8.5 en vez de ~9.1. Validado contra días
   reales de la temporada 2026. */
const CAL_EVENT = 1.026;

/* Distribución de outcomes de UN PA (bateador vs pitcher).
   mods = { hrMult, hitMult, ttoPass (0-2) } */
function paDistribution(bat, pit, lg, mods) {
  const tto = TTO_MULT[Math.min(mods.ttoPass || 0, 2)] * CAL_EVENT * (mods.extraMult || 1);
  const p = {};
  for (const o of OUTCOMES) p[o] = oddsRatio(bat[o], pit[o], lg[o]);

  // Parque + clima sobre la bola en juego
  p.hr *= (mods.hrMult || 1);
  p.s1 *= (mods.hitMult || 1);
  p.d2 *= (mods.hitMult || 1);
  p.d3 *= (mods.hitMult || 1);

  // TTO: los eventos positivos suben, el K baja
  p.bb *= tto; p.hr *= tto; p.s1 *= tto; p.d2 *= tto; p.d3 *= tto;
  p.k *= (2 - tto);

  let sum = 0;
  for (const o of OUTCOMES) { p[o] = Math.max(0.0005, Math.min(0.6, p[o])); sum += p[o]; }
  // 'out en juego' es el resto; nunca menos de 20% (evita degenerados)
  if (sum > 0.80) { const f = 0.80 / sum; for (const o of OUTCOMES) p[o] *= f; sum = 0.80; }

  // CDF para muestreo rápido: [bb, k, hr, d3, d2, s1] y el resto = out
  const cdf = new Float64Array(6);
  let acc = 0;
  cdf[0] = (acc += p.bb); cdf[1] = (acc += p.k); cdf[2] = (acc += p.hr);
  cdf[3] = (acc += p.d3); cdf[4] = (acc += p.d2); cdf[5] = (acc += p.s1);
  return cdf;
}

/* ---- avance de corredores (probabilidades típicas MLB) ---- */
const ADV = {
  single_r2_scores: 0.63, // corredor en 2ª anota con sencillo
  single_r1_to3: 0.28,    // corredor en 1ª llega a 3ª con sencillo
  double_r1_scores: 0.45, // corredor en 1ª anota con doble
  dp_rate: 0.09,          // rodado de doble play con corredor en 1ª y <2 outs
  sf_rate: 0.22,          // elevado de sacrificio con corredor en 3ª y <2 outs
  roe_rate: 0.020,        // out en juego que en realidad es error (llega a 1ª)
  prod_out: 0.16,         // out productivo: corredor de 2ª avanza a 3ª sin force
};

/* Estado de bases como bits: 1=1ª, 2=2ª, 4=3ª */

/* ============================================================
   PRE-CÓMPUTO: por lado, matriz [orden 0-8][estado pitcher 0-3]
   donde estado = vuelta TTO 1/2/3 del abridor, 3 = bullpen.
   Después de esto, cada sim solo muestrea CDFs — muy rápido.
   sideInputs = {
     lineup: [9 × {bb,k,hr,d3,d2,s1}]  (rates ya vs mano del abridor)
     lineupVsBpn: [9 × rates]          (rates vs bullpen, sin platoon)
     starter: rates (ya vs lado del bateador si hay split)
       — starter puede ser [9 × rates] si se pasó por bateador
     bullpen: rates
     starterAvgBF: número esperado de bateadores del abridor
   }
   ============================================================ */
/* Los abridores permiten más carreras en la 1ª entrada (arrancan
   "fríos" y batea el top del lineup). Boost empírico de eventos. */
const INN1_MULT = 1.06;

function precomputeSide(sideInputs, lg, mods) {
  const grid = [];
  for (let b = 0; b < 9; b++) {
    const row = [];
    const starterRates = Array.isArray(sideInputs.starter)
      ? sideInputs.starter[b] : sideInputs.starter;
    for (let pass = 0; pass < 3; pass++) {
      row.push(paDistribution(sideInputs.lineup[b], starterRates, lg,
        { ...mods, ttoPass: pass }));
    }
    const bpnBat = (sideInputs.lineupVsBpn && sideInputs.lineupVsBpn[b]) || sideInputs.lineup[b];
    // índice 3: bullpen
    row.push(paDistribution(bpnBat, sideInputs.bullpen, lg, { ...mods, ttoPass: 0 }));
    // índice 4: 1ª entrada vs abridor (efecto primera entrada)
    row.push(paDistribution(sideInputs.lineup[b], starterRates, lg,
      { ...mods, ttoPass: 0, extraMult: INN1_MULT }));
    grid.push(row);
  }
  return grid;
}

/* Un PA: muestrea la CDF. Devuelve índice 0..6 (6 = out en juego). */
function samplePA(cdf, rng) {
  const u = rng();
  for (let i = 0; i < 6; i++) if (u < cdf[i]) return i;
  return 6;
}

/* Resuelve el evento sobre el estado de bases. Regresa carreras. */
function applyEvent(ev, state, rng) {
  // state = { bases, outs }
  let runs = 0;
  const b = state.bases;
  switch (ev) {
    case 0: { // BB / HBP: solo avances forzados
      if ((b & 1) && (b & 2) && (b & 4)) { runs = 1; state.bases = 7; }
      else if ((b & 1) && (b & 2)) state.bases = 7;
      else if ((b & 1) && (b & 4)) state.bases = 7;
      else if (b & 1) state.bases = (b | 2) | 1;
      else state.bases = b | 1;
      break;
    }
    case 1: // K
      state.outs++;
      break;
    case 2: { // HR: anotan todos
      runs = 1 + ((b & 1) ? 1 : 0) + ((b & 2) ? 1 : 0) + ((b & 4) ? 1 : 0);
      state.bases = 0;
      break;
    }
    case 3: { // Triple
      runs = ((b & 1) ? 1 : 0) + ((b & 2) ? 1 : 0) + ((b & 4) ? 1 : 0);
      state.bases = 4;
      break;
    }
    case 4: { // Doble
      let nb = 2;
      if (b & 4) runs++;
      if (b & 2) runs++;
      if (b & 1) {
        if (rng() < ADV.double_r1_scores) runs++;
        else nb |= 4;
      }
      state.bases = nb;
      break;
    }
    case 5: { // Sencillo
      let nb = 1;
      if (b & 4) runs++;
      if (b & 2) {
        if (rng() < ADV.single_r2_scores) runs++;
        else nb |= 4;
      }
      if (b & 1) {
        if (rng() < ADV.single_r1_to3 && !(nb & 4)) nb |= 4;
        else nb |= 2;
      }
      state.bases = nb;
      break;
    }
    case 6: { // Out en juego: error / DP / sacrificio / out productivo
      if (rng() < ADV.roe_rate) { // el fildeador falla: cuenta como sencillo
        return applyEvent(5, state, rng);
      }
      if (state.outs < 2) {
        if ((b & 1) && rng() < ADV.dp_rate) {
          state.outs += 2;
          state.bases = b & ~1; // corredor de 1ª eliminado
          break;
        }
        if ((b & 4) && rng() < ADV.sf_rate) {
          runs++; state.outs++;
          state.bases = b & ~4;
          break;
        }
        if ((b & 2) && !(b & 4) && rng() < ADV.prod_out) {
          state.outs++;
          state.bases = (b & ~2) | 4; // 2ª → 3ª con el out
          break;
        }
      }
      state.outs++;
      break;
    }
  }
  return runs;
}

/* ============================================================
   SIMULACIÓN COMPLETA DEL JUEGO
   gamePre = {
     away: { grid, starterAvgBF }, home: { grid, starterAvgBF }
   }
   Devuelve agregados de nSims juegos.
   ============================================================ */
function simulateGame(gamePre, nSims, seed) {
  const rng = makeRng(seed || 20260707);
  const MAXR = 30;
  const agg = {
    n: nSims,
    homeWins: 0, awayWins: 0,
    totalHist: new Float64Array(MAXR + 1),
    homeHist: new Float64Array(MAXR + 1),
    awayHist: new Float64Array(MAXR + 1),
    marginHist: new Map(), // home - away
    f5HomeWins: 0, f5AwayWins: 0, f5Ties: 0,
    f5TotalHist: new Float64Array(21),
    yrfi: 0,
    homeRunsSum: 0, awayRunsSum: 0, f5RunsSum: 0,
  };

  for (let s = 0; s < nSims; s++) {
    // estado por lado (persiste todo el juego)
    const sides = [
      { grid: gamePre.away.grid, order: 0, starterBF: 0, exitBF: sampleExitBF(gamePre.away.starterAvgBF, rng), runs: 0, f5: 0, inn1: 0 },
      { grid: gamePre.home.grid, order: 0, starterBF: 0, exitBF: sampleExitBF(gamePre.home.starterAvgBF, rng), runs: 0, f5: 0, inn1: 0 },
    ];
    const away = sides[0], home = sides[1];

    let inning = 1;
    while (true) {
      // parte alta (batea el visitante)
      away.runs += halfInning(away, rng, inning, null, null);
      if (inning === 5) away.f5 = away.runs;
      if (inning === 1) away.inn1 = away.runs;

      // parte baja: en la 9ª+ el local no batea si va ganando
      const homeMustBat = inning < 9 || home.runs <= away.runs;
      if (homeMustBat) {
        home.runs += halfInning(home, rng, inning,
          inning >= 9 ? away.runs : null, home.runs);
      }
      if (inning === 5) home.f5 = home.runs;
      if (inning === 1) home.inn1 = home.runs;

      if (inning >= 9 && home.runs !== away.runs) break;
      inning++;
      if (inning > 15) { // seguridad: casi nunca pasa
        if (rng() < 0.5) home.runs++; else away.runs++;
        break;
      }
    }

    // acumular
    const hr_ = Math.min(home.runs, MAXR), ar_ = Math.min(away.runs, MAXR);
    const tot = Math.min(home.runs + away.runs, MAXR);
    if (home.runs > away.runs) agg.homeWins++; else agg.awayWins++;
    agg.totalHist[tot]++; agg.homeHist[hr_]++; agg.awayHist[ar_]++;
    const m = home.runs - away.runs;
    agg.marginHist.set(m, (agg.marginHist.get(m) || 0) + 1);
    const f5t = Math.min(home.f5 + away.f5, 20);
    agg.f5TotalHist[f5t]++;
    if (home.f5 > away.f5) agg.f5HomeWins++;
    else if (away.f5 > home.f5) agg.f5AwayWins++;
    else agg.f5Ties++;
    if (home.inn1 + away.inn1 > 0) agg.yrfi++;
    agg.homeRunsSum += home.runs; agg.awayRunsSum += away.runs;
    agg.f5RunsSum += home.f5 + away.f5;
  }
  return agg;
}

/* BF del abridor en esta sim: normal alrededor de su promedio. */
function sampleExitBF(avgBF, rng) {
  const z = (rng() + rng() + rng() + rng() - 2) * 1.7; // ~N(0,1) aprox
  return Math.max(10, Math.min(32, Math.round((avgBF || 20) + z * 4)));
}

/* Media entrada. walkOffAway/homeRunsSoFar: en 9ª+ baja, el inning
   corta en cuanto el local toma la ventaja (walk-off). */
function halfInning(side, rng, inning, walkOffAway, homeRunsSoFar) {
  const state = { bases: 0, outs: 0 };
  let runs = 0;
  // extras: corredor fantasma en 2ª desde la 10ª
  if (inning >= 10) state.bases = 2;

  while (state.outs < 3) {
    // ¿sigue el abridor? (sale al llegar a su BF esperado o en la 4ª vuelta)
    let pitcherIdx;
    if (side.starterBF < side.exitBF) {
      pitcherIdx = inning === 1 ? 4 : Math.min(Math.floor(side.starterBF / 9), 2);
      side.starterBF++;
    } else {
      pitcherIdx = 3; // bullpen
    }
    const cdf = side.grid[side.order][pitcherIdx];
    const ev = samplePA(cdf, rng);
    side.order = (side.order + 1) % 9;
    runs += applyEvent(ev, state, rng);

    if (walkOffAway !== null && walkOffAway !== undefined &&
        homeRunsSoFar + runs > walkOffAway) {
      break; // walk-off: el juego termina en cuanto el local pasa al frente
    }
  }
  return runs;
}

/* ============================================================
   MERCADOS a partir de los agregados de la simulación.
   Salida: SOLO probabilidades y esperados — nada del modelo.
   ============================================================ */
function line05(x) { return Math.max(0.5, Math.round(x - 0.5) + 0.5); } // .5 más cercana

function marketsFromAgg(agg) {
  const n = agg.n;
  const expHome = agg.homeRunsSum / n;
  const expAway = agg.awayRunsSum / n;
  const expTotal = expHome + expAway;

  const pOver = line => {
    let c = 0;
    for (let r = Math.ceil(line); r < agg.totalHist.length; r++) c += agg.totalHist[r];
    return c / n;
  };
  const mainLine = line05(expTotal);
  const altLines = [mainLine - 1, mainLine - 0.5, mainLine, mainLine + 0.5, mainLine + 1]
    .filter(l => l >= 5.5)
    .map(l => ({ line: l, over: round4(pOver(l)), under: round4(1 - pOver(l)) }));

  // run line ±1.5
  let homeMinus15 = 0, awayMinus15 = 0;
  for (const [m, c] of agg.marginHist) {
    if (m >= 2) homeMinus15 += c;
    if (m <= -2) awayMinus15 += c;
  }

  const teamLine = (hist, exp) => {
    const line = line05(exp);
    let over = 0;
    for (let r = Math.ceil(line); r < hist.length; r++) over += hist[r];
    return { line, over: round4(over / n), under: round4(1 - over / n) };
  };

  const f5Line = line05(agg.f5RunsSum / n);
  let f5Over = 0;
  for (let r = Math.ceil(f5Line); r < agg.f5TotalHist.length; r++) f5Over += agg.f5TotalHist[r];

  return {
    moneyline: { home: round4(agg.homeWins / n), away: round4(agg.awayWins / n) },
    run_line: {
      home_minus_1_5: round4(homeMinus15 / n),
      home_plus_1_5: round4(1 - awayMinus15 / n),
      away_minus_1_5: round4(awayMinus15 / n),
      away_plus_1_5: round4(1 - homeMinus15 / n),
    },
    total: { line: mainLine, over: round4(pOver(mainLine)), under: round4(1 - pOver(mainLine)) },
    totals_alt: altLines,
    f5: {
      home: round4(agg.f5HomeWins / n),
      away: round4(agg.f5AwayWins / n),
      tie: round4(agg.f5Ties / n),
      total: { line: f5Line, over: round4(f5Over / n), under: round4(1 - f5Over / n) },
    },
    team_totals: {
      home: teamLine(agg.homeHist, expHome),
      away: teamLine(agg.awayHist, expAway),
    },
    nrfi: { no_run: round4(1 - agg.yrfi / n), run: round4(agg.yrfi / n) },
    // Distribución del total de carreras (0..19, y 20 = "20+").
    // Es probabilidad derivada, seguro exponerla: no revela el modelo.
    total_dist: (() => {
      const d = [];
      let tail = 0;
      for (let r = 0; r < agg.totalHist.length; r++) {
        if (r < 20) d.push(round4(agg.totalHist[r] / n));
        else tail += agg.totalHist[r];
      }
      d.push(round4(tail / n));
      return d;
    })(),
    expected: {
      home_runs: round2(expHome),
      away_runs: round2(expAway),
      total: round2(expTotal),
    },
  };
}

function round4(x) { return Math.round(x * 10000) / 10000; }
function round2(x) { return Math.round(x * 100) / 100; }

module.exports = {
  FALLBACK_LEAGUE, OUTCOMES,
  makeRng, oddsRatio, paDistribution, precomputeSide,
  simulateGame, marketsFromAgg,
};
