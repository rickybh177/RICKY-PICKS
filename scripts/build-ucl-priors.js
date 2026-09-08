#!/usr/bin/env node
/* ============================================================
   Genera lib/euro/priors/ucl.js para el modelo de la CHAMPIONS
   LEAGUE. El archivo que escribe es GENERADO: nunca se edita a
   mano, se regenera con este script.

   A diferencia de build-euro-priors.js (una liga cerrada), aquí
   los 36 clubes vienen de 16 ligas, así que los priors salen de UN
   ajuste conjunto (lib/euro/fit.js con filas 'dom' y 'uefa') sobre
   todas las competencias de LEAGUES.ucl.fitWith: las ligas
   domésticas que ESPN cubre más Champions, Europa League y
   Conference (los partidos europeos son los puentes entre ligas).
   Los juegos europeos tienen su propio nivel goleador y localía
   (muUefa, hfaUefa): eso es lo que predice el runtime; el nivel
   doméstico va en LEAGUE.comps.dom porque en temporada el modelo
   también aprende de la liga de cada club.

   1. Histórico (scripts/euro-history.js, caché en disco) de todas
      las competencias, juegos ANTERIORES a histEnd (2026-07-31):
      el runtime aprende de 2026-27 y los priors no deben incluirlo.
   2. Ajuste conjunto con decaimiento temporal.
   3. Ancla del debutante europeo (promedio de los clubes cuya liga
      no está en ESPN: solo tienen partidos europeos).
   4. PRIORS para los 36 de la Champions (debutantes sin historia →
      ancla) MÁS todos los equipos activos de las ligas learnFrom
      (los rivales domésticos de los 36, para que el aprendizaje en
      temporada tenga rating de los dos lados).
   5. Córneres con los summaries de la Champions 2025-26.
   6. CAL horneado: restMult 1 (en Champions TODOS juegan entre
      semana tras la liga del fin de semana; el "descanso corto" ya
      vive en el nivel ajustado de la competencia).

   Uso:  node scripts/build-ucl-priors.js [--halfLife 365] [--sgdK 0.025]
           [--muShiftN 80] [--muShiftCap 0.08] [--dcBet 0.76] [--dcMaybe 0.70]
           [--bttsBet 0.555] [--bttsMaybe 0.535] [--mktBlend 0.45] [--x2Floor 0.35]
         Los valores por defecto viven en lib/euro/core.js (DEFAULT_CAL);
         una bandera los sobreescribe y queda horneada en el archivo.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { LEAGUES, TEAMS } = require('../lib/euro/leagues');
const { fitDixonColes } = require('../lib/euro/fit');
const { DEFAULT_CAL } = require('../lib/euro/core');
const { loadAll, debutAnchor, leagueParams, uclLevel } = require('./ucl-common');

const CORNER_SHRINK_N = 10;                     // n/(n+10) hacia el factor 1
const CORNER_MIN_GAMES = 3;                     // en Champions se juegan 8-17 partidos por temporada
const CORNER_DEBUT = { f: 0.95, a: 1.05 };      // debutante: genera menos, concede más
const ACTIVE_DAYS = 400;                        // rivales domésticos "activos": con juego en los últimos 400 días
const CAL_FLAGS = ['halfLife', 'shotsW', 'sgdK', 'sgdCap', 'muShiftN', 'muShiftCap',
  'mktBlend', 'x2Floor', 'restDays', 'restMult', 'dcBet', 'dcMaybe', 'bttsBet', 'bttsMaybe'];

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
function usage(msg) {
  if (msg) console.error(msg);
  console.error('Uso: node scripts/build-ucl-priors.js [--halfLife N] [--sgdK x] [--dcBet x] …');
  process.exit(1);
}

(async () => {
  const { flags } = parseArgs(process.argv.slice(2));
  const cfg = LEAGUES.ucl;
  const roster = TEAMS.ucl || {};
  if (!Object.keys(roster).length) usage('Sin plantilla TEAMS.ucl en lib/euro/leagues.js');

  const CAL = { ...DEFAULT_CAL, restMult: 1 }; // ver encabezado: sin ajuste de descanso en Champions
  for (const k of Object.keys(flags)) {
    if (!CAL_FLAGS.includes(k)) usage(`Bandera desconocida: --${k}`);
    const v = Number(flags[k]);
    if (!isFinite(v)) usage(`--${k} necesita un número`);
    CAL[k] = v;
  }

  console.log(`== ${cfg.name} (${cfg.espn}) — priors ${cfg.seasonLabel} ==`);
  console.log(`Leyendo histórico conjunto de ${cfg.fitWith.length + 1} competencias hasta ${cfg.histEnd}…`);
  const all = await loadAll(cfg, m => console.log(m), { statsFor: ['ucl'] });
  const fitSet = all.filter(g => g.date < cfg.histEnd && g.home.score != null && g.away.score != null);
  const perLeague = {};
  for (const g of fitSet) perLeague[g.league] = (perLeague[g.league] || 0) + 1;
  console.log(`  ${all.length} juegos en caché, ${fitSet.length} antes del corte: ${Object.entries(perLeague).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  /* ---- ajuste conjunto ---- */
  console.log(`Ajustando Dixon-Coles conjunto (decaimiento ${CAL.halfLife} d)…`);
  const asOf = new Date(cfg.histEnd + 'T23:59:59Z').getTime();
  const fit = fitDixonColes(fitSet, { asOf, halfLife: CAL.halfLife, shotsW: 0 });
  const { anchor, n: nAnchor } = debutAnchor(fit, fitSet);
  const LG = leagueParams(fit);
  /* nivel propio de la Champions dentro de los partidos europeos
     (ucl-common.uclLevel); en el backtest 24-25/25-26 salió ≈ 0 —
     la deriva de la fase de liga la corrige muShift en temporada —
     pero se aplica por si el histórico se separa algún día. */
  const lvl = uclLevel(fit, LG, fitSet, { asOf, halfLife: CAL.halfLife });
  LG.mu = +(LG.mu + lvl.level).toFixed(4);
  console.log(`  ${fit.diag.games} juegos (${fit.diag.uefa_games} europeos) · ${fit.diag.teams} equipos · ${fit.diag.iters} iteraciones`);
  console.log(`  doméstico: mu=${fit.mu} hfa=${fit.hfa} · europeo: mu=${LG.mu} (muUefa ${fit.muUefa}, nivel Champions ${lvl.level}) hfa=${fit.hfaUefa} escala=${LG.scale} · rho=${fit.rho}`);
  console.log(`  ancla del debutante europeo: att ${anchor.att} / def ${anchor.def} (${nAnchor} clubes solo con partidos europeos)`);

  /* ---- PRIORS: los 36 + rivales domésticos activos ---- */
  const PRIORS = {};
  const debut = [];
  for (const id of Object.keys(roster)) {
    if (fit.ratings[id]) PRIORS[id] = fit.ratings[id];
    else { PRIORS[id] = { ...anchor }; debut.push(id); }
  }
  const sinceMs = asOf - ACTIVE_DAYS * 86400000;
  let rivals = 0;
  for (const g of fitSet) {
    if (!cfg.learnFrom.includes(g.league) || new Date(g.date).getTime() < sinceMs) continue;
    for (const id of [g.home.id, g.away.id]) {
      if (!PRIORS[id] && fit.ratings[id]) { PRIORS[id] = fit.ratings[id]; rivals++; }
    }
  }
  const table = Object.keys(roster)
    .map(id => ({ id, name: roster[id].name, ...PRIORS[id], anchored: debut.includes(id) }))
    .sort((a, b) => (b.att - b.def) - (a.att - a.def));
  console.log('  los 36 (att − def, de mejor a peor):');
  for (const r of table) {
    console.log(`    ${r.id.padStart(5)} ${r.name.padEnd(18)} att=${String(r.att.toFixed(3)).padStart(7)} def=${String(r.def.toFixed(3)).padStart(7)}${r.anchored ? '  ← debutante sin historia (ancla)' : ''}`);
  }
  console.log(`  + ${rivals} rivales domésticos activos (ligas: ${cfg.learnFrom.join(', ')}) → ${Object.keys(PRIORS).length} equipos en PRIORS`);

  /* ---- Champions sola: promedios para el payload ---- */
  const uclFit = fitSet.filter(g => g.league === 'ucl');
  let sumH = 0, sumA = 0, draws = 0;
  for (const g of uclFit) { sumH += g.home.score; sumA += g.away.score; if (g.home.score === g.away.score) draws++; }

  /* ---- córneres: Champions de la temporada pasada ---- */
  const lastYear = Number(cfg.seasonStart.slice(0, 4)) - 1;
  const cornerGames = uclFit.filter(g => g.seasonYear === lastYear && g.home.corners != null && g.away.corners != null);
  const corn = {};
  let cHome = 0, cAway = 0;
  for (const g of cornerGames) {
    cHome += g.home.corners; cAway += g.away.corners;
    for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
      const id = g[side].id;
      corn[id] = corn[id] || { f: 0, a: 0, n: 0 };
      corn[id].f += g[side].corners; corn[id].a += g[opp].corners; corn[id].n++;
    }
  }
  const nC = cornerGames.length;
  const cMuHome = nC ? cHome / nC : 5.2, cMuAway = nC ? cAway / nC : 4.3, cMu = (cMuHome + cMuAway) / 2;
  console.log(`  córneres Champions ${lastYear}-${String(lastYear + 1).slice(2)}: ${nC} juegos · local ${cMuHome.toFixed(2)}, visita ${cMuAway.toFixed(2)}`);
  const CORNERS = {};
  for (const id of Object.keys(roster)) {
    const c = corn[id];
    if (c && c.n >= CORNER_MIN_GAMES) {
      const shr = c.n / (c.n + CORNER_SHRINK_N);
      CORNERS[id] = { f: +(1 + shr * (c.f / c.n / cMu - 1)).toFixed(3), a: +(1 + shr * (c.a / c.n / cMu - 1)).toFixed(3) };
    } else CORNERS[id] = debut.includes(id) ? { ...CORNER_DEBUT } : { f: 1, a: 1 };
  }

  /* ---- escribir ---- */
  const LEAGUE = {
    mu: LG.mu, hfa: LG.hfa, rho: LG.rho, conversion: fit.conversion,
    scale: LG.scale,                 // escala europea de las diferencias de rating
    ucl_level: lvl.level,            // nivel propio de la Champions ya sumado a mu
    comps: LG.comps, muShiftComp: LG.muShiftComp,
    avg_home_goals: +(sumH / uclFit.length).toFixed(3),
    avg_away_goals: +(sumA / uclFit.length).toFixed(3),
    draw_rate: +(draws / uclFit.length).toFixed(3),
    fit_games: fit.diag.games,
    fit_games_ucl: uclFit.length,
    fit_teams: fit.diag.teams,
    corners_home: +cMuHome.toFixed(2), corners_away: +cMuAway.toFixed(2),
    promoted_anchor: { att: anchor.att, def: anchor.def },
  };
  const today = new Date().toISOString().slice(0, 10);
  const out = `/* ============================================================
   PRIORS CHAMPIONS LEAGUE — ${cfg.seasonLabel}
   ARCHIVO GENERADO por scripts/build-ucl-priors.js el ${today}
   con un ajuste CONJUNTO de ${fit.diag.games} partidos (${fit.diag.uefa_games} europeos) de
   ${cfg.fitWith.length + 1} competencias (${cfg.histStart} → ${cfg.histEnd}, decaimiento de
   ${CAL.halfLife} días). NO editar a mano: regenerar con el script (las
   banderas quedan horneadas en CAL).
   LEAGUE.mu/hfa = nivel y localía de los partidos EUROPEOS (lo que se
   predice); LEAGUE.comps.dom = los domésticos (de los que también se
   aprende en temporada). Llaves = id de equipo de ESPN (string);
   att = fuerza ofensiva, def = debilidad defensiva (escala log). Los
   debutantes sin historia traen promoted_anchor (el debutante europeo).
   PRIORS incluye a los 36 de la Champions y a sus rivales domésticos
   activos.
   ============================================================ */
const LEAGUE = ${JSON.stringify(LEAGUE, null, 2)};

/* ratings iniciales: los 36 de la fase de liga + rivales domésticos (${Object.keys(PRIORS).length} equipos) */
const PRIORS = ${JSON.stringify(PRIORS, null, 2)};

/* factores de córneres a favor (f) y en contra (a), relativos a la Champions */
const CORNERS = ${JSON.stringify(CORNERS, null, 2)};

/* calibración del runtime (misma que usa scripts/ucl-backtest.js) */
const CAL = ${JSON.stringify(CAL, null, 2)};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
`;
  const dest = path.join(__dirname, '..', 'lib', 'euro', 'priors', 'ucl.js');
  fs.writeFileSync(dest, out);
  delete require.cache[require.resolve(dest)];
  const chk = require(dest);
  const missing = Object.keys(roster).filter(id => !chk.PRIORS[id] || !chk.CORNERS[id]);
  if (missing.length) throw new Error(`El archivo generado no trae a: ${missing.join(', ')}`);
  console.log(`Escrito ${dest} (${Object.keys(chk.PRIORS).length} equipos, ${debut.length} debutante(s) con ancla)`);
})().catch(e => { console.error(e); process.exit(1); });
