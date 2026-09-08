#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — modelos de Europa (Premier, LaLiga,
   Bundesliga) contra una temporada completa ya jugada.

   Validación honesta, sin fuga de datos:
   1. Ajusta Dixon-Coles SOLO con partidos anteriores al primer
      juego de la temporada de prueba (asOf = ese día menos uno).
      Los ascendidos de esa temporada sin historia arrancan con
      el ancla de ascendido que sale del propio ajuste — igual
      que hace build-euro-priors.js para la temporada real.
   2. Recorre la temporada en orden: predice cada partido con los
      ratings vigentes, registra la predicción y DESPUÉS aprende
      el resultado. El ciclo (lambdas, muShift, sgdUpdate) es el
      de lib/euro/core.js, que es el mismo que corre el runtime:
      no hay una copia del modelo aquí que pueda divergir. Las
      estadísticas de un juego (tiros a puerta, con shotsW > 0)
      solo se usan DESPUÉS de registrar su predicción.
   3. Reporta Brier / log-loss / RPS del 1X2 contra la base de
      liga (frecuencias del set de ajuste), calibración del
      favorito por decil, O/U 2.5, ambos anotan, "seguros" de doble
      oportunidad a varias barras, marcador exacto top-1 y una
      cordura sin mercado: total y % de local predichos vs reales.
   4. CONTRA EL MERCADO: empareja cada partido con su cierre real
      (football-data.co.uk vía scripts/euro-history.js) y aplica la
      MISMA regla de veredictos del runtime (core.ev1x2 /
      core.evTotal con mktBlend y x2Floor) para medir cuántos BET/
      MAYBE salen, cuántos aciertan y su ROI a 1 unidad plana, por
      tipo de pick (local/empate/visita). Barre mktBlend × x2Floor
      sin volver a ajustar nada (el veredicto es post-proceso) y
      compara Brier del modelo vs mercado vs prob encogida. Los
      totales se miden en 2.5 (la única línea del CSV; el runtime
      usa la del consenso, que en Europa a veces es 3.5).

   Uso:  node scripts/euro-backtest.js <epl|laliga|bundesliga>
           --season 2025-26|2024-25
           [--K 0,0.025,0.035] [--halfLife 365,500] [--shotsW 0,0.3]
           [--noMuShift] [--json salida.json]
           [--mktBlend 0.22,0.3,0.4] [--x2Floor 0.2,0.3,0.35]
           [--book avg|pinnacle|b365] [--noOdds]
         Cada combinación halfLife × shotsW es un ajuste nuevo; cada
         K una pasada walk-forward. El detalle completo se imprime
         para la combinación principal (primer halfLife, primer
         shotsW, K = 0.025 si está en la lista).
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { LEAGUES } = require('../lib/euro/leagues');
const { getHistory, getClosingOdds } = require('./euro-history');
const { fitDixonColes } = require('../lib/euro/fit');
const { DEFAULT_CAL, withDefaults, ev1x2, bestValueIndex, evTotal } = require('../lib/euro/core');
/* métricas y walk-forward compartidos con scripts/ucl-backtest.js */
const { outcomeOf, score3, walkForward, evaluate } = require('./euro-metrics');

/* --flag valor  → { flag: 'valor' }; lo demás son posicionales */
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { out.flags[name] = next; i++; }
      else out.flags[name] = true;
    } else out._.push(a);
  }
  return out;
}
const numList = (s, dflt) => s == null || s === true ? dflt : String(s).split(',').map(Number).filter(n => isFinite(n));

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Uso: node scripts/euro-backtest.js <epl|laliga|bundesliga> --season 2025-26 [--K a,b] [--halfLife a,b] [--shotsW a,b] [--noMuShift] [--json out.json]');
  process.exit(1);
}

/* ============================================================
   CONTRA EL MERCADO
   ============================================================ */

/* decimal → americano SIN redondear a entero: amToProb lo regresa
   a 1/decimal exacto, así el EV se mide contra el precio real. */
const decToAm = d => (d == null || !(d > 1)) ? null : (d >= 2 ? 100 * (d - 1) : -100 / (d - 1));

/* índice de cierres por (local, visita): cada par juega UNA vez en
   casa por temporada, así que la pareja identifica el partido */
function indexOdds(oddsRows) {
  const m = new Map();
  for (const r of oddsRows) m.set(`${r.home}|${r.away}`, r);
  return m;
}

/* Cuelga a cada fila del walk-forward su cierre. Se exige el mismo
   marcador y ±3 días de fecha: si no cuadran, mejor sin momios que
   con los de otro partido. */
function attachOdds(rows, oddsIdx) {
  let matched = 0, noOdds = 0, scoreMismatch = 0, dateMismatch = 0;
  for (const r of rows) {
    r.odds = null;
    const o = oddsIdx.get(`${r.g.home.id}|${r.g.away.id}`);
    if (!o || o.h == null) { noOdds++; continue; }
    if (o.fthg !== r.g.home.score || o.ftag !== r.g.away.score) { scoreMismatch++; continue; }
    const dd = Math.abs(new Date(o.date + 'T12:00:00Z').getTime() - new Date(r.g.date).getTime()) / 86400000;
    if (!(dd <= 3)) { dateMismatch++; continue; }
    r.odds = o; matched++;
  }
  return { matched, noOdds, scoreMismatch, dateMismatch };
}

/* Métricas contra el mercado para UNA calibración (mktBlend, x2Floor).
   Replica la regla del runtime: en el 1X2 se juega el resultado con
   más EV entre los que no son skip; en totales el lado que favorece
   el modelo si su EV pasa la barra. ROI = ganancia media por unidad
   apostada (plana). Brier del modelo/mercado/encogido sobre los
   MISMOS partidos (los que tienen cierre). */
function evaluateMarket(rows, cal) {
  const C = withDefaults(cal);
  const agg = () => ({ n: 0, hits: 0, profit: 0, pModel: 0, pMkt: 0, ev: 0, dec: 0 });
  const add = (a, hit, dec, p, imp, ev) => {
    a.n++; if (hit) a.hits++; a.profit += hit ? dec - 1 : -1;
    a.pModel += p; a.pMkt += imp; a.ev += ev; a.dec += dec;
  };
  const x2 = { bet: agg(), maybe: agg(), by_pick: { home: agg(), draw: agg(), away: agg() } };
  const tot = { bet: agg(), maybe: agg() };
  const S = { model: [0, 0, 0], market: [0, 0, 0], blended: [0, 0, 0] }; // brier, log-loss, rps
  const acc = (k, s) => { S[k][0] += s.brier; S[k][1] += s.ll; S[k][2] += s.rps; };
  let n = 0;
  for (const r of rows) {
    if (!r.odds) continue;
    const p3 = [r.mk.moneyline.home, r.mk.moneyline.draw, r.mk.moneyline.away];
    const evs = ev1x2(p3, [decToAm(r.odds.h), decToAm(r.odds.d), decToAm(r.odds.a)], C);
    if (!evs) continue;
    n++;
    const o = outcomeOf(r.g);
    const imp = evs.map(e => e.imp);
    acc('model', score3(p3, o));
    acc('market', score3(imp, o));
    acc('blended', score3(p3.map((p, i) => (1 - C.mktBlend) * p + C.mktBlend * imp[i]), o));
    const vi = bestValueIndex(evs);
    if (vi >= 0) {
      const dec = [r.odds.h, r.odds.d, r.odds.a][vi];
      const hit = !!o[vi];
      add(x2[evs[vi].verdict], hit, dec, p3[vi], imp[vi], evs[vi].ev);
      if (evs[vi].verdict === 'bet') add(x2.by_pick[['home', 'draw', 'away'][vi]], hit, dec, p3[vi], imp[vi], evs[vi].ev);
    }
    const t25 = r.mk.totals.find(t => t.line === 2.5);
    if (t25 && r.odds.over25 && r.odds.under25) {
      const t = evTotal(t25.over, decToAm(r.odds.over25), decToAm(r.odds.under25), C);
      if (t.verdict && t.verdict !== 'skip') {
        const total = r.g.home.score + r.g.away.score;
        const hit = t.side === 'over' ? total > 2.5 : total < 2.5;
        add(tot[t.verdict], hit, t.side === 'over' ? r.odds.over25 : r.odds.under25, t.p, t.imp, t.ev);
      }
    }
  }
  const r4 = x => n ? +(x / n).toFixed(4) : null;
  const trio = k => ({ brier: r4(S[k][0]), logloss: r4(S[k][1]), rps: r4(S[k][2]) });
  const fin = a => ({
    n: a.n, hits: a.hits,
    hit_rate: a.n ? +(a.hits / a.n).toFixed(3) : null,
    roi: a.n ? +(a.profit / a.n).toFixed(3) : null,
    units: +a.profit.toFixed(2),
    avg_odds: a.n ? +(a.dec / a.n).toFixed(2) : null,
    avg_model_p: a.n ? +(a.pModel / a.n).toFixed(3) : null,
    avg_market_p: a.n ? +(a.pMkt / a.n).toFixed(3) : null,
    avg_ev: a.n ? +(a.ev / a.n).toFixed(3) : null,
  });
  return {
    n, mktBlend: C.mktBlend, x2Floor: C.x2Floor,
    model: trio('model'), market: trio('market'), blended: trio('blended'),
    x2: { bet: fin(x2.bet), maybe: fin(x2.maybe), by_pick: { home: fin(x2.by_pick.home), draw: fin(x2.by_pick.draw), away: fin(x2.by_pick.away) } },
    total25: { bet: fin(tot.bet), maybe: fin(tot.maybe) },
  };
}

const { pct } = require('./euro-metrics');
const pad = (s, w) => String(s == null ? '—' : s).padStart(w);

(async () => {
  const { _: pos, flags } = parseArgs(process.argv.slice(2));
  const leagueId = pos[0];
  const cfg = LEAGUES[leagueId];
  if (!cfg) usage(`Liga desconocida: ${leagueId || '(vacía)'}`);
  const season = flags.season;
  if (!season || !/^\d{4}-\d{2}$/.test(String(season))) usage('Falta --season 2025-26 (o 2024-25, 2023-24)');
  const testYear = Number(String(season).slice(0, 4));
  const Ks = numList(flags.K, [DEFAULT_CAL.sgdK]);
  const halfLives = numList(flags.halfLife, [DEFAULT_CAL.halfLife]);
  const shotsWs = numList(flags.shotsW, [DEFAULT_CAL.shotsW]);
  const noMuShift = !!flags.noMuShift;
  const blends = numList(flags.mktBlend, [DEFAULT_CAL.mktBlend]);
  const floors = numList(flags.x2Floor, [DEFAULT_CAL.x2Floor]);
  const book = flags.book && flags.book !== true ? String(flags.book) : 'avg';
  if (!Ks.length || !halfLives.length || !shotsWs.length) usage('Listas vacías en --K / --halfLife / --shotsW');
  if (!blends.length || !floors.length) usage('Listas vacías en --mktBlend / --x2Floor');

  console.log(`== ${cfg.name} (${cfg.espn}) — backtest ${season} ==`);
  const history = await getHistory(leagueId, { withStats: true, log: m => console.log(m) });
  const testSet = history
    .filter(g => g.seasonYear === testYear && g.home.score != null && g.away.score != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!testSet.length) usage(`Sin juegos de ${season} en el histórico de ${leagueId}`);
  const firstDate = testSet[0].date;
  const fitSet = history.filter(g => g.date < firstDate && g.home.score != null && g.away.score != null);
  if (fitSet.length < 100) usage(`Muy pocos juegos antes de ${season} para ajustar (${fitSet.length})`);
  const asOf = new Date(firstDate).getTime() - 86400000;
  const lastTest = testSet[testSet.length - 1].date;
  console.log(`  ajuste: ${fitSet.length} juegos (${fitSet[0].date.slice(0, 10)} → ${fitSet[fitSet.length - 1].date.slice(0, 10)}, asOf ${new Date(asOf).toISOString().slice(0, 10)})`);
  console.log(`  prueba: ${testSet.length} juegos (${firstDate.slice(0, 10)} → ${lastTest.slice(0, 10)})`);

  /* base de liga: frecuencias del set de ajuste */
  let bH = 0, bD = 0, bA = 0, bOver = 0, bBtts = 0, bTot = 0;
  for (const g of fitSet) {
    const [h, d, a] = outcomeOf(g);
    bH += h; bD += d; bA += a;
    if (g.home.score + g.away.score > 2.5) bOver++;
    if (g.home.score > 0 && g.away.score > 0) bBtts++;
    bTot += g.home.score + g.away.score;
  }
  const nb = fitSet.length;
  const base = {
    p: [bH / nb, bD / nb, bA / nb],
    over25: +(bOver / nb).toFixed(3), btts: +(bBtts / nb).toFixed(3), meanTotal: +(bTot / nb).toFixed(3),
  };
  console.log(`  base liga: local ${pct(base.p[0])} · empate ${pct(base.p[1])} · visita ${pct(base.p[2])} · O2.5 ${pct(base.over25)} · BTTS ${pct(base.btts)} · ${base.meanTotal} goles/juego`);

  /* ---- cierres reales de la temporada de prueba ---- */
  let oddsIdx = null, oddsMeta = null;
  if (!flags.noOdds) {
    try {
      const od = await getClosingOdds(leagueId, testYear, { book, log: m => console.log(m) });
      oddsIdx = indexOdds(od.rows);
      oddsMeta = { file: od.file, book: od.book, rows: od.rows.length, sources: od.srcCount, unknown: od.unknown };
      const srcTxt = Object.entries(od.srcCount).map(([k, v]) => `${k}×${v}`).join(', ');
      console.log(`  cierres: ${od.rows.length} filas de ${path.basename(od.file)} (fuente ${od.book}: ${srcTxt})`
        + (od.unknown.length ? ` · EQUIPOS SIN MAPEAR: ${od.unknown.join(', ')}` : ''));
    } catch (e) {
      console.log(`  cierres: no disponibles (${e.message}) — sin métricas contra el mercado`);
    }
  }

  /* ---- barrido ---- */
  const fits = {};
  const sweeps = [];
  const testTeams = new Set(testSet.flatMap(g => [g.home.id, g.away.id]));
  for (const hl of halfLives) for (const sw of shotsWs) {
    const fit = fitDixonColes(fitSet, { asOf, halfLife: hl, shotsW: sw });
    const key = `hl${hl}_sw${sw}`;
    const priors = {};
    const anchored = [];
    for (const t of testTeams) {
      if (fit.ratings[t]) priors[t] = fit.ratings[t];
      else { priors[t] = { ...fit.promotedAnchor }; anchored.push(t); }
    }
    fits[key] = {
      halfLife: hl, shotsW: sw, mu: fit.mu, hfa: fit.hfa, rho: fit.rho, conversion: fit.conversion,
      promotedAnchor: fit.promotedAnchor, games: fit.diag.games, anchored,
    };
    console.log(`\n  fit halfLife=${hl} shotsW=${sw}: mu=${fit.mu} hfa=${fit.hfa} rho=${fit.rho} conv=${fit.conversion} · ancla ${fit.promotedAnchor.att}/${fit.promotedAnchor.def} · ${anchored.length} ascendido(s) sin historia`);
    const LG = { mu: fit.mu, hfa: fit.hfa, rho: fit.rho, conversion: fit.conversion };
    for (const K of Ks) {
      const cal = { ...DEFAULT_CAL, halfLife: hl, shotsW: sw, sgdK: K, muShiftCap: noMuShift ? 0 : DEFAULT_CAL.muShiftCap };
      const rows = walkForward(testSet, priors, LG, cal);
      const m = evaluate(rows, base, cal);
      /* contra el mercado: mismas filas, barrido blend × floor sin re-ajustar */
      let market = null;
      if (oddsIdx) {
        const link = attachOdds(rows, oddsIdx);
        market = { link, grid: [] };
        for (const b of blends) for (const f of floors) market.grid.push(evaluateMarket(rows, { ...cal, mktBlend: b, x2Floor: f }));
      }
      sweeps.push({ key, halfLife: hl, shotsW: sw, K, muShift: !noMuShift, metrics: m, market });
      const mk0 = market && market.grid[0];
      console.log(`    K=${K}: Brier ${m.brier} · log-loss ${m.logloss} · RPS ${m.rps} · O2.5 ${m.ou25.brier} · BTTS ${m.btts.brier} · DC≥${cal.dcBet} ${m.dc_bars[cal.dcBet].hits}/${m.dc_bars[cal.dcBet].n} · muShift ${m.mu_shift_final}`
        + (mk0 ? ` · BET 1X2 (blend ${mk0.mktBlend}, piso ${mk0.x2Floor}) ${mk0.x2.bet.n} · ROI ${pct(mk0.x2.bet.roi)}` : ''));
    }
  }

  /* ---- tabla del barrido ---- */
  console.log('\nBarrido (base: Brier ' + sweeps[0].metrics.base_brier + ' · log-loss ' + sweeps[0].metrics.base_logloss + ' · RPS ' + sweeps[0].metrics.base_rps + '):');
  console.log('  halfLife shotsW     K   Brier  log-loss     RPS  skill   O2.5    BTTS  exact');
  for (const s of sweeps) {
    const m = s.metrics;
    console.log(`  ${String(s.halfLife).padStart(8)} ${String(s.shotsW).padStart(6)} ${String(s.K).padStart(5)}  ${m.brier.toFixed(4)}    ${m.logloss.toFixed(4)}  ${m.rps.toFixed(4)}  ${(m.brier_skill * 100).toFixed(1).padStart(5)}%  ${m.ou25.brier.toFixed(4)}  ${m.btts.brier.toFixed(4)}  ${pct(m.exact_top1)}`);
  }

  /* ---- detalle de la combinación principal ---- */
  const primaryK = Ks.includes(DEFAULT_CAL.sgdK) ? DEFAULT_CAL.sgdK : Ks[0];
  const primary = sweeps.find(s => s.halfLife === halfLives[0] && s.shotsW === shotsWs[0] && s.K === primaryK);
  const m = primary.metrics;
  console.log(`\nDetalle (halfLife ${primary.halfLife}, shotsW ${primary.shotsW}, K ${primary.K}${noMuShift ? ', sin muShift' : ''}):`);
  console.log(`  1X2: Brier ${m.brier} vs base ${m.base_brier} · log-loss ${m.logloss} vs ${m.base_logloss} · RPS ${m.rps} vs ${m.base_rps} · skill ${pct(m.brier_skill)} · favorito acierta ${pct(m.fav_hit_rate)}`);
  console.log('  Calibración del favorito 1X2 (decil → predicho vs real):');
  for (const [k, x] of Object.entries(m.fav_by_decile)) console.log(`    ${k}%: pred ${pct(x.pred)} · real ${pct(x.real)} (n=${x.n})`);
  console.log(`  O/U 2.5: Brier ${m.ou25.brier} · pred over ${pct(m.ou25.pred_over)} · real ${pct(m.ou25.real_over)} (base ${pct(m.ou25.base_over)})`);
  console.log(`  BTTS:    Brier ${m.btts.brier} · pred sí ${pct(m.btts.pred_yes)} · real ${pct(m.btts.real_yes)} (base ${pct(m.btts.base_yes)})`);
  console.log('  Seguros DC (1X o X2) por barra:');
  for (const [b, x] of Object.entries(m.dc_bars)) console.log(`    ≥${b}: ${x.hits}/${x.n} = ${pct(x.rate)}${Number(b) === DEFAULT_CAL.dcBet ? '  ← barra BET del runtime' : ''}`);
  console.log(`  Marcador exacto top-1: ${pct(m.exact_top1)} (azar ~5-7%, bueno ~10-12%)`);
  console.log(`  Cordura sin mercado: total predicho ${m.sanity.pred_mean_total} vs real ${m.sanity.real_mean_total} (base ${m.sanity.base_mean_total}) · local ${pct(m.sanity.pred_home)} vs ${pct(m.sanity.real_home)} · empate ${pct(m.sanity.pred_draw)} vs ${pct(m.sanity.real_draw)} · visita ${pct(m.sanity.pred_away)} vs ${pct(m.sanity.real_away)}`);
  console.log(`  muShift al cierre: ${m.mu_shift_final}`);

  /* ---- contra el mercado (combinación principal) ---- */
  if (primary.market) {
    const { link, grid } = primary.market;
    const g0 = grid[0];
    console.log(`\nContra el mercado (cierres ${oddsMeta.book}; ${link.matched}/${m.n} partidos con cierre`
      + (link.noOdds ? `, ${link.noOdds} sin fila` : '') + (link.scoreMismatch ? `, ${link.scoreMismatch} con marcador distinto` : '')
      + (link.dateMismatch ? `, ${link.dateMismatch} con fecha lejana` : '') + '):');
    console.log(`  1X2 en esos partidos: modelo Brier ${g0.model.brier} · RPS ${g0.model.rps}  |  mercado Brier ${g0.market.brier} · RPS ${g0.market.rps}`);
    console.log('  Barrido mktBlend × x2Floor — misma regla que el runtime (el 1X2 con más EV; ROI a 1 unidad plana):');
    console.log('  blend  piso | Brier enc. | BET 1X2    n  acierto     ROI  unidades  momio | local · empate · visita (n@ROI) | MAYBE 1X2   n     ROI | O/U 2.5 BET   n  acierto     ROI');
    for (const g of grid) {
      const bp = g.x2.by_pick;
      const pk = a => `${a.n}@${pct(a.roi)}`;
      console.log(`  ${pad(g.mktBlend.toFixed(2), 5)} ${pad(g.x2Floor.toFixed(2), 5)} | ${pad(g.blended.brier, 10)} | ${pad(g.x2.bet.n, 11)}  ${pad(pct(g.x2.bet.hit_rate), 7)}  ${pad(pct(g.x2.bet.roi), 6)}  ${pad(g.x2.bet.units, 8)}  ${pad(g.x2.bet.avg_odds, 5)} | ${pad(pk(bp.home), 9)} · ${pad(pk(bp.draw), 9)} · ${pad(pk(bp.away), 9)} | ${pad(g.x2.maybe.n, 11)}  ${pad(pct(g.x2.maybe.roi), 6)} | ${pad(g.total25.bet.n, 13)}  ${pad(pct(g.total25.bet.hit_rate), 7)}  ${pad(pct(g.total25.bet.roi), 6)}`);
    }
    console.log('  (n = apuestas que el runtime habría marcado BET; acierto = % ganadas; ROI = ganancia media por unidad; momio = decimal promedio de los BET)');
  }

  if (flags.json && flags.json !== true) {
    const dest = path.resolve(String(flags.json));
    fs.writeFileSync(dest, JSON.stringify({
      league: leagueId, season, generated: new Date().toISOString(),
      fit_games: fitSet.length, test_games: testSet.length, asOf: new Date(asOf).toISOString(),
      base, odds: oddsMeta, fits, sweeps, primary,
    }, null, 2));
    console.log(`\nEscrito ${dest}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
