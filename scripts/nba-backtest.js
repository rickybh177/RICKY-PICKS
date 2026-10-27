#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — modelo NBA contra la temporada 2025-26
   (y, como segundo pliegue, 2024-25).

   Validación honesta, sin fuga de datos (receta de nfl-backtest):
   1. Ajusta ratings SOLO con las temporadas anteriores (2023-24 y
      2024-25 para el pliegue principal), asOf 1-oct, y aplica el
      carry de temporada nueva.
   2. Recorre la temporada de prueba en orden: predice cada juego con
      los ratings vigentes (misma learnRatings del runtime, con
      onPredict) y DESPUÉS aprende el resultado. Las ausencias de cada
      juego se leen del boxscore (quién de la rotación no jugó): es la
      versión perfecta del reporte de lesiones, así que el coeficiente
      que sale es un TECHO para producción.
   3. Reporta: Brier/log-loss del ML vs el cierre del mercado, MAE del
      margen y del total vs el cierre, sensibilidad a carry/K/ausencias
      /descanso, calibración por decil, y rendimiento contra el cierre
      real (spread, total y ML con la regla de veredictos).

   Uso:  node scripts/nba-backtest.js [--fold 2025]
   ============================================================ */
const { seasons, absenceLookup, restLookup, fitWith, estimateRest, measureDispersion, ALT_TEAMS } = require('./nba-common');
const { learnRatings } = require('../lib/nba/core');
const { normCdf, overProb, coverProb } = require('../lib/nba/engine');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const TEST_YEAR = Number(arg('--fold')) || 2026;
const FIT_YEARS = TEST_YEAR === 2026 ? [2024, 2025] : [2024];
const AS_OF = new Date(`${TEST_YEAR - 1}-10-01T00:00:00Z`).getTime();

const amToProb = am => (am == null ? null : am > 0 ? 100 / (am + 100) : -am / (-am + 100));
const devig = (a, b) => { if (a == null || b == null) return [a, b]; const s = a + b; return [a / s, b / s]; };

function walk(testSet, priors, league, params, absences) {
  const rows = [];
  learnRatings(testSet, { priors, league, params, absences, altTeams: ALT_TEAMS }, (g, e, ctx) => rows.push({ g, expH: e.expH, expA: e.expA, poss: e.poss, ctx }));
  return rows;
}

function metrics(rows, sdM = 13.2) {
  let brier = 0, ll = 0, nMl = 0, mae = 0, maeT = 0, biasT = 0, biasM = 0, n = 0;
  let brierMkt = 0, llMkt = 0, nMkt = 0, maeMkt = 0, maeTMkt = 0, nCl = 0;
  for (const { g, expH, expA } of rows) {
    const margin = g.home.score - g.away.score, total = g.home.score + g.away.score;
    const em = expH - expA, et = expH + expA;
    const pH = 1 - normCdf((0.5 - em) / sdM);
    const y = margin > 0 ? 1 : 0;
    brier += (pH - y) ** 2; ll -= y * Math.log(pH) + (1 - y) * Math.log(1 - pH); nMl++;
    mae += Math.abs(margin - em); maeT += Math.abs(total - et); biasT += total - et; biasM += margin - em; n++;
    if (g.close && g.close.ml_home != null && g.close.ml_away != null) {
      const [mh] = devig(amToProb(g.close.ml_home), amToProb(g.close.ml_away));
      brierMkt += (mh - y) ** 2; llMkt -= y * Math.log(mh) + (1 - y) * Math.log(1 - mh); nMkt++;
    }
    if (g.close && g.close.spread != null && g.close.total != null) {
      maeMkt += Math.abs(margin + g.close.spread); maeTMkt += Math.abs(total - g.close.total); nCl++;
    }
  }
  return {
    brier: brier / nMl, ll: ll / nMl, mae: mae / n, maeT: maeT / n, biasT: biasT / n, biasM: biasM / n, n,
    brierMkt: brierMkt / nMkt, llMkt: llMkt / nMkt, maeMkt: maeMkt / nCl, maeTMkt: maeTMkt / nCl,
  };
}
const f3 = x => x.toFixed(3), f4 = x => x.toFixed(4), f2 = x => x.toFixed(2);
const sg = x => (x >= 0 ? '+' : '') + x.toFixed(2);

(async () => {
  const fitSet = seasons(FIT_YEARS);
  const testAll = seasons([TEST_YEAR]);
  const testSet = testAll.filter(g => g.seasontype === 2); // temporada regular
  console.log(`ajuste: ${fitSet.length} juegos (${FIT_YEARS.join('+')}) · prueba: ${testSet.length} juegos (${TEST_YEAR - 1}-${String(TEST_YEAR).slice(2)} regular)`);

  const absences = absenceLookup([...FIT_YEARS, TEST_YEAR]);
  const restAll = restLookup([...fitSet, ...testAll]);

  /* ---- 1. fit base (sin offsets) y efecto del descanso ---- */
  const fit0 = fitWith(fitSet, { asOf: AS_OF });
  const { REST, detail } = estimateRest(fitSet, fit0, restAll);
  console.log(`fit base: mu=${fit0.mu} hfa=${fit0.hfa} poss=${fit0.poss} · sd resid margen=${fit0.diag.resid_sd_margin} total=${fit0.diag.resid_sd_total}`);
  console.log('descanso (residuo de eficiencia pts/100, encogido):', JSON.stringify(REST), '· n:', Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.n])));

  /* ---- 2. base: mercado y localía pura ---- */
  {
    let w = 0, nn = 0; for (const g of testSet) { nn++; if (g.home.score > g.away.score) w++; }
    const p = w / nn; let b = 0; for (const g of testSet) b += (p - (g.home.score > g.away.score ? 1 : 0)) ** 2;
    console.log(`\nBASE localía pura (p=${f3(p)}): Brier ML=${f4(b / nn)}`);
  }

  /* ---- 3. sensibilidad ---- */
  const priorsWith = (fit, carry) => { const P = {}; for (const t in fit.ratings) P[t] = { off: fit.ratings[t].off * carry, def: fit.ratings[t].def * carry, pace: fit.ratings[t].pace * carry }; return P; };
  const league = fit => ({ mu: fit.mu, hfa: fit.hfa, poss: fit.poss });

  console.log('\nCarry (cuánto de las temporadas previas se hereda; K=0.06, sin ausencias, descanso ON):');
  for (const carry of [0.4, 0.55, 0.7, 0.85, 1.0]) {
    const m = metrics(walk(testSet, priorsWith(fit0, carry), league(fit0), { K: 0.06, KP: 0.06, REST }, null));
    console.log(`  carry=${carry}: Brier=${f4(m.brier)} · MAE margen=${f2(m.mae)} · MAE total=${f2(m.maeT)}`);
  }
  const CARRY = 0.7;

  console.log(`\nK (aprendizaje de eficiencia, carry=${CARRY}):`);
  for (const k of [0, 0.03, 0.05, 0.07, 0.1, 0.15]) {
    const m = metrics(walk(testSet, priorsWith(fit0, CARRY), league(fit0), { K: k, KP: 0.06, REST }, null));
    console.log(`  K=${k}: Brier=${f4(m.brier)} · MAE margen=${f2(m.mae)} · MAE total=${f2(m.maeT)}`);
  }
  console.log(`\nKP (aprendizaje del ritmo):`);
  for (const kp of [0, 0.03, 0.06, 0.1, 0.15]) {
    const m = metrics(walk(testSet, priorsWith(fit0, CARRY), league(fit0), { K: 0.06, KP: kp, REST }, null));
    console.log(`  KP=${kp}: MAE total=${f2(m.maeT)} · MAE margen=${f2(m.mae)}`);
  }

  console.log('\nDescanso ON/OFF (K=0.06):');
  for (const on of [false, true]) {
    const m = metrics(walk(testSet, priorsWith(fit0, CARRY), league(fit0), { K: 0.06, KP: 0.06, REST: on ? REST : undefined }, null));
    console.log(`  ${on ? 'ON ' : 'OFF'}: Brier=${f4(m.brier)} · MAE margen=${f2(m.mae)} · MAE total=${f2(m.maeT)}`);
  }

  console.log('\nAUSENCIAS — coeficiente c sobre el Game Score de los ausentes (fit y walk-forward con el mismo c):');
  const fits = {};
  for (const c of [0, 0.15, 0.25, 0.3, 0.35, 0.5, 0.7]) {
    fits[c] = fitWith(fitSet, { asOf: AS_OF, REST, ABS_C: c, absences, rest: restAll });
    const m = metrics(walk(testSet, priorsWith(fits[c], CARRY), league(fits[c]), { K: 0.06, KP: 0.06, REST, ABS_C: c }, absences));
    console.log(`  c=${c}: Brier=${f4(m.brier)} · log-loss=${f4(m.ll)} · MAE margen=${f2(m.mae)} · MAE total=${f2(m.maeT)}`);
  }
  const ABS_C = 0.3;

  console.log('\nmuShift (corrección del entorno anotador) ON/OFF:');
  for (const on of [false, true]) {
    const m = metrics(walk(testSet, priorsWith(fits[ABS_C], CARRY), league(fits[ABS_C]), { K: 0.06, KP: 0.06, REST, ABS_C, MU_SHIFT_N: on ? 150 : 1e12 }, absences));
    console.log(`  ${on ? 'ON ' : 'OFF'}: sesgo total=${sg(m.biasT)} · MAE total=${f2(m.maeT)} · Brier=${f4(m.brier)}`);
  }
  console.log('\nSuerte en triples al aprender (fracción descontada: propia / del rival):');
  for (const [lo, ld] of [[0, 0], [0, 0.5], [0, 1], [0.3, 1], [0.5, 1], [0.5, 0.5]]) {
    const m = metrics(walk(testSet, priorsWith(fits[ABS_C], CARRY), league(fits[ABS_C]), { K: 0.06, KP: 0.06, REST, ABS_C, LUCK: { off: lo, def: ld } }, absences));
    console.log(`  off=${lo} def=${ld}: Brier=${f4(m.brier)} · log-loss=${f4(m.ll)} · MAE margen=${f2(m.mae)} · MAE total=${f2(m.maeT)}`);
  }
  console.log('\nAltitud (DEN/UTAH, extra de localía pts/100):');
  for (const alt of [0, 1, 2, 3]) {
    const m = metrics(walk(testSet, priorsWith(fits[ABS_C], CARRY), league(fits[ABS_C]), { K: 0.06, KP: 0.06, REST, ABS_C, ALT_HFA: alt }, absences));
    console.log(`  ALT_HFA=${alt}: MAE margen=${f4(m.mae)} · Brier=${f4(m.brier)}`);
  }

  /* ---- 4. pasada de producción ---- */
  const PROD = { K: 0.05, KP: 0.1, REST, ABS_C, ALT_HFA: 0, LUCK: { off: 0.5, def: 0.5 } };
  console.log(`\n=== PASADA DE PRODUCCIÓN (carry=${CARRY}, K=0.05, KP=0.1, c=${ABS_C}, suerte 3P 0.5/0.5, descanso ON) ===`);
  const rows = walk(testSet, priorsWith(fits[ABS_C], CARRY), league(fits[ABS_C]), PROD, absences);
  const disp = measureDispersion(rows);
  console.log('dispersión medida fuera de muestra:', JSON.stringify(disp));
  const m = metrics(rows, disp.SD_MARGIN);
  console.log(`MODELO : Brier ML=${f4(m.brier)} · log-loss=${f4(m.ll)} · MAE margen=${f2(m.mae)} · MAE total=${f2(m.maeT)} · sesgo total=${sg(m.biasT)} · sesgo margen=${sg(m.biasM)}`);
  console.log(`MERCADO: Brier ML=${f4(m.brierMkt)} · log-loss=${f4(m.llMkt)} · MAE margen=${f2(m.maeMkt)} · MAE total=${f2(m.maeTMkt)}   (cierre ESPN BET/DK/Caesars)`);

  // ¿cuánto aporta el modelo encima del mercado? peso óptimo del modelo en una mezcla
  {
    let best = null;
    for (let w = 0; w <= 1.0001; w += 0.05) {
      let s = 0, sT = 0, nn = 0;
      for (const { g, expH, expA } of rows) {
        if (!g.close || g.close.spread == null || g.close.total == null) continue;
        const em = w * (expH - expA) + (1 - w) * (-g.close.spread);
        const et = w * (expH + expA) + (1 - w) * g.close.total;
        s += Math.abs(g.home.score - g.away.score - em); sT += Math.abs(g.home.score + g.away.score - et); nn++;
      }
      const r = { w: +w.toFixed(2), mae: s / nn, maeT: sT / nn };
      if (!best || r.mae < best.mae) best = r;
      if (Math.abs(w - 0) < 1e-6 || Math.abs(w - 0.2) < 1e-6 || Math.abs(w - 0.4) < 1e-6 || Math.abs(w - 1) < 1e-6) console.log(`  mezcla w_modelo=${r.w}: MAE margen=${f3(r.mae)} · MAE total=${f3(r.maeT)}`);
    }
    console.log(`  peso óptimo del modelo en la mezcla de margen: ${best.w} (MAE ${f3(best.mae)})`);
  }

  // ¿qué sd calibra mejor? Brier del ML y del "cubre al cierre" por sd
  console.log('SD efectiva (Brier del ML · Brier de cubrir la línea de cierre):');
  for (const sd of [11.5, 12.5, 13.5, disp.SD_MARGIN]) {
    let b = 0, nb = 0, bc = 0, nc = 0;
    for (const { g, expH, expA } of rows) {
      const em = expH - expA;
      const pH = 1 - normCdf((0.5 - em) / sd);
      b += (pH - (g.home.score > g.away.score ? 1 : 0)) ** 2; nb++;
      if (g.close && g.close.spread != null) {
        const res = g.home.score - g.away.score + g.close.spread;
        if (res !== 0) { const pc = coverProb(g.close.spread, em, sd); bc += (pc - (res > 0 ? 1 : 0)) ** 2; nc++; }
      }
    }
    console.log(`  sd=${sd}: Brier ML=${f4(b / nb)} · Brier cubre=${f4(bc / nc)}`);
  }
  // calibración del favorito (decil)
  {
    const buckets = {};
    for (const { g, expH, expA } of rows) {
      const pH = 1 - normCdf((0.5 - (expH - expA)) / disp.SD_MARGIN);
      const p = Math.max(pH, 1 - pH), hit = (pH >= 0.5) === (g.home.score > g.away.score) ? 1 : 0;
      const b = Math.min(9, Math.floor(p * 10));
      buckets[b] = buckets[b] || { n: 0, h: 0, s: 0 }; buckets[b].n++; buckets[b].h += hit; buckets[b].s += p;
    }
    console.log('Calibración del favorito ML (decil → predicho vs real):');
    for (const b of Object.keys(buckets).sort()) { const x = buckets[b]; console.log(`  ${b * 10}–${+b * 10 + 10}%: pred ${(x.s / x.n * 100).toFixed(1)}% · real ${(x.h / x.n * 100).toFixed(1)}% (n=${x.n})`); }
  }

  /* ---- 5. CONTRA EL CIERRE: spread, total, ML ---- */
  console.log('\n=== CONTRA EL CIERRE DEL MERCADO ===');
  // spread: cuando el modelo discrepa ≥ t puntos de la línea de cierre, ¿cubre el lado del modelo?
  console.log('Spread — lado del modelo cuando discrepa de la línea de cierre (cubre %, sin pushes; 52.4% = punto de equilibrio a -110):');
  for (const t of [0, 1, 2, 3, 4, 6]) {
    let w = 0, l = 0;
    for (const { g, expH, expA } of rows) {
      if (!g.close || g.close.spread == null) continue;
      const em = expH - expA, L = g.close.spread; // L: línea del local
      const diff = em + L; // >0: el modelo ve al local mejor que la línea
      if (Math.abs(diff) < t) continue;
      const res = g.home.score - g.away.score + L;
      if (res === 0) continue;
      const homeSide = diff > 0;
      if ((res > 0) === homeSide) w++; else l++;
    }
    console.log(`  |Δ| ≥ ${t}: ${w}-${l} · ${(100 * w / Math.max(1, w + l)).toFixed(1)}% (n=${w + l})`);
  }
  console.log('Total — lado del modelo cuando discrepa de la línea de cierre:');
  for (const t of [0, 2, 4, 6, 8]) {
    let w = 0, l = 0;
    for (const { g, expH, expA } of rows) {
      if (!g.close || g.close.total == null) continue;
      const et = expH + expA, diff = et - g.close.total;
      if (Math.abs(diff) < t) continue;
      const res = g.home.score + g.away.score - g.close.total;
      if (res === 0) continue;
      if ((res > 0) === (diff > 0)) w++; else l++;
    }
    console.log(`  |Δ| ≥ ${t}: ${w}-${l} · ${(100 * w / Math.max(1, w + l)).toFixed(1)}% (n=${w + l})`);
  }

  // regla de veredictos (EV con blend hacia el mercado) a precios de cierre
  console.log('\nRegla de veredictos a precios de CIERRE (prob encogida hacia el devig del mercado; ROI por unidad plana):');
  const IMP110 = 110 / 210;
  for (const blend of [0.2, 0.35, 0.5]) {
    for (const bet of [0.02, 0.03, 0.05]) {
      const acc = { spread: { n: 0, w: 0, pnl: 0 }, total: { n: 0, w: 0, pnl: 0 }, ml: { n: 0, w: 0, pnl: 0 } };
      for (const { g, expH, expA } of rows) {
        if (!g.close) continue;
        const em = expH - expA, et = expH + expA;
        const c = g.close;
        const play = (key, p, imp, pMkt, won, push) => {
          if (p == null || imp == null || pMkt == null) return;
          const pb = (1 - blend) * p + blend * pMkt;
          const ev = pb / imp - 1;
          if (ev < bet || pb < 0.3) return;
          const A = acc[key]; A.n++;
          if (push) return;
          if (won) { A.w++; A.pnl += (1 - imp) / imp; } else A.pnl -= 1;
        };
        if (c.spread != null) {
          const pH = coverProb(c.spread, em, disp.SD_MARGIN);
          const impH = amToProb(c.spread_home_odds) || IMP110, impA = amToProb(c.spread_away_odds) || IMP110;
          const [dH, dA] = devig(impH, impA);
          const res = g.home.score - g.away.score + c.spread;
          play('spread', pH, impH, dH, res > 0, res === 0);
          play('spread', 1 - pH, impA, dA, res < 0, res === 0);
        }
        if (c.total != null) {
          const pO = overProb(c.total, et, disp.SD_TOTAL);
          const impO = amToProb(c.over_odds) || IMP110, impU = amToProb(c.under_odds) || IMP110;
          const [dO, dU] = devig(impO, impU);
          const res = g.home.score + g.away.score - c.total;
          play('total', pO, impO, dO, res > 0, res === 0);
          play('total', 1 - pO, impU, dU, res < 0, res === 0);
        }
        if (c.ml_home != null && c.ml_away != null) {
          const pH = 1 - normCdf((0.5 - em) / disp.SD_MARGIN);
          const impH = amToProb(c.ml_home), impA = amToProb(c.ml_away);
          const [dH, dA] = devig(impH, impA);
          const hw = g.home.score > g.away.score;
          play('ml', pH, impH, dH, hw, false);
          play('ml', 1 - pH, impA, dA, !hw, false);
        }
      }
      const txt = Object.entries(acc).map(([k, A]) => `${k}: n=${A.n} · acierto ${A.n ? (100 * A.w / A.n).toFixed(1) : '—'}% · ROI ${A.n ? sg(100 * A.pnl / A.n) : '—'}%`).join(' | ');
      console.log(`  blend=${blend} umbral=${bet}: ${txt}`);
    }
  }

  /* ---- 6. APERTURA → CIERRE: ¿el modelo anticipa el movimiento? ----
     Si el lado que el modelo prefiere en la línea de APERTURA es el que
     el mercado termina favoreciendo al CIERRE más de la mitad de las
     veces, el modelo lleva información que el mercado incorpora después
     (valor de cierre, CLV): la métrica estándar de un modelo que no
     necesariamente gana al cierre. */
  console.log('\n=== APERTURA → CIERRE (valor de cierre, CLV) ===');
  for (const t of [0, 1, 2, 3, 4]) {
    let agree = 0, disagree = 0, flat = 0, clvSum = 0;
    for (const { g, expH, expA } of rows) {
      if (!g.open || g.open.spread == null || !g.close || g.close.spread == null) continue;
      const diff = (expH - expA) + g.open.spread; // >0: el modelo ve al local mejor que la apertura
      if (Math.abs(diff) < t) continue;
      const move = g.close.spread - g.open.spread; // línea del local: baja = el mercado se fue con el local
      if (move === 0) { flat++; continue; }
      const towardModel = diff > 0 ? move < 0 : move > 0;
      if (towardModel) agree++; else disagree++;
      clvSum += (diff > 0 ? -move : move);
    }
    const n = agree + disagree;
    console.log(`  spread |Δ apertura| ≥ ${t}: la línea se movió hacia el modelo ${agree} vs en contra ${disagree} (${n ? (100 * agree / n).toFixed(1) : '—'}%, sin mover ${flat}) · CLV medio ${(n + flat) ? sg(clvSum / (n + flat)) : '—'} pts`);
  }
  for (const t of [0, 2, 4, 6]) {
    let agree = 0, disagree = 0, flat = 0, clvSum = 0;
    for (const { g, expH, expA } of rows) {
      if (!g.open || g.open.total == null || !g.close || g.close.total == null) continue;
      const diff = (expH + expA) - g.open.total;
      if (Math.abs(diff) < t) continue;
      const move = g.close.total - g.open.total;
      if (move === 0) { flat++; continue; }
      const towardModel = diff > 0 ? move > 0 : move < 0;
      if (towardModel) agree++; else disagree++;
      clvSum += (diff > 0 ? move : -move);
    }
    const n = agree + disagree;
    console.log(`  total  |Δ apertura| ≥ ${t}: hacia el modelo ${agree} vs en contra ${disagree} (${n ? (100 * agree / n).toFixed(1) : '—'}%, sin mover ${flat}) · CLV medio ${(n + flat) ? sg(clvSum / (n + flat)) : '—'} pts`);
  }
  // ¿cuánto del CLV son las ausencias (que el backtest conoce perfectas)? misma prueba con c=0
  {
    const rows0 = walk(testSet, priorsWith(fits[0], CARRY), league(fits[0]), { ...PROD, ABS_C: 0 }, null);
    for (const t of [2, 3, 4]) {
      let agree = 0, disagree = 0, w = 0, l = 0;
      for (const { g, expH, expA } of rows0) {
        if (!g.open || g.open.spread == null || !g.close || g.close.spread == null) continue;
        const diff = (expH - expA) + g.open.spread;
        if (Math.abs(diff) < t) continue;
        const move = g.close.spread - g.open.spread;
        if (move !== 0) { if (diff > 0 ? move < 0 : move > 0) agree++; else disagree++; }
        const res = g.home.score - g.away.score + g.open.spread;
        if (res !== 0) { if ((res > 0) === (diff > 0)) w++; else l++; }
      }
      console.log(`  SIN ausencias (c=0) spread |Δ apertura| ≥ ${t}: hacia el modelo ${(100 * agree / Math.max(1, agree + disagree)).toFixed(1)}% · cubre vs apertura ${w}-${l} (${(100 * w / Math.max(1, w + l)).toFixed(1)}%)`);
    }
  }
  // y contra la APERTURA: ¿cubre el lado del modelo?
  console.log('Spread — lado del modelo contra la línea de APERTURA (cubre %):');
  for (const t of [0, 2, 3, 4]) {
    let w = 0, l = 0;
    for (const { g, expH, expA } of rows) {
      if (!g.open || g.open.spread == null) continue;
      const diff = (expH - expA) + g.open.spread;
      if (Math.abs(diff) < t) continue;
      const res = g.home.score - g.away.score + g.open.spread;
      if (res === 0) continue;
      if ((res > 0) === (diff > 0)) w++; else l++;
    }
    console.log(`  |Δ| ≥ ${t}: ${w}-${l} · ${(100 * w / Math.max(1, w + l)).toFixed(1)}% (n=${w + l})`);
  }
  console.log('\nListo. Parámetros sugeridos para lib/nba/priors.js:', JSON.stringify({ CARRY, K: 0.06, KP: 0.06, ABS_C, REST, DISP: disp }));
})().catch(e => { console.error(e); process.exit(1); });
