#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — modelo NHL contra la temporada 2025-26
   (y, como segundo pliegue, 2024-25).

   Validación honesta, sin fuga de datos (receta de nba-backtest):
   1. Ajusta ratings SOLO con las temporadas anteriores, asOf 1-oct, y
      aplica el carry de temporada nueva. La dispersión del motor
      (pesos por diferencia, puerta vacía, tiempo extra, 1er periodo)
      también se mide SOLO con temporadas anteriores: walk-forward de
      cada temporada de ajuste (menos la primera) con ratings de las
      previas.
   2. Recorre la temporada de prueba en orden: predice cada juego con
      los ratings vigentes (misma learnRatings del runtime, con
      onPredict) y DESPUÉS aprende el resultado. El portero de cada
      juego se lee del boxscore (quién jugó): es la versión perfecta
      del "portero probable" de ESPN, así que lo que aporte es un TECHO
      para producción.
   3. Reporta: Brier/log-loss del ganador vs el cierre del mercado,
      calibración por decil, MAE del total, línea de gol ±1.5 y total
      contra el cierre (acierto, Brier y ROI con la regla de
      veredictos), resultado a 60 minutos, totales por equipo, 1er
      periodo, y apertura → cierre (CLV).

   Uso:  node scripts/nhl-backtest.js [--fold 2025|2027] [--quick] [--set K=0.03,SHOTS_W=0.65]
   ============================================================ */
const { seasons, restLookup, fitWith, estimateRest, measureDispersion } = require('./nhl-common');
const { learnRatings, goalieTable } = require('../lib/nhl/core');
const { markets, overFromDist } = require('../lib/nhl/engine');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const QUICK = process.argv.includes('--quick');
const TEST_YEAR = Number(arg('--fold')) || 2026;
const FIT_YEARS = [2023, 2024, 2025, 2026].filter(y => y < TEST_YEAR); // 2027 = lo que va de la 2026-27
const AS_OF = new Date(`${TEST_YEAR - 1}-10-01T00:00:00Z`).getTime();

/* ---- PRODUCCIÓN: los mismos valores que hornea build-nhl-priors ---- */
const PROD = { ...require('./nhl-params') };
/* --set K=0.03,SHOTS_W=0.65 → prueba rápida de otra combinación */
for (const kv of String(arg('--set') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); PROD[k] = isNaN(Number(v)) ? v : Number(v); }

const amToProb = am => (am == null ? null : am > 0 ? 100 / (am + 100) : -am / (-am + 100));
const devig = (a, b) => { if (a == null || b == null) return [null, null]; const s = a + b; return [a / s, b / s]; };
const f3 = x => x.toFixed(3), f4 = x => x.toFixed(4), f2 = x => x.toFixed(2);
const sg = x => (x >= 0 ? '+' : '') + x.toFixed(2);
const pct = x => (100 * x).toFixed(1) + '%';

const priorsWith = (fit, carry) => { const P = {}; for (const t in fit.ratings) P[t] = { att: fit.ratings[t].att * carry, def: fit.ratings[t].def * carry }; return P; };
const leagueOf = fit => ({ mu: fit.mu, hfa: fit.hfa, conv: fit.conv });

function walk(testSet, fit, carry, params, gt) {
  const rows = [];
  learnRatings(testSet, { priors: priorsWith(fit, carry), league: leagueOf(fit), params, goalies: gt && gt.G, teamRef: gt && gt.teamRef },
    (g, e, ctx) => rows.push({ g, lh: e.lh, la: e.la, ctx }));
  return rows;
}

/* métricas de una pasada con la dispersión dada */
function metrics(rows, disp) {
  const M = { n: 0, brier: 0, ll: 0, ll3: 0, maeT: 0, biasT: 0, biasM: 0, nMkt: 0, brierMkt: 0, llMkt: 0, brierOn: 0, llOn: 0, maeTMkt: 0, nT: 0 };
  for (const r of rows) {
    const { g } = r;
    const mk = r.mk = markets({ lamHome: r.lh, lamAway: r.la, disp, lines: g.close ? { pl: g.close.pl, total: g.close.total } : null });
    const y = g.home.score > g.away.score ? 1 : 0;
    const p = mk.moneyline.home;
    M.brier += (p - y) ** 2; M.ll -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    const d = g.home.reg - g.away.reg;
    M.ll3 -= Math.log(d > 0 ? mk.regulation.home : d === 0 ? mk.regulation.draw : mk.regulation.away);
    const total = g.home.score + g.away.score;
    M.maeT += Math.abs(total - mk.dist.exp_total); M.biasT += total - mk.dist.exp_total;
    M.biasM += (g.home.score - g.away.score) - mk.puck_line.exp_margin;
    M.n++;
    if (g.close && g.close.ml_home != null && g.close.ml_away != null) {
      const [mh] = devig(amToProb(g.close.ml_home), amToProb(g.close.ml_away));
      r.pMkt = mh;
      M.brierMkt += (mh - y) ** 2; M.llMkt -= y * Math.log(mh) + (1 - y) * Math.log(1 - mh);
      M.brierOn += (p - y) ** 2; M.llOn -= y * Math.log(p) + (1 - y) * Math.log(1 - p); M.nMkt++;
    }
    if (g.close && g.close.total != null) { M.maeTMkt += Math.abs(total - g.close.total); M.nT++; }
  }
  for (const k of ['brier', 'll', 'll3', 'maeT', 'biasT', 'biasM']) M[k] /= M.n;
  for (const k of ['brierMkt', 'llMkt', 'brierOn', 'llOn']) M[k] /= Math.max(1, M.nMkt);
  M.maeTMkt /= Math.max(1, M.nT);
  return M;
}
const line = (label, m) => console.log(`  ${label}: Brier=${f4(m.brier)} · log-loss=${f4(m.ll)} · LL 60min=${f4(m.ll3)} · MAE total=${f3(m.maeT)}`);

(async () => {
  const fitSet = seasons(FIT_YEARS);
  const testAll = seasons([TEST_YEAR]);
  const testSet = testAll.filter(g => g.seasontype === 2);
  console.log(`ajuste: ${fitSet.length} juegos (${FIT_YEARS.join('+')}) · prueba: ${testSet.length} juegos (${TEST_YEAR - 1}-${String(TEST_YEAR).slice(2)} regular)`);
  const restAll = restLookup([...fitSet, ...testAll]);

  /* ---- dispersión FUERA DE MUESTRA: walk-forward de la última
     temporada de ajuste con ratings de las anteriores ---- */
  const dispYears = FIT_YEARS.slice(1);
  const fitterP = p => ({ SHOTS_W: p.SHOTS_W, SHOT_KIND: p.SHOT_KIND, EN_OUT: p.EN_OUT });
  function dispersionFor(p, REST) {
    const rows = [];
    for (const y of dispYears) {
      const fs = seasons(FIT_YEARS.filter(x => x < y));
      const fit = fitWith(fs, { asOf: new Date(`${y - 1}-10-01T00:00:00Z`).getTime(), halfLife: p.HALF_LIFE, params: fitterP(p), REST, rest: restAll });
      const gt = goalieTable(fs, leagueOf(fit), { params: p });
      rows.push(...walk(seasons([y]).filter(g => g.seasontype === 2), fit, p.CARRY, { ...p, REST }, gt));
    }
    return measureDispersion(rows);
  }
  /* una corrida completa con parámetros p → { rows, m, disp } */
  const fitCache = new Map();
  function run(p, { restOn = true, disp } = {}) {
    const key = JSON.stringify([fitterP(p), p.HALF_LIFE, restOn]);
    let c = fitCache.get(key);
    if (!c) {
      const fit0 = fitWith(fitSet, { asOf: AS_OF, halfLife: p.HALF_LIFE, params: fitterP(p) });
      const est = estimateRest(fitSet, fit0, restAll);
      const REST = restOn ? est.REST : { b2b_att: 0, b2b_def: 0 };
      const fit = restOn ? fitWith(fitSet, { asOf: AS_OF, halfLife: p.HALF_LIFE, params: fitterP(p), REST, rest: restAll }) : fit0;
      c = { fit, REST, est, gt: goalieTable(fitSet, leagueOf(fit), { params: p }) };
      fitCache.set(key, c);
    }
    const rows = walk(testSet, c.fit, p.CARRY, { ...p, REST: c.REST }, c.gt);
    const D = disp || dispersionFor(p, c.REST);
    return { rows, m: metrics(rows, D), disp: D, fit: c.fit, REST: c.REST, est: c.est };
  }

  const base = run(PROD);
  console.log(`fit: goles limpios por equipo=${base.fit.diag.goals_per_team} · localía=${f4(base.fit.hfa)} (log) · conversión por tiro a puerta=${base.fit.conv.sog}`);
  console.log(`segundo juego en dos noches (log, encogido): ${JSON.stringify(base.REST)} · crudo: ${JSON.stringify(base.est.detail)}`);
  console.log(`dispersión medida en ${dispYears.map(y => `${y - 1}-${String(y).slice(2)}`).join(' y ')} (fuera de muestra): ${JSON.stringify(base.disp)}`);
  const DISP = base.disp;

  /* ---- base: localía pura ---- */
  {
    let w = 0; for (const g of testSet) if (g.home.score > g.away.score) w++;
    const p = w / testSet.length; let b = 0, l = 0;
    for (const g of testSet) { const y = g.home.score > g.away.score ? 1 : 0; b += (p - y) ** 2; l -= y * Math.log(p) + (1 - y) * Math.log(1 - p); }
    console.log(`\nBASE localía pura (p=${f3(p)}): Brier=${f4(b / testSet.length)} · log-loss=${f4(l / testSet.length)}`);
  }

  /* ---- sensibilidad (cada grid mueve UN parámetro sobre producción) ---- */
  if (!QUICK) {
    const grid = (title, key, values, fmt) => {
      console.log(`\n${title}`);
      for (const v of values) {
        const p = { ...PROD, ...(typeof key === 'function' ? key(v) : { [key]: v }) };
        line(fmt ? fmt(v) : `${key}=${v}`, run(p, { disp: DISP }).m);
      }
    };
    grid('Carry (cuánto del rating previo se hereda):', 'CARRY', [0.5, 0.65, 0.8, 0.9, 1.0]);
    grid('K (aprendizaje por resultado):', 'K', [0, 0.01, 0.015, 0.02, 0.03, 0.045]);
    grid('Half-life del ajuste (días):', 'HALF_LIFE', [200, 300, 450, 700]);
    grid('Tiros en el objetivo de aprendizaje — tiros a puerta (peso):', v => ({ SHOTS_W: v, SHOT_KIND: 'sog' }), [0, 0.25, 0.5, 0.65, 0.8, 1], v => `sog w=${v}`);
    grid('… tiros a puerta + fallados (Fenwick):', v => ({ SHOTS_W: v, SHOT_KIND: 'fen' }), [0.25, 0.5, 0.65, 0.8, 1], v => `fen w=${v}`);
    grid('… + bloqueados (Corsi):', v => ({ SHOTS_W: v, SHOT_KIND: 'cor' }), [0.25, 0.5, 0.65, 0.8, 1], v => `cor w=${v}`);
    grid('Goles a puerta vacía fuera del objetivo (fracción):', 'EN_OUT', [0, 0.5, 1]);
    console.log('\nSegundo juego en dos noches ON/OFF:');
    line('OFF', run(PROD, { restOn: false, disp: DISP }).m);
    line('ON ', run(PROD, { restOn: true, disp: DISP }).m);
    grid('PORTERO — peso del diferencial del titular (portero real del boxscore = techo):', 'G_C', [0, 0.5, 1, 1.5, 2, 3]);
    grid('… encogimiento del nivel del portero (tiros, con peso 1):', v => ({ G_C: 1, G_N0: v }), [800, 1500, 2000, 3000, 5000], v => `G_N0=${v}`);
    grid('muShift (corrección del entorno goleador) ON/OFF:', 'MU_SHIFT_N', [1e12, 150], v => (v > 1e6 ? 'OFF' : 'ON '));
    console.log('\nMotor: qué aporta cada pieza (misma pasada, distinta dispersión):');
    line('Poisson independiente, sin puerta vacía aparte', metrics(run({ ...PROD, EN_OUT: 0 }, { disp: DISP }).rows, { ...DISP, MARGIN_W: [1, 1, 1, 1], EN: {} }));
    line('+ pesos por diferencia                        ', metrics(run({ ...PROD, EN_OUT: 0 }, { disp: DISP }).rows, { ...dispersionFor({ ...PROD, EN_OUT: 0 }, base.REST), EN: {} }));
    line('+ puerta vacía modelada aparte (producción)   ', base.m);
  }

  /* ================= PASADA DE PRODUCCIÓN ================= */
  console.log(`\n=== PASADA DE PRODUCCIÓN ${JSON.stringify(PROD)} ===`);
  const { rows, m } = base;
  console.log(`MODELO : Brier=${f4(m.brier)} · log-loss=${f4(m.ll)} · MAE total=${f3(m.maeT)} · sesgo total=${sg(m.biasT)} · sesgo margen=${sg(m.biasM)} · log-loss 60 min (3 vías)=${f4(m.ll3)}`);
  console.log(`MERCADO: Brier=${f4(m.brierMkt)} · log-loss=${f4(m.llMkt)} · MAE total (línea)=${f3(m.maeTMkt)}   (cierre ESPN BET / DraftKings, n=${m.nMkt})`);

  // mezcla modelo/mercado en log-loss del ganador
  {
    let best = null; const shown = [];
    for (let w = 0; w <= 1.0001; w += 0.05) {
      let l = 0, n = 0;
      for (const r of rows) { if (r.pMkt == null) continue; const p = w * r.mk.moneyline.home + (1 - w) * r.pMkt; const y = r.g.home.score > r.g.away.score ? 1 : 0; l -= y * Math.log(p) + (1 - y) * Math.log(1 - p); n++; }
      const v = { w: +w.toFixed(2), ll: l / n };
      if (!best || v.ll < best.ll) best = v;
      if ([0, 0.2, 0.4, 1].some(x => Math.abs(x - w) < 1e-6)) shown.push(`w=${v.w}: ${f4(v.ll)}`);
    }
    console.log(`  mezcla modelo/cierre (log-loss): ${shown.join(' · ')} · óptimo w_modelo=${best.w} (${f4(best.ll)})`);
  }

  // calibración del favorito
  {
    const buckets = {};
    for (const r of rows) {
      const pH = r.mk.moneyline.home, p = Math.max(pH, 1 - pH), hit = (pH >= 0.5) === (r.g.home.score > r.g.away.score) ? 1 : 0;
      const b = Math.min(15, Math.floor(p * 20));
      (buckets[b] = buckets[b] || { n: 0, h: 0, s: 0 }); buckets[b].n++; buckets[b].h += hit; buckets[b].s += p;
    }
    console.log('Calibración del favorito (ganador, con tiempo extra): predicho → real');
    for (const b of Object.keys(buckets).sort((a, c) => a - c)) { const x = buckets[b]; console.log(`  ${b * 5}–${+b * 5 + 5}%: pred ${pct(x.s / x.n)} · real ${pct(x.h / x.n)} (n=${x.n})`); }
    let hit = 0; for (const r of rows) if ((r.mk.moneyline.home >= 0.5) === (r.g.home.score > r.g.away.score)) hit++;
    let hitM = 0, nM = 0; for (const r of rows) if (r.pMkt != null) { nM++; if ((r.pMkt >= 0.5) === (r.g.home.score > r.g.away.score)) hitM++; }
    console.log(`  acierto del favorito: modelo ${pct(hit / rows.length)} · mercado ${pct(hitM / nM)}`);
  }

  // calibración genérica por cubetas de una probabilidad
  const calib = (title, items, edges = [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 1.01]) => {
    const B = edges.slice(0, -1).map(() => ({ n: 0, s: 0, h: 0 }));
    let br = 0, n = 0;
    for (const [p, y] of items) { if (p == null) continue; const k = edges.findIndex((e, i) => p >= e && p < edges[i + 1]); B[k].n++; B[k].s += p; B[k].h += y; br += (p - y) ** 2; n++; }
    console.log(`${title} (n=${n}, Brier ${f4(br / n)}): ` + B.filter(b => b.n >= 15).map(b => `${pct(b.s / b.n)}→${pct(b.h / b.n)} (${b.n})`).join(' · '));
  };

  console.log('\nCalibración de mercados (predicho → real):');
  calib('  60 min · gana local', rows.map(r => [r.mk.regulation.home, r.g.home.reg > r.g.away.reg ? 1 : 0]));
  calib('  60 min · empate    ', rows.map(r => [r.mk.regulation.draw, r.g.home.reg === r.g.away.reg ? 1 : 0]), [0, 0.2, 0.215, 0.225, 0.235, 0.25, 1.01]);
  calib('  local −1.5         ', rows.map(r => [r.mk.puck_line.home_minus, r.g.home.score - r.g.away.score >= 2 ? 1 : 0]), [0, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 1.01]);
  calib('  local +1.5         ', rows.map(r => [r.mk.puck_line.home_plus, r.g.home.score - r.g.away.score >= -1 ? 1 : 0]), [0, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 1.01]);
  for (const L of [5.5, 6.5]) calib(`  más de ${L}         `, rows.map(r => [overFromDist(r.mk._raw.td, L), r.g.home.score + r.g.away.score > L ? 1 : 0]), [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 1.01]);
  calib('  total por equipo (más de su línea)', rows.flatMap(r => [[r.mk.team_totals.home.over, r.g.home.score > r.mk.team_totals.home.line ? 1 : 0], [r.mk.team_totals.away.over, r.g.away.score > r.mk.team_totals.away.line ? 1 : 0]]));
  calib('  1er periodo · más de 1.5', rows.map(r => [r.mk.first_period.over, r.g.home.p[0] + r.g.away.p[0] > 1.5 ? 1 : 0]), [0, 0.45, 0.5, 0.55, 0.6, 1.01]);
  calib('  1er periodo · local arriba', rows.map(r => [r.mk.first_period.home, r.g.home.p[0] > r.g.away.p[0] ? 1 : 0]), [0, 0.28, 0.32, 0.36, 0.4, 1.01]);

  /* ================= CONTRA EL CIERRE ================= */
  console.log('\n=== CONTRA EL CIERRE DEL MERCADO ===');
  // línea de gol y total: probabilidad del modelo vs la del mercado (devig) en la línea de cierre
  {
    let bM = 0, bK = 0, n = 0, hit = 0, hitK = 0;
    for (const r of rows) {
      const c = r.g.close; if (!c || c.pl == null || c.pl_home_odds == null || c.pl_away_odds == null) continue;
      const res = r.g.home.score - r.g.away.score + c.pl; if (res === 0) continue;
      const y = res > 0 ? 1 : 0; const [dk] = devig(amToProb(c.pl_home_odds), amToProb(c.pl_away_odds));
      const p = r.mk.puck_line.home_cover;
      bM += (p - y) ** 2; bK += (dk - y) ** 2; n++; if ((p >= 0.5) === (y === 1)) hit++; if ((dk >= 0.5) === (y === 1)) hitK++;
    }
    console.log(`Línea de gol (±1.5 del cierre, n=${n}): Brier modelo ${f4(bM / n)} · mercado ${f4(bK / n)} · acierto del lado más probable: modelo ${pct(hit / n)} · mercado ${pct(hitK / n)}`);
  }
  {
    let bM = 0, bK = 0, n = 0, hit = 0, hitK = 0;
    for (const r of rows) {
      const c = r.g.close; if (!c || c.total == null || c.over_odds == null || c.under_odds == null) continue;
      const res = r.g.home.score + r.g.away.score - c.total; if (res === 0) continue;
      const y = res > 0 ? 1 : 0; const [dk] = devig(amToProb(c.over_odds), amToProb(c.under_odds));
      const p = r.mk.total.over;
      bM += (p - y) ** 2; bK += (dk - y) ** 2; n++; if ((p >= 0.5) === (y === 1)) hit++; if ((dk >= 0.5) === (y === 1)) hitK++;
    }
    console.log(`Total (línea del cierre, n=${n}): Brier modelo ${f4(bM / n)} · mercado ${f4(bK / n)} · acierto del lado más probable: modelo ${pct(hit / n)} · mercado ${pct(hitK / n)}`);
  }

  // ganador: cuando el modelo discrepa del cierre ≥ t puntos de probabilidad, ¿quién tiene razón?
  console.log('Ganador — apostar el lado que el modelo ve MEJOR que el cierre (unidad plana a precio de cierre):');
  for (const t of [0, 0.02, 0.04, 0.06, 0.08, 0.1]) {
    let n = 0, w = 0, pnl = 0;
    for (const r of rows) {
      const c = r.g.close; if (r.pMkt == null) continue;
      const diff = r.mk.moneyline.home - r.pMkt; if (Math.abs(diff) < t) continue;
      const home = diff > 0; const imp = amToProb(home ? c.ml_home : c.ml_away);
      const won = home === (r.g.home.score > r.g.away.score);
      n++; if (won) { w++; pnl += (1 - imp) / imp; } else pnl -= 1;
    }
    console.log(`  |Δprob| ≥ ${t}: n=${n} · gana ${pct(w / Math.max(1, n))} · ROI ${sg(100 * pnl / Math.max(1, n))}%`);
  }

  // referencia: ¿qué pasa apostando a ciegas? (si el no favorito ya deja dinero, el "valor" del modelo sería solo eso)
  {
    const acc = { fav: [0, 0, 0], dog: [0, 0, 0], home: [0, 0, 0], away: [0, 0, 0] };
    const add = (k, imp, won) => { acc[k][0]++; if (won) { acc[k][1]++; acc[k][2] += (1 - imp) / imp; } else acc[k][2] -= 1; };
    for (const r of rows) {
      const c = r.g.close; if (r.pMkt == null) continue;
      const iH = amToProb(c.ml_home), iA = amToProb(c.ml_away), hw = r.g.home.score > r.g.away.score;
      add('home', iH, hw); add('away', iA, !hw);
      if (iH >= iA) { add('fav', iH, hw); add('dog', iA, !hw); } else { add('fav', iA, !hw); add('dog', iH, hw); }
    }
    console.log('  referencia a ciegas (cierre): ' + Object.entries({ favorito: acc.fav, 'no favorito': acc.dog, local: acc.home, visita: acc.away }).map(([k, a]) => `${k} gana ${pct(a[1] / a[0])} ROI ${sg(100 * a[2] / a[0])}%`).join(' · '));
  }

  // regla de veredictos a precios de cierre
  console.log('\nRegla de veredictos a precios de CIERRE (prob encogida hacia el devig del mercado; ROI por unidad plana):');
  for (const blend of [0.3, 0.5, 0.65]) {
    for (const bet of [0.02, 0.04, 0.06]) {
      const acc = { ml: { n: 0, w: 0, pnl: 0 }, pl: { n: 0, w: 0, pnl: 0 }, total: { n: 0, w: 0, pnl: 0 } };
      const play = (key, p, imp, pMkt, won, push, floor) => {
        if (p == null || imp == null || pMkt == null) return;
        const pb = (1 - blend) * p + blend * pMkt;
        if (pb / imp - 1 < bet || pb < floor) return;
        const A = acc[key]; A.n++;
        if (push) return;
        if (won) { A.w++; A.pnl += (1 - imp) / imp; } else A.pnl -= 1;
      };
      for (const r of rows) {
        const c = r.g.close; if (!c) continue;
        const { g, mk } = r;
        if (c.ml_home != null && c.ml_away != null) {
          const iH = amToProb(c.ml_home), iA = amToProb(c.ml_away); const [dH, dA] = devig(iH, iA);
          const hw = g.home.score > g.away.score;
          play('ml', mk.moneyline.home, iH, dH, hw, false, 0.3); play('ml', mk.moneyline.away, iA, dA, !hw, false, 0.3);
        }
        if (c.pl != null && c.pl_home_odds != null && c.pl_away_odds != null) {
          const iH = amToProb(c.pl_home_odds), iA = amToProb(c.pl_away_odds); const [dH, dA] = devig(iH, iA);
          const res = g.home.score - g.away.score + c.pl;
          play('pl', mk.puck_line.home_cover, iH, dH, res > 0, res === 0, 0.25); play('pl', 1 - mk.puck_line.home_cover, iA, dA, res < 0, res === 0, 0.25);
        }
        if (c.total != null && c.over_odds != null && c.under_odds != null) {
          const iO = amToProb(c.over_odds), iU = amToProb(c.under_odds); const [dO, dU] = devig(iO, iU);
          const res = g.home.score + g.away.score - c.total;
          play('total', mk.total.over, iO, dO, res > 0, res === 0, 0.3); play('total', 1 - mk.total.over, iU, dU, res < 0, res === 0, 0.3);
        }
      }
      const txt = Object.entries(acc).map(([k, A]) => `${k}: n=${A.n} · acierto ${A.n ? (100 * A.w / A.n).toFixed(1) : '—'}% · ROI ${A.n ? sg(100 * A.pnl / A.n) : '—'}%`).join(' | ');
      console.log(`  blend=${blend} umbral=${bet}: ${txt}`);
    }
  }

  /* ================= APERTURA → CIERRE ================= */
  console.log('\n=== APERTURA → CIERRE (valor de cierre, CLV) ===');
  for (const t of [0, 0.02, 0.04, 0.06, 0.08]) {
    let agree = 0, dis = 0, flat = 0, n = 0, w = 0, pnl = 0, clv = 0;
    for (const r of rows) {
      const o = r.g.open, c = r.g.close;
      if (!o || o.ml_home == null || o.ml_away == null || r.pMkt == null) continue;
      const [oh] = devig(amToProb(o.ml_home), amToProb(o.ml_away));
      const diff = r.mk.moneyline.home - oh; if (Math.abs(diff) < t) continue;
      const move = r.pMkt - oh;
      if (Math.abs(move) < 0.0025) flat++; else if ((move > 0) === (diff > 0)) agree++; else dis++;
      clv += diff > 0 ? move : -move;
      const home = diff > 0; const imp = amToProb(home ? o.ml_home : o.ml_away);
      const won = home === (r.g.home.score > r.g.away.score);
      n++; if (won) { w++; pnl += (1 - imp) / imp; } else pnl -= 1;
    }
    console.log(`  |Δprob vs apertura| ≥ ${t}: la línea se movió hacia el modelo ${agree} vs en contra ${dis} (${pct(agree / Math.max(1, agree + dis))}, sin mover ${flat}) · CLV medio ${sg(100 * clv / Math.max(1, n))} pts de prob · apostando a precio de APERTURA: n=${n} gana ${pct(w / Math.max(1, n))} ROI ${sg(100 * pnl / Math.max(1, n))}%`);
  }
  /* ================= PICK PRINCIPAL POR PARTIDO =================
     La misma regla del sitio (lib/nhl/verdicts.js), a precios de CIERRE
     y de APERTURA (ESPN solo guarda el moneyline de apertura): cuántos
     partidos terminan con un pick, de qué tipo, y cómo le va. */
  console.log('\n=== PICK PRINCIPAL POR PARTIDO (regla del sitio) ===');
  const { decide, sidesOf, RULES } = require('../lib/nhl/verdicts');
  const runMain = (which, R) => {
    const acc = { n: 0, withPick: 0, kinds: {} };
    for (const r of rows) {
      const { g, mk } = r;
      const c = g.close, o = g.open;
      let px;
      if (which === 'close') {
        if (!c || c.ml_home == null || c.ml_away == null) continue;
        px = { ml_home_imp: amToProb(c.ml_home), ml_away_imp: amToProb(c.ml_away), pl: c.pl, pl_home_imp: amToProb(c.pl_home_odds), pl_away_imp: amToProb(c.pl_away_odds), total: c.total, total_over_imp: amToProb(c.over_odds), total_under_imp: amToProb(c.under_odds) };
      } else {
        if (!o || o.ml_home == null || o.ml_away == null) continue;
        px = { ml_home_imp: amToProb(o.ml_home), ml_away_imp: amToProb(o.ml_away) };
      }
      acc.n++;
      const d = decide(sidesOf(mk, px), R);
      if (d.main == null) { const k = 'sin pick: ' + d.reason; (acc.kinds[k] = acc.kinds[k] || { n: 0, w: 0, pnl: 0, push: 0 }).n++; continue; }
      acc.withPick++;
      const row = d.rows[d.main];
      const A = (acc.kinds[row.kind + ' · ' + d.main] = acc.kinds[row.kind + ' · ' + d.main] || { n: 0, w: 0, pnl: 0, push: 0 });
      A.n++;
      const margin = g.home.score - g.away.score, total = g.home.score + g.away.score;
      let won, push = false;
      if (d.main === 'pl') { const res = margin + px.pl; push = res === 0; won = row.side === 'home' ? res > 0 : res < 0; }
      else if (d.main === 'total') { const res = total - px.total; push = res === 0; won = row.side === 'over' ? res > 0 : res < 0; }
      else won = row.side === 'home' ? margin > 0 : margin < 0;
      if (push) { A.push++; continue; }
      if (won) { A.w++; A.pnl += (1 - row.imp) / row.imp; } else A.pnl -= 1;
    }
    return acc;
  };
  const totals = a => { let W = 0, N = 0, P = 0; for (const k in a.kinds) { if (k.startsWith('sin pick')) continue; const A = a.kinds[k]; W += A.w; N += A.n - A.push; P += A.pnl; } return { W, N, P, txt: `con pick ${(100 * a.withPick / Math.max(1, a.n)).toFixed(0)}% · acierto ${(100 * W / Math.max(1, N)).toFixed(1)}% · ROI ${sg(100 * P / Math.max(1, N))}%` }; };
  const showMain = (label, acc) => {
    console.log(`  ${label}: ${acc.withPick} de ${acc.n} partidos con pick (${(100 * acc.withPick / Math.max(1, acc.n)).toFixed(0)}%)`);
    for (const k of Object.keys(acc.kinds).sort()) {
      const A = acc.kinds[k];
      if (k.startsWith('sin pick')) { console.log(`      ${k}: ${A.n}`); continue; }
      const dec = A.n - A.push;
      console.log(`      ${k.padEnd(18)} n=${A.n} · acierto ${(100 * A.w / Math.max(1, dec)).toFixed(1)}% · ROI ${sg(100 * A.pnl / Math.max(1, dec))}%`);
    }
    const t = totals(acc);
    console.log(`      TODOS LOS PICKS    n=${t.N} · acierto ${(100 * t.W / Math.max(1, t.N)).toFixed(1)}% · ROI ${sg(100 * t.P / Math.max(1, t.N))}%`);
  };
  showMain('CIERRE   (regla de producción)', runMain('close', RULES));
  showMain('APERTURA (regla de producción, solo ganador)', runMain('open', RULES));
  console.log('  Sensibilidad a precios de cierre:');
  const variants = [
    ['BLEND 0.3', { BLEND: 0.3 }], ['BLEND 0.65', { BLEND: 0.65 }],
    ['PROMO_EV 0.02', { PROMO_EV: 0.02 }], ['PROMO_EV 0.04 (sin promoción)', { PROMO_EV: 0.04 }],
    ['WIN_BAR 0.65', { WIN_BAR: 0.65 }],
    ['total entra a promoción', { PROMO: { ml: true, pl: true, total: true } }],
    ['total PICK con EV ≥ 4%', { BET_EV: { ml: 0.04, pl: 0.04, total: 0.04 } }],
    ['ganador solo por probabilidad (sin valor)', { BET_EV: { ml: 9, pl: 0.04, total: 0.06 }, PROMO: { ml: false, pl: true, total: false } }],
    ['línea de gol fuera (solo ganador y total)', { BET_EV: { ml: 0.04, pl: 9, total: 0.06 }, PROMO: { ml: true, pl: false, total: false } }],
    ['piso 0.4 en ganador y línea de gol', { FLOOR: { ml: 0.4, pl: 0.4, total: 0.3 } }],
    ['WIN_BAR 0.55', { WIN_BAR: 0.55 }],
    ['WIN_BAR 0.60', { WIN_BAR: 0.6 }],
    ['ganador probable solo si el precio no paga de menos (WIN_EV_TOL 0)', { WIN_EV_TOL: 0 }],
    ['WIN_EV_TOL 0.015', { WIN_EV_TOL: 0.015 }],
    ['WIN_EV_TOL 0.05', { WIN_EV_TOL: 0.05 }],
  ];
  for (const [label, over] of variants) console.log(`    ${label}: ${totals(runMain('close', { ...RULES, ...over })).txt}`);

  console.log('\nListo.');
})().catch(e => { console.error(e); process.exit(1); });
