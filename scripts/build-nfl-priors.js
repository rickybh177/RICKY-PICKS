#!/usr/bin/env node
/* ============================================================
   Genera lib/nfl/priors.js — ratings iniciales 2026 + parámetros
   de liga y de PRETEMPORADA.

   Método (misma receta que build-mx-priors):
   - Ratings off/def AJUSTADOS POR RIVAL (lib/nfl/fit.js) sobre
     las temporadas 2024 y 2025 completas (regular + playoffs)
     con decaimiento temporal — no promedios crudos de PF/PA:
     una ofensiva que anotó 27 contra puras defensas top vale más
     que una que anotó 27 contra coladeras, y el fit lo sabe.
   - mu (puntos por equipo) y hfa (ventaja de local) salen del
     mismo ajuste, en forma cerrada.
   - CARRY: solo una parte de la ventaja 2025 se hereda al 2026
     (rosters nuevos). Validado con walk-forward (nfl-backtest).
   - PRETEMPORADA: ratings, mu y hfa PROPIOS, ajustados contra
     pretemporadas anteriores únicamente. Los ratings de temporada
     regular no sirven en agosto (corr ≈ 0); lo que persiste es el
     desempeño de la propia pretemporada (corr ≈ 0.21).

   Uso:  node scripts/build-nfl-priors.js > lib/nfl/priors.js
   ============================================================ */
const { getSeasonGames } = require('./nfl-history');
const { fitRatings, fitPreseasonRatings, HALF_LIFE_DAYS, PRE_CARRY } = require('../lib/nfl/fit');

const CARRY = 0.6;    // validado con nfl-backtest (grid 0.35–1.0)
const AS_OF = '2026-08-01';

async function main() {
  // ---- temporada regular + playoffs, 2024 y 2025 ----
  const games = [];
  for (const year of [2024, 2025]) {
    games.push(...await getSeasonGames(year, 2));
    games.push(...await getSeasonGames(year, 3));
  }
  const fit = fitRatings(games, { asOf: new Date(AS_OF + 'T00:00:00Z').getTime() });
  const teams = Object.keys(fit.ratings).sort();
  if (teams.length !== 32) throw new Error('Se esperaban 32 equipos, llegaron ' + teams.length);

  const out = {};
  for (const t of teams) {
    out[t] = {
      off: +(fit.ratings[t].off * CARRY).toFixed(2),
      def: +(fit.ratings[t].def * CARRY).toFixed(2),
    };
  }

  // ---- pretemporada: ajuste contra pretemporadas anteriores ----
  const preGames = [];
  for (const year of [2021, 2022, 2023, 2024, 2025]) preGames.push(...await getSeasonGames(year, 1));
  const pre = fitPreseasonRatings(preGames, { asOf: new Date(AS_OF + 'T00:00:00Z').getTime() });

  console.log(`/* ============================================================
   PRIORS NFL 2026 — generado por scripts/build-nfl-priors.js
   el ${new Date().toISOString().slice(0, 10)} desde 2024+2025 (regular+playoffs, ESPN),
   ajustados por rival (lib/nfl/fit.js, half-life ${HALF_LIFE_DAYS} días) y
   regresados a la media (carry ${CARRY}). off/def en puntos por juego
   vs promedio de liga. NO editar a mano: regenerar.
   ============================================================ */
const LEAGUE_PPG = ${fit.mu}; // puntos por equipo por juego (fit 2024-25)
const HFA = ${fit.hfa};        // ventaja de local total, en puntos de margen

/* PRETEMPORADA — universo aparte, ajustado SOLO con pretemporadas
   2021-2025 (${pre.diag.games} juegos, carry ${PRE_CARRY}).
   Los ratings de temporada regular no predicen agosto (corr ≈ 0);
   lo que persiste es el desempeño de la propia pretemporada
   (corr ≈ 0.21): filosofía del coach y profundidad del roster.
   La localía en agosto es casi nula (~0.2 pts) — el fit la saca. */
const PRESEASON = ${JSON.stringify(pre, null, 2)};

const PRIORS = ${JSON.stringify(out, null, 2)};

module.exports = { PRIORS, LEAGUE_PPG, HFA, PRESEASON };`);
}

main().catch(e => { console.error(e); process.exit(1); });
