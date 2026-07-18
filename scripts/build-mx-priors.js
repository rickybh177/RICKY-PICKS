#!/usr/bin/env node
/* ============================================================
   Genera lib/mx/priors.js para el modelo Liga MX.

   1. Descarga TODOS los resultados de mex.1 (ESPN) desde el
      Clausura 2024 hasta el día previo al Apertura 2026
      (2026-07-14). El corte importa: el modelo en runtime
      aprende solo de los juegos del Apertura 2026, así que los
      priors NO deben incluirlos (ni doble conteo ni fuga).
   2. Ajusta Dixon-Coles con decaimiento temporal (lib/mx/fit).
   3. Priors de córneres con los summaries del Clausura 2026.
   4. Escribe lib/mx/priors.js. NO editar ese archivo a mano.

   Uso:  node scripts/build-mx-priors.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { getRangeChunked, getMatchStats } = require('../lib/mx/data');
const { fitDixonColes, HALF_LIFE_DAYS } = require('../lib/mx/fit');
const { TEAMS } = require('../lib/mx/teams');

const HIST_START = '2024-01-01';
const HIST_END = '2026-07-14';          // víspera del Apertura 2026
const CORNERS_START = '2026-01-01';     // Clausura 2026 para córneres
const HOME_ADV_DEFAULT_CORNERS = 1.0;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

(async () => {
  console.log(`Descargando resultados ${HIST_START} → ${HIST_END}…`);
  const all = await getRangeChunked(HIST_START, HIST_END);
  const done = all.filter(g => g.completed && g.home.score != null && g.away.score != null);
  const slugs = {};
  for (const g of done) slugs[g.seasonSlug || '?'] = (slugs[g.seasonSlug || '?'] || 0) + 1;
  console.log(`  ${all.length} eventos, ${done.length} terminados. Torneos:`, slugs);

  console.log('Ajustando Dixon-Coles (decaimiento ' + HALF_LIFE_DAYS + 'd)…');
  const asOf = new Date(HIST_END + 'T23:59:59Z').getTime();
  const fit = fitDixonColes(done, { asOf });
  console.log('  mu=%s hfa=%s altC=%s rho=%s', fit.mu, fit.hfa, fit.altC, fit.rho);
  console.log('  liga:', fit.diag);
  const table = Object.keys(TEAMS)
    .map(t => ({ t, ...(fit.ratings[t] || { att: 0, def: 0 }) }))
    .sort((a, b) => (b.att - b.def) - (a.att - a.def));
  for (const r of table) console.log(`  ${r.t.padEnd(5)} att=${String(r.att).padStart(7)} def=${String(r.def).padStart(7)}`);

  /* ---- córneres: summaries del Clausura 2026 ---- */
  console.log(`Descargando estadísticas de córneres ${CORNERS_START} → ${HIST_END}…`);
  const recent = done.filter(g => g.date >= CORNERS_START);
  const stats = await mapLimit(recent, 6, async g => ({ g, s: await getMatchStats(g.id) }));
  const corn = {}; // abbr -> {forSum, agSum, n}
  let leagueHome = 0, leagueAway = 0, nGames = 0;
  for (const { g, s } of stats) {
    if (!s || !s.home || !s.away || s.home.corners == null || s.away.corners == null) continue;
    nGames++;
    leagueHome += s.home.corners; leagueAway += s.away.corners;
    for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
      const ab = g[side].abbr;
      corn[ab] = corn[ab] || { f: 0, a: 0, n: 0 };
      corn[ab].f += s[side].corners; corn[ab].a += s[opp].corners; corn[ab].n++;
    }
  }
  const cMuHome = nGames ? leagueHome / nGames : 5.2;
  const cMuAway = nGames ? leagueAway / nGames : 4.3;
  const cMu = (cMuHome + cMuAway) / 2;
  console.log(`  ${nGames} juegos con córneres. Liga: local ${cMuHome.toFixed(2)}, visita ${cMuAway.toFixed(2)}`);
  const CORNERS = {};
  for (const t of Object.keys(TEAMS)) {
    const c = corn[t];
    if (c && c.n >= 5) {
      // factor relativo, encogido hacia 1 con n/(n+10)
      const shr = c.n / (c.n + 10);
      CORNERS[t] = {
        f: +(1 + shr * (c.f / c.n / cMu - 1)).toFixed(3),
        a: +(1 + shr * (c.a / c.n / cMu - 1)).toFixed(3),
      };
    } else {
      CORNERS[t] = { f: 0.95, a: 1.05 }; // recién ascendido: genera menos, concede más
    }
  }

  /* ---- escribir priors.js ---- */
  const RATINGS = {};
  for (const t of Object.keys(TEAMS)) RATINGS[t] = fit.ratings[t] || { att: -0.20, def: 0.12 };

  const out = `/* ============================================================
   PRIORS LIGA MX — APERTURA 2026
   Generado por scripts/build-mx-priors.js el ${new Date().toISOString().slice(0, 10)}
   con ${fit.diag.games} partidos de mex.1 (${HIST_START} → ${HIST_END},
   decaimiento de ${HALF_LIFE_DAYS} días). NO editar a mano: regenerar
   con el script.
   att = fuerza ofensiva, def = debilidad defensiva (escala log).
   ============================================================ */
const LEAGUE = {
  mu: ${fit.mu},        // log-goles base por equipo
  hfa: ${fit.hfa},       // ventaja de local (log)
  altC: ${fit.altC},      // empuje por km de altitud cuesta arriba
  rho: ${fit.rho},       // corrección Dixon-Coles de marcadores bajos
  avg_home_goals: ${fit.diag.avg_home_goals},
  avg_away_goals: ${fit.diag.avg_away_goals},
  draw_rate: ${fit.diag.draw_rate},
  fit_games: ${fit.diag.games},
  corners_home: ${+cMuHome.toFixed(2)},
  corners_away: ${+cMuAway.toFixed(2)},
};

const PRIORS = ${JSON.stringify(RATINGS, null, 2)};

const CORNERS = ${JSON.stringify(CORNERS, null, 2)};

module.exports = { LEAGUE, PRIORS, CORNERS };
`;
  const dest = path.join(__dirname, '..', 'lib', 'mx', 'priors.js');
  fs.writeFileSync(dest, out);
  console.log('Escrito', dest);
})().catch(e => { console.error(e); process.exit(1); });
