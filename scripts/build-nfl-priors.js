#!/usr/bin/env node
/* ============================================================
   Genera lib/nfl/priors.js — ratings iniciales 2026 por equipo.

   Fuente: temporada 2025 completa (PF/PA por equipo, ESPN).
   Método: rating ofensivo/defensivo en puntos por juego vs el
   promedio de la liga, con REGRESIÓN a la media (55%) porque el
   año nuevo trae rosters nuevos — los ratings se auto-corrigen
   en temporada con los resultados reales (ver lib/nfl/model.js).

   Uso:  node scripts/build-nfl-priors.js > lib/nfl/priors.js
   ============================================================ */

async function main() {
  const url = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=2025&level=1';
  const res = await fetch(url);
  const j = await res.json();

  const teams = [];
  (function walk(node) {
    if (node.standings && node.standings.entries) {
      for (const en of node.standings.entries) {
        const g = k => { const s = en.stats.find(x => x.name === k); return s ? s.value : null; };
        teams.push({
          abbr: en.team.abbreviation,
          gp: (g('wins') || 0) + (g('losses') || 0) + (g('ties') || 0),
          pf: g('pointsFor'),
          pa: g('pointsAgainst'),
        });
      }
    }
    (node.children || []).forEach(walk);
  })(j);

  if (teams.length !== 32) throw new Error('Se esperaban 32 equipos, llegaron ' + teams.length);

  const totalPts = teams.reduce((s, t) => s + t.pf, 0);
  const totalGp = teams.reduce((s, t) => s + t.gp, 0);
  const LPT = totalPts / totalGp; // puntos promedio por equipo por juego

  // Regresión: solo el 45% de la ventaja/desventaja de 2025 se hereda a 2026.
  const CARRY = 0.45;

  const out = {};
  for (const t of teams.sort((a, b) => a.abbr.localeCompare(b.abbr))) {
    const offRaw = t.pf / t.gp - LPT;
    const defRaw = LPT - t.pa / t.gp; // positivo = buena defensa
    out[t.abbr] = {
      off: +(offRaw * CARRY).toFixed(2),
      def: +(defRaw * CARRY).toFixed(2),
    };
  }

  console.log(`/* ============================================================
   PRIORS NFL 2026 — generado por scripts/build-nfl-priors.js
   el ${new Date().toISOString().slice(0, 10)} desde la temporada 2025 (ESPN).
   off/def = puntos por juego vs promedio de liga, ya regresados
   a la media (45% de arrastre año-a-año). NO editar a mano:
   regenerar con el script.
   ============================================================ */
const LEAGUE_PPG = ${LPT.toFixed(2)}; // puntos por equipo por juego, liga 2025

const PRIORS = ${JSON.stringify(out, null, 2)};

module.exports = { PRIORS, LEAGUE_PPG };`);
}

main().catch(e => { console.error(e); process.exit(1); });
