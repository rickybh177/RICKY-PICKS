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
   - PRETEMPORADA: mu/hfa/beta propios, ajustados contra las
     pretemporadas 2024-2025 reales. beta = cuánto asoman los
     ratings de temporada regular en agosto (titulares juegan
     poco → beta chico).

   Uso:  node scripts/build-nfl-priors.js > lib/nfl/priors.js
   ============================================================ */
const { getSeasonGames } = require('./nfl-history');
const { fitRatings, fitPreseason, HALF_LIFE_DAYS } = require('../lib/nfl/fit');

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

  // ---- pretemporada: ratings vigentes en agosto de cada año ----
  const ratingsByYear = {};
  for (const year of [2024, 2025]) {
    const hist = [];
    for (const y of [year - 2, year - 1]) {
      hist.push(...await getSeasonGames(y, 2));
      hist.push(...await getSeasonGames(y, 3));
    }
    const f = fitRatings(hist, { asOf: new Date(`${year}-08-01T00:00:00Z`).getTime() });
    const R = {};
    for (const t in f.ratings) R[t] = { off: f.ratings[t].off * CARRY, def: f.ratings[t].def * CARRY };
    ratingsByYear[year] = R;
  }
  const preGames = [];
  for (const year of [2024, 2025]) preGames.push(...await getSeasonGames(year, 1));
  const pre = fitPreseason(preGames, ratingsByYear);

  console.log(`/* ============================================================
   PRIORS NFL 2026 — generado por scripts/build-nfl-priors.js
   el ${new Date().toISOString().slice(0, 10)} desde 2024+2025 (regular+playoffs, ESPN),
   ajustados por rival (lib/nfl/fit.js, half-life ${HALF_LIFE_DAYS} días) y
   regresados a la media (carry ${CARRY}). off/def en puntos por juego
   vs promedio de liga. PRESEASON ajustado con las pretemporadas
   2024-2025 (${pre.diag.rows / 2} juegos). NO editar a mano: regenerar.
   ============================================================ */
const LEAGUE_PPG = ${fit.mu}; // puntos por equipo por juego (fit 2024-25)
const HFA = ${fit.hfa};        // ventaja de local total, en puntos de margen

/* Pretemporada: entorno propio (titulares juegan poco).
   beta = fracción del rating regular que asoma en agosto. */
const PRESEASON = ${JSON.stringify(pre, null, 2)};

const PRIORS = ${JSON.stringify(out, null, 2)};

module.exports = { PRIORS, LEAGUE_PPG, HFA, PRESEASON };`);
}

main().catch(e => { console.error(e); process.exit(1); });
