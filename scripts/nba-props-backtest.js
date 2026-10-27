#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — props de jugador NBA contra 2025-26.

   Para cada juego de la temporada regular 2025-26 (desde el juego 10
   de cada equipo), cada jugador con historial suficiente ANTES de ese
   juego recibe una proyección (lib/nba/props.js) usando solo juegos
   previos, y se compara con lo que hizo. El entorno (puntos y
   posesiones esperados) sale del modelo de equipo en walk-forward
   (misma learnRatings del runtime).

   Reporta, por mercado:
   - MAE del modelo vs dos bases: promedio de la temporada hasta ese
     juego y promedio de los últimos 5;
   - sesgo (real − proyección) y cobertura ±1σ;
   - calibración: P(over) predicha vs realizada en líneas sintéticas
     mu ± k·sd (sin líneas históricas de props, es la prueba de que la
     probabilidad dice la verdad — y donde las casas ponen la línea);
   - doble-doble: predicho vs real por decil;
   - sensibilidad a los exponentes de entorno y al peso del rival.

   Uso:  node scripts/nba-props-backtest.js
   ============================================================ */
const { seasons, absenceLookup, restLookup, fitWith, estimateRest, ALT_TEAMS } = require('./nba-common');
const { learnRatings } = require('../lib/nba/core');
const { loadHistory, buildIndex } = require('../lib/nba/players');
const props = require('../lib/nba/props');
const { buildPropsIndex, projectPlayer, probOver, STATS, PARAMS, get } = props;

const TEST = 2026, FIT = [2024, 2025];
const MIN_TEAM_GAME = 10;

(async () => {
  /* ---- entorno por juego (walk-forward) ---- */
  const fitSet = seasons(FIT), test = seasons([TEST]).filter(g => g.seasontype === 2);
  const absences = absenceLookup([...FIT, TEST]);
  const rest = restLookup([...fitSet, ...test]);
  const asOf = new Date('2025-10-01T00:00:00Z').getTime();
  const fit0 = fitWith(fitSet, { asOf, ABS_C: 0.3, absences, rest });
  const { REST } = estimateRest(fitSet, fit0, rest, { absences, ABS_C: 0.3 });
  const fit = fitWith(fitSet, { asOf, REST, ABS_C: 0.3, absences, rest });
  const priors = {};
  for (const t in fit.ratings) priors[t] = { off: fit.ratings[t].off * 0.7, def: fit.ratings[t].def * 0.7, pace: fit.ratings[t].pace * 0.7 };
  const env = new Map();
  learnRatings(test, { priors, league: { mu: fit.mu, hfa: fit.hfa, poss: fit.poss }, params: { K: 0.05, KP: 0.1, REST, ABS_C: 0.3 }, absences, altTeams: ALT_TEAMS },
    (g, e) => env.set(g.id, { expH: e.expH, expA: e.expA, poss: e.poss }));

  /* ---- historial de jugadores ---- */
  const rows = loadHistory({ years: [2025, 2026] });
  const idx = buildIndex(rows);
  const pidx = buildPropsIndex(idx);
  console.log(`historial: ${rows.length} filas · ${idx.byPlayer.size} jugadores · cv:`, Object.fromEntries(Object.entries(pidx.cv).map(([k, v]) => [k, +v.toFixed(2)])));

  // objetivo: filas 2025-26 regular con ≥8 min, a partir del juego 10 del equipo
  const gameNo = new Map(); // team|gameId -> n-ésimo juego del equipo en la temporada
  for (const [team, list] of idx.teamGames) { let k = 0; for (const tg of list) if (tg.date >= '2025-10-01') gameNo.set(team + '|' + tg.gameId, ++k); }
  const targets = rows.filter(r => r.season === TEST && r.seasontype === 2 && !r.dnp && r.min >= 8 && (gameNo.get(r.team + '|' + r.gameId) || 0) >= MIN_TEAM_GAME);
  console.log(`objetivo: ${targets.length} filas jugador-juego`);

  function run() {
    const M = {};
    const acc = s => (M[s] = M[s] || { n: 0, ae: 0, aeSeason: 0, aeLast5: 0, bias: 0, cov: 0, bins: {} });
    const DD = { n: 0, pred: 0, real: 0, buckets: {} };
    const MIN = { n: 0, ae: 0, bias: 0 };
    for (const r of targets) {
      const e = env.get(r.gameId);
      const proj = projectPlayer(pidx, r.id, { date: r.date, team: r.team, opp: r.opp, expPts: e ? (r.home ? e.expH : e.expA) : null, expPoss: e ? e.poss : null, lgPoss: fit.poss });
      if (!proj) continue;
      MIN.n++; MIN.ae += Math.abs(r.min - proj.minutes); MIN.bias += r.min - proj.minutes;
      const prev = (idx.byPlayer.get(r.id) || []).filter(x => x.date < r.date && !x.dnp && x.min >= 8);
      const season = prev.filter(x => x.date >= '2025-10-01');
      const base = season.length ? season : prev;
      for (const s of STATS) {
        const m = proj.markets[s]; if (!m) continue;
        const real = get[s](r);
        const A = acc(s);
        const bS = base.reduce((t, x) => t + get[s](x), 0) / base.length;
        const l5 = prev.slice(-5); const b5 = l5.reduce((t, x) => t + get[s](x), 0) / l5.length;
        A.n++; A.ae += Math.abs(real - m.mu); A.aeSeason += Math.abs(real - bS); A.aeLast5 += Math.abs(real - b5); A.bias += real - m.mu;
        if (Math.abs(real - m.mu) <= m.sd) A.cov++;
        for (const k of [-1, -0.5, 0, 0.5, 1]) {
          const line = Math.max(0.5, Math.round(m.mu + k * m.sd) - 0.5); // líneas .5 como las casas
          const p = probOver(m, line);
          const key = String(k);
          A.bins[key] = A.bins[key] || { n: 0, p: 0, h: 0 };
          A.bins[key].n++; A.bins[key].p += p; A.bins[key].h += real > line ? 1 : 0;
        }
      }
      const dd = proj.markets.dd;
      if (dd) {
        const hit = [r.pts, r.reb, r.ast].filter(v => v >= 10).length >= 2 ? 1 : 0;
        DD.n++; DD.pred += dd.p; DD.real += hit;
        const b = Math.min(9, Math.floor(dd.p * 10));
        DD.buckets[b] = DD.buckets[b] || { n: 0, p: 0, h: 0 }; DD.buckets[b].n++; DD.buckets[b].p += dd.p; DD.buckets[b].h += hit;
      }
    }
    return { M, DD, MIN };
  }
  const show = ({ M, DD, MIN }, full) => {
    console.log(`  minutos           n=${MIN.n} · MAE ${(MIN.ae / MIN.n).toFixed(2)} · sesgo ${(MIN.bias / MIN.n >= 0 ? '+' : '')}${(MIN.bias / MIN.n).toFixed(2)}`);
    for (const s of STATS) {
      const A = M[s]; if (!A) continue;
      console.log(`  ${s.padEnd(17)} n=${A.n} · MAE modelo ${(A.ae / A.n).toFixed(2)} · temporada ${(A.aeSeason / A.n).toFixed(2)} · últimos5 ${(A.aeLast5 / A.n).toFixed(2)} · sesgo ${(A.bias / A.n >= 0 ? '+' : '')}${(A.bias / A.n).toFixed(2)} · dentro de 1σ ${(A.cov / A.n * 100).toFixed(0)}%`);
      if (full) console.log(`  ${''.padEnd(17)} calibración over → ` + Object.keys(A.bins).map(k => `${k}σ: pred ${(A.bins[k].p / A.bins[k].n * 100).toFixed(0)}% real ${(A.bins[k].h / A.bins[k].n * 100).toFixed(0)}%`).join(' · '));
    }
    if (DD.n) {
      console.log(`  doble-doble       n=${DD.n} · P pred ${(DD.pred / DD.n * 100).toFixed(1)}% · real ${(DD.real / DD.n * 100).toFixed(1)}%`);
      if (full) console.log(`  ${''.padEnd(17)} calibración → ` + Object.keys(DD.buckets).sort().map(b => `${b * 10}s: pred ${(DD.buckets[b].p / DD.buckets[b].n * 100).toFixed(0)}% real ${(DD.buckets[b].h / DD.buckets[b].n * 100).toFixed(0)}% (n=${DD.buckets[b].n})`).join(' · '));
    }
  };

  console.log('\n=== PRODUCCIÓN (parámetros actuales) ===');
  show(run(), true);

  const grid = (name, key, vals, stats) => {
    console.log(`\n=== Sensibilidad: ${name} ===`);
    const v0 = PARAMS[key];
    for (const v of vals) {
      Object.assign(PARAMS, { [key]: v });
      pidx._defMemo = null; pidx._lgMemo = null; // el memo del factor rival depende de los parámetros
      const { M } = run();
      console.log(`  ${key}=${JSON.stringify(v)}: MAE ` + stats.map(s => `${s} ${(M[s].ae / M[s].n).toFixed(3)}`).join(' · '));
    }
    Object.assign(PARAMS, { [key]: v0 });
  };
  grid('ENV_EXP_PTS (entorno de puntos)', 'ENV_EXP_PTS', [0, 0.3, 0.5, 0.8, 1.0], ['pts', 'pra']);
  grid('ENV_EXP_PACE (ritmo)', 'ENV_EXP_PACE', [0, 0.4, 0.8, 1.2], ['reb', 'ast', 'tpm']);
  grid('DEF_SHRINK (defensa rival)', 'DEF_SHRINK', [0, 0.25, 0.5, 0.75, 1.0], ['pts', 'reb', 'ast', 'tpm']);
  grid('MIN_HALF_LIFE (recencia de minutos)', 'MIN_HALF_LIFE', [2, 3, 5, 8, 15], ['pts', 'reb', 'ast']);
  grid('RATE_HALF_LIFE (recencia de ritmos)', 'RATE_HALF_LIFE', [4, 7, 10, 15, 30], ['pts', 'reb', 'ast', 'tpm']);
  grid('MAX_GAMES (muestra)', 'MAX_GAMES', [12, 18, 25, 40], ['pts', 'reb', 'ast']);
})().catch(e => { console.error(e); process.exit(1); });
