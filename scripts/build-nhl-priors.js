#!/usr/bin/env node
/* ============================================================
   Genera lib/nhl/priors.js — ratings iniciales 2026-27 + parámetros
   de liga, descanso, porteros y dispersión del motor.

   Método (misma receta que build-nba-priors):
   - Ratings att/def (escala log, Poisson) AJUSTADOS POR RIVAL
     (lib/nhl/fit.js) sobre 2022-23 → 2025-26 (regular + playoffs) con
     decaimiento temporal — no promedios crudos. El objetivo de cada
     juego es el mismo del aprendizaje en línea: goles reglamentarios
     sin puerta vacía, mezclados con los "merecidos" por tiros.
   - El fit descuenta el offset conocido del segundo juego en dos
     noches; en runtime se vuelve a sumar.
   - CARRY: solo una parte de la ventaja se hereda a la temporada nueva.
   - GOALIES / TEAM_REF: tiros y goles evitados de cada portero
     (decaídos entre temporadas) y la mezcla de porteros con la que
     cada equipo ganó su rating defensivo.
   - DISP: pesos por diferencia de goles, puerta vacía, tiempo extra y
     1er periodo medidos FUERA DE MUESTRA (walk-forward de 2023-24,
     2024-25 y 2025-26, cada una con ratings de las anteriores).

   Uso:  node scripts/build-nhl-priors.js > lib/nhl/priors.js
   ============================================================ */
const { seasons, restLookup, fitWith, estimateRest, measureDispersion } = require('./nhl-common');
const { learnRatings, goalieTable } = require('../lib/nhl/core');
const { REG_W } = require('../lib/nhl/fit');
const PROD = require('./nhl-params');

const YEARS = [2023, 2024, 2025, 2026];
const SEASON = 2027;
const AS_OF = '2026-10-01';
const MIN_SA = 150; // porteros con menos tiros (ya decaídos) no se guardan: su nivel encogido es ~0

async function main() {
  const games = seasons(YEARS);
  const asOf = new Date(AS_OF + 'T00:00:00Z').getTime();
  const rest = restLookup(games);
  const fitterP = { SHOTS_W: PROD.SHOTS_W, SHOT_KIND: PROD.SHOT_KIND, EN_OUT: PROD.EN_OUT };

  // 1) fit sin descanso → efecto del descanso → fit final
  const fit0 = fitWith(games, { asOf, halfLife: PROD.HALF_LIFE, params: fitterP });
  const { REST, detail } = estimateRest(games, fit0, rest);
  const fit = fitWith(games, { asOf, halfLife: PROD.HALF_LIFE, params: fitterP, REST, rest });
  const teams = Object.keys(fit.ratings).sort();
  if (teams.length !== 32) throw new Error('Se esperaban 32 equipos, llegaron ' + teams.length);
  const PRIORS = {};
  for (const t of teams) PRIORS[t] = { att: +(fit.ratings[t].att * PROD.CARRY).toFixed(4), def: +(fit.ratings[t].def * PROD.CARRY).toFixed(4) };
  const LEAGUE = { mu: fit.mu, hfa: fit.hfa, conv: { [PROD.SHOT_KIND]: fit.conv[PROD.SHOT_KIND], sog: fit.conv.sog } };

  // 2) porteros
  const gt = goalieTable(games, LEAGUE, { params: PROD });
  const GOALIES = {};
  const names = {};
  for (const g of games) for (const s of [g.home, g.away]) if (s.goalie) names[s.goalie.id] = s.goalie.name;
  for (const id of Object.keys(gt.G).sort((a, b) => gt.G[b].sa - gt.G[a].sa)) {
    if (gt.G[id].sa < MIN_SA) continue;
    GOALIES[id] = { n: names[id] || '', sa: Math.round(gt.G[id].sa), gsa: +gt.G[id].gsa.toFixed(2) };
  }
  const TEAM_REF = {};
  for (const t of teams) TEAM_REF[t] = +((gt.teamRef[t] || 0)).toFixed(5);

  // 3) dispersión FUERA DE MUESTRA: cada temporada con ratings de las anteriores
  const rows = [];
  for (const y of YEARS.slice(1)) {
    const fs = seasons(YEARS.filter(x => x < y));
    const f = fitWith(fs, { asOf: new Date(`${y - 1}-10-01T00:00:00Z`).getTime(), halfLife: PROD.HALF_LIFE, params: fitterP, REST, rest });
    const L = { mu: f.mu, hfa: f.hfa, conv: f.conv };
    const g0 = goalieTable(fs, L, { params: PROD });
    const pri = {};
    for (const t in f.ratings) pri[t] = { att: f.ratings[t].att * PROD.CARRY, def: f.ratings[t].def * PROD.CARRY };
    learnRatings(seasons([y]).filter(g => g.seasontype === 2), { priors: pri, league: L, params: { ...PROD, REST }, goalies: g0.G, teamRef: g0.teamRef },
      (g, e) => rows.push({ g, lh: e.lh, la: e.la }));
  }
  const d = measureDispersion(rows);
  const DISP = { MARGIN_W: d.MARGIN_W, EN: d.EN, OT_S: d.OT_S, OT_HOME: d.OT_HOME, P1_SHARE: d.P1_SHARE };

  const PARAMS = {
    CARRY: PROD.CARRY, K: PROD.K, SHOTS_W: PROD.SHOTS_W, SHOT_KIND: PROD.SHOT_KIND, EN_OUT: PROD.EN_OUT,
    MU_SHIFT_N: PROD.MU_SHIFT_N, G_C: PROD.G_C, G_N0: PROD.G_N0, REST,
  };

  console.log(`/* ============================================================
   PRIORS NHL ${SEASON - 1}-${String(SEASON).slice(2)} — generado por scripts/build-nhl-priors.js
   el ${new Date().toISOString().slice(0, 10)} desde ${YEARS[0] - 1}-${String(YEARS[0]).slice(2)} → ${YEARS[YEARS.length - 1] - 1}-${String(YEARS[YEARS.length - 1]).slice(2)} (${fit.diag.games} juegos, ESPN),
   ajustados por rival (lib/nhl/fit.js, half-life ${PROD.HALF_LIFE} días, ${REG_W}
   pseudo-juegos), con el segundo juego en dos noches descontado, y
   regresados a la media (carry ${PROD.CARRY}). att/def en escala log vs
   promedio de liga (def positivo = concede menos). NO editar a mano:
   regenerar. Nada de esto sale al navegador.
   ============================================================ */
/* mu = log de goles LIMPIOS (tiempo reglamentario, sin puerta vacía)
   por equipo; hfa = localía (log, total entre los dos lados); conv =
   goles limpios por tiro a puerta. */
const LEAGUE = ${JSON.stringify(LEAGUE)};

/* Parámetros validados en scripts/nhl-backtest.js (walk-forward 2025-26 y 2024-25). */
const PARAMS = ${JSON.stringify(PARAMS, null, 2)};
/* segundo juego en dos noches: n=${detail.n} equipo-juegos, crudo ataque ${detail.raw_att} / concede ${detail.raw_def} */

/* Dispersión del motor, FUERA DE MUESTRA (${d.n} juegos; ${d.n_ot} con tiempo
   extra = ${(100 * d.ot_rate).toFixed(1)}%, el local gana ${(100 * d.ot_home_raw).toFixed(1)}% de ellos). */
const DISP = ${JSON.stringify(DISP, null, 2)};

const PRIORS = ${JSON.stringify(PRIORS, null, 2)};

/* Porteros: tiros recibidos y goles evitados sobre el promedio,
   decaídos entre temporadas (id de ESPN). */
const GOALIES = {
${Object.entries(GOALIES).map(([id, v]) => `  ${id}: ${JSON.stringify(v)},`).join('\n')}
};
/* Nivel de la mezcla de porteros con la que cada equipo ganó su rating. */
const TEAM_REF = ${JSON.stringify(TEAM_REF)};

module.exports = { PRIORS, LEAGUE, PARAMS, DISP, GOALIES, TEAM_REF };`);
  console.error(`fit: goles limpios/equipo=${fit.diag.goals_per_team} hfa=${fit.hfa} conv=${JSON.stringify(fit.conv)} · porteros ${Object.keys(GOALIES).length}`);
  console.error('REST', JSON.stringify(REST), 'DISP', JSON.stringify(d));
}

main().catch(e => { console.error(e); process.exit(1); });
