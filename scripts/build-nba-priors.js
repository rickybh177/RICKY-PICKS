#!/usr/bin/env node
/* ============================================================
   Genera lib/nba/priors.js — ratings iniciales 2026-27 + parámetros
   de liga, descanso, ausencias y dispersión.

   Método (misma receta que build-nfl-priors):
   - Ratings off/def (pts por 100 posesiones) y pace AJUSTADOS POR
     RIVAL (lib/nba/fit.js) sobre 2023-24, 2024-25 y 2025-26 (regular
     + play-in + playoffs) con decaimiento temporal (half-life 365
     días) — no promedios crudos.
   - El fit descuenta los offsets conocidos de cada juego (descanso y
     ausencias del boxscore) para que los ratings sean "a plantel
     completo y descansado"; en runtime esos ajustes se vuelven a
     sumar con las ausencias de HOY (reporte de lesiones de ESPN).
   - CARRY: solo una parte de la ventaja se hereda a la temporada
     nueva (validado en nba-backtest).
   - DISP: desviaciones del margen/total y parámetros de 1ª mitad y
     1er cuarto medidos FUERA DE MUESTRA en el backtest (walk-forward
     2025-26), no sobre el ajuste.

   Uso:  node scripts/build-nba-priors.js > lib/nba/priors.js
   ============================================================ */
const { seasons, absenceLookup, restLookup, fitWith, estimateRest, measureDispersion, ALT_TEAMS } = require('./nba-common');
const { learnRatings } = require('../lib/nba/core');
const { HALF_LIFE_DAYS } = require('../lib/nba/fit');

/* Validados en scripts/nba-backtest.js (ver NBA-README.md) */
const CARRY = 0.7;
const K = 0.05, KP = 0.1;
const ABS_C = 0.3;
const LUCK = { off: 0.5, def: 0.5 };
const YEARS = [2024, 2025, 2026];
const AS_OF = '2026-10-01';

async function main() {
  const games = seasons(YEARS);
  const asOf = new Date(AS_OF + 'T00:00:00Z').getTime();
  const absences = absenceLookup(YEARS);
  const rest = restLookup(games);

  // 1) fit sin descanso → efecto del descanso → fit final con todo
  const fit0 = fitWith(games, { asOf, ABS_C, absences, rest });
  const { REST, detail } = estimateRest(games, fit0, rest, { absences, ABS_C });
  const fit = fitWith(games, { asOf, REST, ABS_C, absences, rest });
  const teams = Object.keys(fit.ratings).sort();
  if (teams.length !== 30) throw new Error('Se esperaban 30 equipos, llegaron ' + teams.length);

  const PRIORS = {};
  for (const t of teams) {
    PRIORS[t] = {
      off: +(fit.ratings[t].off * CARRY).toFixed(2),
      def: +(fit.ratings[t].def * CARRY).toFixed(2),
      pace: +(fit.ratings[t].pace * CARRY).toFixed(2),
    };
  }

  // 2) dispersión FUERA DE MUESTRA: walk-forward 2025-26 con fit 2024+2025
  const fitPrev = fitWith(seasons([2024, 2025]), { asOf: new Date('2025-10-01T00:00:00Z').getTime(), REST, ABS_C, absences, rest });
  const priorsPrev = {};
  for (const t in fitPrev.ratings) priorsPrev[t] = { off: fitPrev.ratings[t].off * CARRY, def: fitPrev.ratings[t].def * CARRY, pace: fitPrev.ratings[t].pace * CARRY };
  const rows = [];
  learnRatings(seasons([2026]).filter(g => g.seasontype === 2), {
    priors: priorsPrev, league: { mu: fitPrev.mu, hfa: fitPrev.hfa, poss: fitPrev.poss },
    params: { K, KP, REST, ABS_C, LUCK }, absences, altTeams: ALT_TEAMS,
  }, (g, e) => rows.push({ g, expH: e.expH, expA: e.expA }));
  const disp = measureDispersion(rows);
  const DISP = {};
  DISP.SD_ML = 12.5; // grid del backtest: mejor Brier del ganador (0.1999) con 12.5 vs 0.2011 con la sd completa
  for (const k of ['SD_MARGIN', 'SD_TOTAL', 'H1_SHARE_TOTAL', 'SD_H1_TOTAL', 'H1_SHARE_MARGIN', 'SD_H1_MARGIN', 'Q1_SHARE_TOTAL', 'SD_Q1_TOTAL', 'Q1_SHARE_MARGIN', 'SD_Q1_MARGIN']) DISP[k] = disp[k];

  console.log(`/* ============================================================
   PRIORS NBA 2026-27 — generado por scripts/build-nba-priors.js
   el ${new Date().toISOString().slice(0, 10)} desde ${YEARS[0] - 1}-${String(YEARS[0]).slice(2)} → ${YEARS[2] - 1}-${String(YEARS[2]).slice(2)} (${fit.diag.games} juegos, ESPN),
   ajustados por rival (lib/nba/fit.js, half-life ${HALF_LIFE_DAYS} días), con
   descanso y ausencias descontados, y regresados a la media (carry
   ${CARRY}). off/def en puntos por 100 posesiones vs promedio de liga;
   pace en posesiones por juego vs promedio. NO editar a mano: regenerar.
   ============================================================ */
const LEAGUE = { mu: ${fit.mu}, hfa: ${fit.hfa}, poss: ${fit.poss} }; // eficiencia media, localía (margen pts/100), posesiones por juego

/* Parámetros validados en scripts/nba-backtest.js (walk-forward 2025-26). */
const PARAMS = {
  CARRY: ${CARRY},
  K: ${K},            // aprendizaje de eficiencia por resultado
  KP: ${KP},          // aprendizaje del ritmo
  ABS_C: ${ABS_C},    // peso del Game Score de los ausentes (techo medido con ausencias perfectas: ${ABS_C + 0.05})
  LUCK: ${JSON.stringify(LUCK)},
  /* descanso, en pts/100 de eficiencia (residuo medio por categoría,
     encogido). "long" = 6+ días sin jugar: se juega PEOR (oxidado). */
  REST: ${JSON.stringify(REST)},
};
/* n por categoría: ${JSON.stringify(Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.n])))} */

/* Dispersión FUERA DE MUESTRA (walk-forward 2025-26, ${disp.n} juegos):
   margen y total alrededor de la predicción; fracciones y sd de la
   1ª mitad y el 1er cuarto sobre los parciales reales. */
const DISP = ${JSON.stringify(DISP, null, 2)};

const PRIORS = ${JSON.stringify(PRIORS, null, 2)};

module.exports = { PRIORS, LEAGUE, PARAMS, DISP };`);
  console.error(`fit: mu=${fit.mu} hfa=${fit.hfa} poss=${fit.poss} · resid sd ortg=${fit.diag.resid_sd_ortg} margen=${fit.diag.resid_sd_margin} total=${fit.diag.resid_sd_total}`);
  console.error('REST', JSON.stringify(REST), 'DISP', JSON.stringify(DISP));
}

main().catch(e => { console.error(e); process.exit(1); });
