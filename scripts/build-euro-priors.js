#!/usr/bin/env node
/* ============================================================
   Genera lib/euro/priors/<liga>.js para los modelos de Europa
   (Premier, LaLiga, Bundesliga). El archivo que escribe es
   GENERADO: nunca se edita a mano, se regenera con este script.

   1. Lee el histórico de la liga (scripts/euro-history.js, caché
      en disco) y se queda con los juegos ANTERIORES a histEnd
      (2026-07-31). El corte importa: el runtime aprende solo de
      los juegos de 2026-27, así que los priors NO deben incluirlos
      (ni doble conteo ni fuga).
   2. Ajusta Dixon-Coles con decaimiento temporal (lib/euro/fit).
   3. Priors de córneres con los summaries de la temporada pasada
      (2025-26), encogidos hacia 1 con n/(n+10) como en Liga MX.
   4. Escribe el archivo con LEAGUE, PRIORS (todos los equipos de
      la plantilla 2026-27; los ascendidos sin historia reciben el
      ancla de ascendido salida de los datos), CORNERS y CAL (la
      calibración con la que corre el runtime, horneada aquí para
      que backtest y producción usen los mismos números).

   Uso:  node scripts/build-euro-priors.js <epl|laliga|bundesliga>
           [--halfLife 365] [--shotsW 0] [--sgdK 0.025] [--sgdCap 2.2]
           [--muShiftN 80] [--muShiftCap 0.08] [--dcBet 0.76]
           [--dcMaybe 0.70] [--bttsBet 0.555] [--bttsMaybe 0.535]
           [--mktBlend 0.22] [--x2Floor 0.3]
         Los valores por defecto viven en lib/euro/core.js
         (DEFAULT_CAL); una bandera los sobreescribe y queda
         horneada en el archivo. mktBlend / x2Floor (encogimiento
         hacia el mercado y piso del 1X2 con EV) se eligen con
         scripts/euro-backtest.js contra cierres reales.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { LEAGUES, TEAMS } = require('../lib/euro/leagues');
const { getHistory } = require('./euro-history');
const { fitDixonColes } = require('../lib/euro/fit');
const { DEFAULT_CAL } = require('../lib/euro/core');

const CORNER_SHRINK_N = 10;                     // n/(n+10) hacia el factor 1
const CORNER_MIN_GAMES = 5;
const CORNER_PROMOTED = { f: 0.95, a: 1.05 };   // recién ascendido: genera menos, concede más
const CAL_FLAGS = ['halfLife', 'shotsW', 'sgdK', 'sgdCap', 'muShiftN', 'muShiftCap',
  'mktBlend', 'x2Floor', 'restDays', 'restMult', 'dcBet', 'dcMaybe', 'bttsBet', 'bttsMaybe'];

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

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Uso: node scripts/build-euro-priors.js <epl|laliga|bundesliga> [--halfLife N] [--shotsW x] [--sgdK x] …');
  process.exit(1);
}

(async () => {
  const { _: pos, flags } = parseArgs(process.argv.slice(2));
  const leagueId = pos[0];
  const cfg = LEAGUES[leagueId];
  if (!cfg) usage(`Liga desconocida: ${leagueId || '(vacía)'}`);
  const roster = TEAMS[leagueId] || {};
  if (!Object.keys(roster).length) usage(`Sin plantilla en lib/euro/leagues.js para ${leagueId}`);

  // calibración: defaults + banderas numéricas
  const CAL = { ...DEFAULT_CAL };
  for (const k of Object.keys(flags)) {
    if (!CAL_FLAGS.includes(k)) usage(`Bandera desconocida: --${k}`);
    const v = Number(flags[k]);
    if (!isFinite(v)) usage(`--${k} necesita un número`);
    CAL[k] = v;
  }

  console.log(`== ${cfg.name} (${cfg.espn}) — priors ${cfg.seasonLabel} ==`);
  console.log(`Leyendo histórico ${cfg.histStart} → ${cfg.histEnd}…`);
  const history = await getHistory(leagueId, { withStats: true, log: m => console.log(m) });
  const fitSet = history.filter(g => g.date < cfg.histEnd && g.home.score != null && g.away.score != null);
  const seasons = {};
  for (const g of fitSet) seasons[`${g.seasonYear}-${String(g.seasonYear + 1).slice(2)}`] = (seasons[`${g.seasonYear}-${String(g.seasonYear + 1).slice(2)}`] || 0) + 1;
  console.log(`  ${history.length} juegos en caché, ${fitSet.length} antes del corte. Temporadas:`, seasons);

  /* ---- ajuste ---- */
  console.log(`Ajustando Dixon-Coles (decaimiento ${CAL.halfLife} d, shotsW ${CAL.shotsW})…`);
  const asOf = new Date(cfg.histEnd + 'T23:59:59Z').getTime();
  const fit = fitDixonColes(fitSet, { asOf, halfLife: CAL.halfLife, shotsW: CAL.shotsW });
  console.log(`  mu=${fit.mu} hfa=${fit.hfa} rho=${fit.rho} conversión=${fit.conversion}`);
  console.log(`  ancla de ascendido: att ${fit.promotedAnchor.att} / def ${fit.promotedAnchor.def} (${fit.diag.promoted_anchor_source})`);
  console.log(`  liga: ${fit.diag.games} juegos · local ${fit.diag.avg_home_goals} · visita ${fit.diag.avg_away_goals} · empates ${fit.diag.draw_rate} · ${fit.diag.iters} iteraciones`);

  /* ---- PRIORS: toda la plantilla 2026-27 ---- */
  const PRIORS = {};
  const promoted = [];
  for (const id of Object.keys(roster)) {
    if (fit.ratings[id]) PRIORS[id] = fit.ratings[id];
    else { PRIORS[id] = { ...fit.promotedAnchor }; promoted.push(id); }
  }
  const table = Object.keys(roster)
    .map(id => ({ id, name: roster[id].name, ...PRIORS[id], anchored: promoted.includes(id) }))
    .sort((a, b) => (b.att - b.def) - (a.att - a.def));
  console.log('  ratings (att − def, de mejor a peor):');
  for (const r of table) {
    console.log(`    ${r.id.padStart(5)} ${r.name.padEnd(16)} att=${String(r.att.toFixed(3)).padStart(7)} def=${String(r.def.toFixed(3)).padStart(7)}${r.anchored ? '  ← ascendido sin historia (ancla)' : ''}`);
  }
  if (promoted.length) console.log(`  ${promoted.length} equipo(s) con ancla de ascendido: ${promoted.map(id => roster[id].name).join(', ')}`);

  /* ---- córneres: summaries de la temporada pasada ---- */
  const lastYear = Number(cfg.seasonStart.slice(0, 4)) - 1;
  const cornerGames = fitSet.filter(g => g.seasonYear === lastYear && g.home.corners != null && g.away.corners != null);
  const corn = {}; // id -> {f, a, n}
  let leagueHome = 0, leagueAway = 0;
  for (const g of cornerGames) {
    leagueHome += g.home.corners; leagueAway += g.away.corners;
    for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
      const id = g[side].id;
      corn[id] = corn[id] || { f: 0, a: 0, n: 0 };
      corn[id].f += g[side].corners; corn[id].a += g[opp].corners; corn[id].n++;
    }
  }
  const nC = cornerGames.length;
  const cMuHome = nC ? leagueHome / nC : 5.2;
  const cMuAway = nC ? leagueAway / nC : 4.3;
  const cMu = (cMuHome + cMuAway) / 2;
  console.log(`  córneres ${lastYear}-${String(lastYear + 1).slice(2)}: ${nC} juegos con datos · liga local ${cMuHome.toFixed(2)}, visita ${cMuAway.toFixed(2)}`);
  const CORNERS = {};
  for (const id of Object.keys(roster)) {
    const c = corn[id];
    if (c && c.n >= CORNER_MIN_GAMES) {
      const shr = c.n / (c.n + CORNER_SHRINK_N);
      CORNERS[id] = {
        f: +(1 + shr * (c.f / c.n / cMu - 1)).toFixed(3),
        a: +(1 + shr * (c.a / c.n / cMu - 1)).toFixed(3),
      };
    } else CORNERS[id] = { ...CORNER_PROMOTED };
  }

  /* ---- escribir el archivo ---- */
  const LEAGUE = {
    mu: fit.mu,
    hfa: fit.hfa,
    rho: fit.rho,
    conversion: fit.conversion,
    avg_home_goals: fit.diag.avg_home_goals,
    avg_away_goals: fit.diag.avg_away_goals,
    draw_rate: fit.diag.draw_rate,
    fit_games: fit.diag.games,
    corners_home: +cMuHome.toFixed(2),
    corners_away: +cMuAway.toFixed(2),
    promoted_anchor: { att: fit.promotedAnchor.att, def: fit.promotedAnchor.def },
  };
  const today = new Date().toISOString().slice(0, 10);
  const out = `/* ============================================================
   PRIORS ${cfg.name.toUpperCase()} — ${cfg.seasonLabel}
   ARCHIVO GENERADO por scripts/build-euro-priors.js el ${today}
   con ${fit.diag.games} partidos de ${cfg.espn} (${cfg.histStart} → ${cfg.histEnd},
   decaimiento de ${CAL.halfLife} días, shotsW ${CAL.shotsW}). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: ${LEAGUE.mu},        // log-goles base por equipo
  hfa: ${LEAGUE.hfa},       // ventaja de local (log)
  rho: ${LEAGUE.rho},       // corrección Dixon-Coles de marcadores bajos
  conversion: ${LEAGUE.conversion},   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: ${LEAGUE.avg_home_goals},
  avg_away_goals: ${LEAGUE.avg_away_goals},
  draw_rate: ${LEAGUE.draw_rate},
  fit_games: ${LEAGUE.fit_games},
  corners_home: ${LEAGUE.corners_home},
  corners_away: ${LEAGUE.corners_away},
  promoted_anchor: { att: ${LEAGUE.promoted_anchor.att}, def: ${LEAGUE.promoted_anchor.def} },
};

/* ratings iniciales de la plantilla ${cfg.seasonLabel} (${Object.keys(PRIORS).length} equipos) */
const PRIORS = ${JSON.stringify(PRIORS, null, 2)};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = ${JSON.stringify(CORNERS, null, 2)};

/* calibración del runtime (misma que usa scripts/euro-backtest.js) */
const CAL = ${JSON.stringify(CAL, null, 2)};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
`;
  const dest = path.join(__dirname, '..', 'lib', 'euro', 'priors', `${leagueId}.js`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  // verificación: que cargue y traiga a toda la plantilla
  delete require.cache[require.resolve(dest)];
  const chk = require(dest);
  const missing = Object.keys(roster).filter(id => !chk.PRIORS[id] || !chk.CORNERS[id]);
  if (missing.length) throw new Error(`El archivo generado no trae a: ${missing.join(', ')}`);
  console.log(`Escrito ${dest} (${Object.keys(chk.PRIORS).length} equipos)`);
})().catch(e => { console.error(e); process.exit(1); });
