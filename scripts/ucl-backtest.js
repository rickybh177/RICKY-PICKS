#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — modelo de la CHAMPIONS LEAGUE contra
   una temporada completa ya jugada (fase de liga + eliminatorias).

   La Champions no es una liga: sus 36 clubes vienen de 16 ligas
   distintas y se enfrentan 8 veces cada uno. Por eso el modelo se
   ajusta en CONJUNTO (lib/euro/fit.js) sobre las ligas domésticas
   que ESPN cubre más las tres copas europeas: los partidos
   europeos son los puentes que ponen a Bayern, Liverpool y Bodø en
   la misma escala. Los juegos europeos tienen su propio nivel
   goleador (muUefa) y su propia localía (hfaUefa).

   Validación honesta, sin fuga:
   1. Ajuste SOLO con partidos (de todas las competencias) anteriores
      al primer juego de la Champions de la temporada de prueba.
      Los debutantes sin historia arrancan con el ancla del
      debutante europeo (promedio de los clubes cuya liga no está en
      ESPN: solo tienen partidos europeos).
   2. Recorre la temporada en orden cronológico aprendiendo de la
      Champions Y de la liga de cada club (learnFrom en
      lib/euro/leagues.js) — exactamente lo que hace el runtime —,
      registrando la predicción de cada partido de Champions ANTES
      de ver su marcador. Solo se califican los de Champions. La
      corrección goleadora (muShift) se alimenta únicamente de la
      Champions (muShiftComp).
   3. Mismas métricas que scripts/euro-backtest.js (euro-metrics.js).
      Sin cierres históricos: football-data.co.uk no cubre la
      Champions, así que aquí no hay medición contra el mercado.

   Uso:  node scripts/ucl-backtest.js --season 2025-26|2024-25
           [--K 0,0.015,0.025,0.035] [--halfLife 365,500]
           [--noDomestic] [--noMuShift] [--noLevel] [--muShiftN 80] [--json salida.json]
         --noLevel apaga el nivel propio de la Champions (ucl-common.uclLevel).
         --noDomestic aprende solo de la Champions (para medir cuánto
         aporta la liga de cada club).
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { LEAGUES, TEAMS } = require('../lib/euro/leagues');
const { fitDixonColes } = require('../lib/euro/fit');
const { DEFAULT_CAL } = require('../lib/euro/core');
const { walkForward, evaluate, baseRates, printDetail, pct } = require('./euro-metrics');

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
  console.error('Uso: node scripts/ucl-backtest.js --season 2025-26 [--K a,b] [--halfLife a,b] [--noDomestic] [--noMuShift] [--json out.json]');
  process.exit(1);
}
const { loadAll, debutAnchor, leagueParams, uclLevel, byDate } = require('./ucl-common');

(async () => {
  const { flags } = parseArgs(process.argv.slice(2));
  const cfg = LEAGUES.ucl;
  const season = flags.season;
  if (!season || !/^\d{4}-\d{2}$/.test(String(season))) usage('Falta --season 2025-26 (o 2024-25)');
  const testYear = Number(String(season).slice(0, 4));
  const Ks = numList(flags.K, [DEFAULT_CAL.sgdK]);
  const halfLives = numList(flags.halfLife, [DEFAULT_CAL.halfLife]);
  const noDomestic = !!flags.noDomestic;
  const noMuShift = !!flags.noMuShift;
  const withLevel = !flags.noLevel;                       // nivel propio de la Champions (ucl-common.uclLevel)
  const muShiftN = flags.muShiftN != null && flags.muShiftN !== true ? Number(flags.muShiftN) : DEFAULT_CAL.muShiftN;
  if (!Ks.length || !halfLives.length) usage('Listas vacías en --K / --halfLife');

  console.log(`== ${cfg.name} (${cfg.espn}) — backtest ${season}${noDomestic ? ' · solo Champions' : ' · aprende también de ' + cfg.learnFrom.length + ' ligas'} ==`);
  const all = await loadAll(cfg, m => console.log(m));
  const testSet = all.filter(g => g.league === 'ucl' && g.seasonYear === testYear).sort(byDate);
  if (!testSet.length) usage(`Sin juegos de Champions ${season} en el histórico`);
  const firstDate = testSet[0].date, lastDate = testSet[testSet.length - 1].date;
  const asOf = new Date(firstDate).getTime() - 86400000;
  const fitSet = all.filter(g => g.date < firstDate);
  const domesticLearn = noDomestic ? [] : all.filter(g => g.comp === 'dom' && cfg.learnFrom.includes(g.league) && g.date >= firstDate && g.date <= lastDate);
  const learnSet = [...testSet, ...domesticLearn];
  const perLeague = {};
  for (const g of fitSet) perLeague[g.league] = (perLeague[g.league] || 0) + 1;
  console.log(`  ajuste: ${fitSet.length} juegos de ${Object.keys(perLeague).length} competencias (hasta ${fitSet[fitSet.length - 1].date.slice(0, 10)}, asOf ${new Date(asOf).toISOString().slice(0, 10)})`);
  console.log(`    ${Object.entries(perLeague).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  prueba: ${testSet.length} juegos de Champions (${firstDate.slice(0, 10)} → ${lastDate.slice(0, 10)})` + (domesticLearn.length ? ` + ${domesticLearn.length} de liga para aprender` : ''));

  const base = baseRates(fitSet.filter(g => g.league === 'ucl'));
  console.log(`  base Champions: local ${pct(base.p[0])} · empate ${pct(base.p[1])} · visita ${pct(base.p[2])} · O2.5 ${pct(base.over25)} · BTTS ${pct(base.btts)} · ${base.meanTotal} goles/juego`);

  const fits = {}, sweeps = [];
  const learnTeams = new Set(learnSet.flatMap(g => [g.home.id, g.away.id]));
  const uclTeams = new Set(testSet.flatMap(g => [g.home.id, g.away.id]));
  const nameOf = id => (TEAMS.ucl[id] && TEAMS.ucl[id].name) || (testSet.find(g => g.home.id === id) || {}).home?.name || (testSet.find(g => g.away.id === id) || {}).away?.name || id;
  for (const hl of halfLives) {
    const fit = fitDixonColes(fitSet, { asOf, halfLife: hl });
    const { anchor, n: nAnchor } = debutAnchor(fit, fitSet);
    const priors = {};
    const anchored = [];
    for (const t of learnTeams) {
      if (fit.ratings[t]) priors[t] = fit.ratings[t];
      else { priors[t] = { ...anchor }; if (uclTeams.has(t)) anchored.push(nameOf(t)); }
    }
    const LG = leagueParams(fit);
    if (flags.noScale) LG.scale = 1;
    const lvl = withLevel ? uclLevel(fit, LG, fitSet, { asOf, halfLife: hl }) : { level: 0, n: 0 };
    LG.mu = +(LG.mu + lvl.level).toFixed(4);
    fits[`hl${hl}`] = {
      level: lvl, halfLife: hl, mu: fit.mu, hfa: fit.hfa, muUefa: fit.muUefa, hfaUefa: fit.hfaUefa, rho: fit.rho, games: fit.diag.games, uefa_games: fit.diag.uefa_games, teams: fit.diag.teams, anchor, anchorTeams: nAnchor, anchoredUcl: anchored };
    console.log(`\n  fit halfLife=${hl}: ${fit.diag.games} juegos (${fit.diag.uefa_games} europeos) · ${fit.diag.teams} equipos · mu=${fit.mu} hfa=${fit.hfa} · europeos muUefa=${fit.muUefa} hfaUefa=${fit.hfaUefa} escala=${LG.scale} · rho=${fit.rho}`);
    if (withLevel) console.log(`    nivel propio de la Champions: ${lvl.level >= 0 ? '+' : ''}${lvl.level} (obs ${lvl.obsPerGame} vs pred ${lvl.predPerGame} goles/juego, peso ${lvl.n})`);
    console.log(`    ancla del debutante ${anchor.att}/${anchor.def} (${nAnchor} clubes solo con partidos europeos) · debutantes de Champions sin historia: ${anchored.length ? anchored.join(', ') : 'ninguno'}`);
    // los 10 mejores del ajuste, para leer si la escala cruzada tiene sentido
    const top = [...uclTeams].map(t => ({ t, s: priors[t].att - priors[t].def })).sort((a, b) => b.s - a.s);
    console.log(`    top-5 de la Champions al arrancar: ${top.slice(0, 5).map(x => `${nameOf(x.t)} ${x.s.toFixed(2)}`).join(' · ')} · colas: ${top.slice(-3).map(x => `${nameOf(x.t)} ${x.s.toFixed(2)}`).join(' · ')}`);
    for (const K of Ks) {
      const cal = { ...DEFAULT_CAL, halfLife: hl, sgdK: K, restMult: 1, muShiftN, muShiftCap: noMuShift ? 0 : DEFAULT_CAL.muShiftCap };
      const rows = walkForward(learnSet, priors, LG, cal, g => g.league === 'ucl');
      const m = evaluate(rows, base, cal);
      sweeps.push({ halfLife: hl, K, domestic: !noDomestic, muShift: !noMuShift, level: withLevel ? lvl.level : 0, muShiftN, metrics: m });
      console.log(`    K=${K}: Brier ${m.brier} · log-loss ${m.logloss} · RPS ${m.rps} · skill ${pct(m.brier_skill)} · O2.5 ${m.ou25.brier} · BTTS ${m.btts.brier} · DC≥${cal.dcBet} ${m.dc_bars[cal.dcBet].hits}/${m.dc_bars[cal.dcBet].n} · muShift ${m.mu_shift_final}`);
    }
  }

  console.log('\nBarrido (base: Brier ' + sweeps[0].metrics.base_brier + ' · log-loss ' + sweeps[0].metrics.base_logloss + ' · RPS ' + sweeps[0].metrics.base_rps + '):');
  console.log('  halfLife     K   Brier  log-loss     RPS  skill   O2.5    BTTS  exact');
  for (const s of sweeps) {
    const m = s.metrics;
    console.log(`  ${String(s.halfLife).padStart(8)} ${String(s.K).padStart(5)}  ${m.brier.toFixed(4)}    ${m.logloss.toFixed(4)}  ${m.rps.toFixed(4)}  ${(m.brier_skill * 100).toFixed(1).padStart(5)}%  ${m.ou25.brier.toFixed(4)}  ${m.btts.brier.toFixed(4)}  ${pct(m.exact_top1)}`);
  }
  const primaryK = Ks.includes(DEFAULT_CAL.sgdK) ? DEFAULT_CAL.sgdK : Ks[0];
  const primary = sweeps.find(s => s.halfLife === halfLives[0] && s.K === primaryK);
  printDetail(primary.metrics, { ...DEFAULT_CAL, halfLife: primary.halfLife, sgdK: primary.K }, `halfLife ${primary.halfLife}, K ${primary.K}${noDomestic ? ', solo Champions' : ', con ligas'}${noMuShift ? ', sin muShift' : ''}`);

  if (flags.json && flags.json !== true) {
    const dest = path.resolve(String(flags.json));
    fs.writeFileSync(dest, JSON.stringify({
      league: 'ucl', season, generated: new Date().toISOString(),
      fit_games: fitSet.length, test_games: testSet.length, domestic_learn_games: domesticLearn.length,
      asOf: new Date(asOf).toISOString(), base, fits, sweeps, primary,
    }, null, 2));
    console.log(`\nEscrito ${dest}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
