#!/usr/bin/env node
/* ============================================================
   BACKTEST WALK-FORWARD — props de jugador NFL contra la 2025.

   Para cada juego de la temporada regular 2025 (semana ≥ 3), cada
   jugador con historial suficiente ANTES de ese juego recibe una
   proyección (lib/nfl/props.js) usando solo juegos previos, y se
   compara con lo que hizo de verdad. Los puntos esperados de cada
   equipo (factor de entorno) salen del modelo de equipo en
   walk-forward (misma learnRatings del runtime).

   Reporta, por mercado:
   - MAE del modelo vs dos bases: promedio de la temporada hasta
     ese juego y promedio de los últimos 3;
   - sesgo (real − proyección);
   - calibración: P(over) predicha vs realizada en líneas
     sintéticas mu ± k·sd (sin líneas históricas del mercado, esto
     es la prueba de que las probabilidades dicen la verdad);
   - sensibilidad a ENV_EXP y DEF_SHRINK.

   Uso:  node scripts/nfl-props-backtest.js
   ============================================================ */
const { getSeasonGames } = require('./nfl-history');
const { fitRatings } = require('../lib/nfl/fit');
const { learnRatings } = require('../lib/nfl/model');
const props = require('../lib/nfl/props');
const { loadHistory, buildIndex, projectPlayer, probOver, probAtLeastOne, statsFor, STAT_GET, QUALIFY, PARAMS } = props;

const MIN_WEEK = 3;

(async () => {
  /* ---- entorno: puntos esperados por equipo-juego (walk-forward) ---- */
  const fitSet = [];
  for (const y of [2023, 2024]) { fitSet.push(...await getSeasonGames(y, 2)); fitSet.push(...await getSeasonGames(y, 3)); }
  const test = (await getSeasonGames(2025, 2)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const fit = fitRatings(fitSet, { asOf: new Date('2025-09-01T00:00:00Z').getTime() });
  const priors = {};
  for (const t in fit.ratings) priors[t] = { off: fit.ratings[t].off * 0.6, def: fit.ratings[t].def * 0.6 };
  const expById = new Map();
  learnRatings(test, { priors, mu: fit.mu, hfa: fit.hfa, k: 0.10, muShiftOn: true }, (g, expH, expA) => {
    expById.set(String(g.id), { home: g.home.abbr, away: g.away.abbr, expH, expA, week: g.week, date: g.date });
  });

  /* ---- historial de jugadores ---- */
  const rows = loadHistory({ years: [2024, 2025] });
  const idx = buildIndex(rows);
  console.log(`historial: ${rows.length} filas · ${idx.byPlayer.size} jugadores · cv:`,
    Object.fromEntries(Object.entries(idx.cv).map(([k, v]) => [k, +v.toFixed(2)])));

  // filas objetivo: 2025 regular, semana ≥ MIN_WEEK, con participación real
  const targets = rows.filter(r => r.seasontype === 2 && r.date >= '2025-09-01' && r.week >= MIN_WEEK && (QUALIFY[r.pos] || QUALIFY.WR)(r));

  function run(label) {
    const M = {}; // stat -> acumuladores
    const acc = s => (M[s] = M[s] || { n: 0, ae: 0, aeSeason: 0, aeLast3: 0, bias: 0, cov: 0, bins: {} , td: { n: 0, pred: 0, real: 0, buckets: {} } });
    for (const r of targets) {
      const env = expById.get(r.gameId);
      const expPts = env ? (r.home ? env.expH : env.expA) : null;
      const proj = projectPlayer(idx, r.id, r.pos, { date: r.date, opp: r.opp, expPts });
      if (!proj) continue;
      // bases: promedio temporada-a-la-fecha y últimos 3 (juegos calificados previos)
      const prev = (idx.byPlayer.get(r.id) || []).filter(x => x.date < r.date && (QUALIFY[r.pos] || QUALIFY.WR)(x));
      const season = prev.filter(x => x.date >= '2025-09-01');
      const base = prev.length ? prev : null;
      for (const s of statsFor(r.pos)) {
        const m = proj.markets[s];
        if (!m) continue;
        const real = STAT_GET[s](r);
        const A = acc(s);
        if (m.type === 'poisson') {
          const p = s === 'anytime_td' ? probAtLeastOne(m) : probOver(m, 1.5);
          const hit = s === 'anytime_td' ? (real >= 1 ? 1 : 0) : (real > 1.5 ? 1 : 0);
          A.td.n++; A.td.pred += p; A.td.real += hit;
          const b = Math.min(9, Math.floor(p * 10));
          A.td.buckets[b] = A.td.buckets[b] || { n: 0, p: 0, h: 0 };
          A.td.buckets[b].n++; A.td.buckets[b].p += p; A.td.buckets[b].h += hit;
          continue;
        }
        const get = STAT_GET[s];
        const bSeason = (season.length ? season : base).reduce((t, x) => t + get(x), 0) / (season.length ? season : base).length;
        const last3 = prev.slice(-3);
        const bLast3 = last3.reduce((t, x) => t + get(x), 0) / last3.length;
        A.n++;
        A.ae += Math.abs(real - m.mu); A.aeSeason += Math.abs(real - bSeason); A.aeLast3 += Math.abs(real - bLast3);
        A.bias += real - m.mu;
        if (Math.abs(real - m.mu) <= m.sd) A.cov++;
        // calibración en líneas sintéticas
        for (const k of [-1, -0.5, 0, 0.5, 1]) {
          const line = m.mu + k * m.sd;
          const p = probOver(m, line);
          const key = String(k);
          A.bins[key] = A.bins[key] || { n: 0, p: 0, h: 0 };
          A.bins[key].n++; A.bins[key].p += p; A.bins[key].h += real > line ? 1 : 0;
        }
      }
    }
    return M;
  }

  const show = (M, full) => {
    for (const s of Object.keys(M)) {
      const A = M[s];
      if (A.n) {
        console.log(`  ${s.padEnd(17)} n=${A.n} · MAE modelo ${(A.ae / A.n).toFixed(1)} · temporada ${(A.aeSeason / A.n).toFixed(1)} · últimos3 ${(A.aeLast3 / A.n).toFixed(1)} · sesgo ${(A.bias / A.n >= 0 ? '+' : '')}${(A.bias / A.n).toFixed(1)} · dentro de 1σ ${(A.cov / A.n * 100).toFixed(0)}%`);
        if (full) {
          const cal = Object.keys(A.bins).map(k => `${k}σ: pred ${(A.bins[k].p / A.bins[k].n * 100).toFixed(0)}% real ${(A.bins[k].h / A.bins[k].n * 100).toFixed(0)}%`).join(' · ');
          console.log(`  ${''.padEnd(17)} calibración over → ${cal}`);
        }
      }
      if (A.td.n) {
        console.log(`  ${s.padEnd(17)} n=${A.td.n} · P pred ${(A.td.pred / A.td.n * 100).toFixed(1)}% · real ${(A.td.real / A.td.n * 100).toFixed(1)}%`);
        if (full) {
          const cal = Object.keys(A.td.buckets).sort().map(b => `${b * 10}s: pred ${(A.td.buckets[b].p / A.td.buckets[b].n * 100).toFixed(0)}% real ${(A.td.buckets[b].h / A.td.buckets[b].n * 100).toFixed(0)}% (n=${A.td.buckets[b].n})`).join(' · ');
          console.log(`  ${''.padEnd(17)} calibración → ${cal}`);
        }
      }
    }
  };

  console.log('\n=== PRODUCCIÓN (parámetros actuales) ===');
  show(run('prod'), true);

  console.log('\n=== Sensibilidad: ENV_EXP (entorno) ===');
  const envExp0 = PARAMS.ENV_EXP;
  for (const e of [0, 0.3, 0.6, 1.0]) {
    Object.assign(PARAMS, { ENV_EXP: e });
    const M = run();
    const line = ['pass_yds', 'rush_yds', 'reception_yds'].map(s => `${s} ${(M[s].ae / M[s].n).toFixed(2)}`).join(' · ');
    console.log(`  ENV_EXP=${e}: MAE ${line}`);
  }
  Object.assign(PARAMS, { ENV_EXP: envExp0 });

  console.log('\n=== Sensibilidad: DEF_SHRINK (defensa rival) ===');
  const def0 = PARAMS.DEF_SHRINK;
  for (const d of [0, 0.25, 0.5, 0.75, 1.0]) {
    Object.assign(PARAMS, { DEF_SHRINK: d });
    const M = run();
    const line = ['pass_yds', 'rush_yds', 'reception_yds'].map(s => `${s} ${(M[s].ae / M[s].n).toFixed(2)}`).join(' · ');
    console.log(`  DEF_SHRINK=${d}: MAE ${line}`);
  }
  Object.assign(PARAMS, { DEF_SHRINK: def0 });

  console.log('\n=== Sensibilidad: HALF_LIFE_GAMES (recencia) ===');
  const hl0 = PARAMS.HALF_LIFE_GAMES;
  for (const h of [3, 6, 10, 100]) {
    Object.assign(PARAMS, { HALF_LIFE_GAMES: h });
    const M = run();
    const line = ['pass_yds', 'rush_yds', 'reception_yds', 'receptions'].map(s => `${s} ${(M[s].ae / M[s].n).toFixed(2)}`).join(' · ');
    console.log(`  HALF_LIFE=${h}: MAE ${line}`);
  }
  Object.assign(PARAMS, { HALF_LIFE_GAMES: hl0 });
})().catch(e => { console.error(e); process.exit(1); });
