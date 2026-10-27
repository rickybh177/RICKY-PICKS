#!/usr/bin/env node
/* ============================================================
   NBA — histórico juego por juego para scripts (priors/backtest).

   Por temporada (se nombra por el año en que TERMINA: 2024 =
   2023-24) baja de ESPN:
   1. el scoreboard día por día (oct → jun): resultados, tipo de
      fase (regular / play-in / playoffs) y parciales por cuarto;
   2. el boxscore de cada juego: estadísticas de equipo (posesiones
      → ritmo) y de cada jugador (minutos, puntos, rebotes,
      asistencias, triples…), incluido quién NO jugó;
   3. la línea de CIERRE del mercado (core API de ESPN: ESPN BET,
      DraftKings, Caesars…): spread, total y moneyline.

   Guarda dos cosas:
   - caché completa en disco (tmp) para re-correr sin refetchear;
   - datasets compactos en lib/nba/data/ que usa el runtime:
       games-<año>.json          juegos + stats de equipo + cierre
       player-games-<año>.json   una fila por jugador por juego

   Uso:  node scripts/nba-history.js 2024 2025 2026
         node scripts/nba-history.js 2027 --no-odds   (temporada en curso)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getRange, getSummary, getCloseOddsRaw, parseCloseOdds } = require('../lib/nba/data');

const CACHE_DIR = path.join(os.tmpdir(), 'ricky-nba-history');
const OUT_DIR = path.join(__dirname, '..', 'lib', 'nba', 'data');

/* ventana de calendario de cada temporada (año en que termina) */
function windowOf(endYear) {
  const to = new Date(Math.min(Date.now() + 86400000, Date.UTC(endYear, 5, 30)));
  return { from: new Date(Date.UTC(endYear - 1, 9, 1)), to };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); }

/* Calendario terminado de una temporada, con caché (la temporada en
   curso se refresca: el archivo guarda hasta dónde llegó). */
async function getSeasonSchedule(endYear, { refresh = false } = {}) {
  const file = path.join(CACHE_DIR, `schedule-${endYear}.json`);
  const cached = readJson(file);
  const { from, to } = windowOf(endYear);
  if (cached && cached.games && cached.games.length && !refresh) {
    const complete = cached.to && new Date(cached.to) >= to;
    if (complete) return cached.games;
  }
  // temporada en curso: refetch solo desde el último día guardado
  let games = (cached && cached.games) || [];
  const seen = new Set(games.map(g => g.id));
  const start = cached && cached.to && !refresh ? new Date(new Date(cached.to).getTime() - 2 * 86400000) : from;
  const fresh = await getRange(start, to, { concurrency: 6 });
  for (const g of fresh) {
    if (g.state !== 'post' || g.home.score == null || g.away.score == null) continue;
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    games.push({
      id: g.id, date: g.date, seasontype: g.seasontype, seasonYear: g.seasonYear, neutral: g.neutral, venue: g.venue,
      home: { abbr: g.home.abbr, score: g.home.score, q: g.home.q },
      away: { abbr: g.away.abbr, score: g.away.score, q: g.away.q },
    });
  }
  games.sort((a, b) => new Date(a.date) - new Date(b.date) || a.id.localeCompare(b.id));
  writeJson(file, { to: to.toISOString(), games });
  return games;
}

async function summaryCached(g) {
  const f = path.join(CACHE_DIR, 'summaries', g.id + '.json');
  const c = readJson(f);
  if (c && c.players && c.players.length) return c;
  const s = await getSummary(g.id);
  if (s && s.players && s.players.length) writeJson(f, s);
  return s;
}
/* se cachea el JSON CRUDO del core API: si cambia el parser no hay que
   volver a bajar 4,000 juegos */
async function oddsCached(g) {
  const f = path.join(CACHE_DIR, 'odds-raw', g.id + '.json');
  let raw = readJson(f);
  if (!raw) {
    try { raw = await getCloseOddsRaw(g.id); } catch (e) { raw = { items: [], error: e.message }; }
    writeJson(f, raw);
  }
  return parseCloseOdds(raw, g.home.abbr, g.away.abbr);
}

/* Dataset compacto de una temporada: { games, rows }.
   games_cols / rows_cols documentan el orden de cada arreglo. */
const GAME_COLS = ['id', 'date', 'seasontype', 'neutral', 'home', 'away', 'hs', 'as', 'hq', 'aq', 'hposs', 'aposs', 'hfga', 'afga', 'hfta', 'afta', 'horeb', 'aoreb', 'htov', 'atov', 'htpa', 'atpa', 'close', 'htpm', 'atpm', 'open'];
const ROW_COLS = ['g', 'id', 'name', 'team', 'pos', 'starter', 'dnp', 'min', 'pts', 'reb', 'ast', 'tpm', 'tpa', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'stl', 'blk', 'tov', 'pf'];

async function buildSeason(endYear, { odds = true } = {}) {
  const games = await getSeasonSchedule(endYear, { refresh: endYear >= new Date().getUTCFullYear() });
  console.error(`${endYear}: ${games.length} juegos terminados · bajando boxscores${odds ? ' y cierres' : ''}…`);
  let done = 0;
  const sums = await mapLimit(games, 8, async g => {
    let s = null, o = null;
    try { s = await summaryCached(g); } catch (e) { console.error('  summary', g.id, e.message); }
    if (odds) { try { o = await oddsCached(g); } catch (e) {} }
    if (++done % 100 === 0) console.error(`  ${done}/${games.length}`);
    return { s, o };
  });
  const outGames = [], rows = [];
  games.forEach((g, gi) => {
    const { s, o } = sums[gi];
    const th = (s && s.team && s.team[g.home.abbr]) || {}, ta = (s && s.team && s.team[g.away.abbr]) || {};
    outGames.push([
      g.id, g.date, g.seasontype, g.neutral ? 1 : 0, g.home.abbr, g.away.abbr, g.home.score, g.away.score,
      g.home.q || null, g.away.q || null,
      th.poss != null ? th.poss : null, ta.poss != null ? ta.poss : null,
      th.fga || null, ta.fga || null, th.fta || null, ta.fta || null, th.oreb || null, ta.oreb || null, th.tov || null, ta.tov || null, th.tpa || null, ta.tpa || null,
      o ? [o.spread, o.total, o.ml_home, o.ml_away, o.spread_home_odds, o.spread_away_odds, o.over_odds, o.under_odds] : null,
      th.tpm != null ? th.tpm : null, ta.tpm != null ? ta.tpm : null,
      o && (o.open_spread != null || o.open_total != null) ? [o.open_spread, o.open_total, o.open_ml_home, o.open_ml_away] : null,
    ]);
    if (s) for (const p of s.players) {
      rows.push([gi, p.id, p.name, p.team, p.pos, p.starter ? 1 : 0, p.dnp ? 1 : 0, p.min, p.pts, p.reb, p.ast, p.tpm, p.tpa, p.fgm, p.fga, p.ftm, p.fta, p.oreb, p.dreb, p.stl, p.blk, p.tov, p.pf]);
    }
  });
  const built = new Date().toISOString().slice(0, 10);
  writeJson(path.join(OUT_DIR, `games-${endYear}.json`), { season: endYear, built, cols: GAME_COLS, games: outGames });
  writeJson(path.join(OUT_DIR, `player-games-${endYear}.json`), { season: endYear, built, games_cols: GAME_COLS.slice(0, 8), games: outGames.map(g => g.slice(0, 8)), rows_cols: ROW_COLS, rows });
  const withOdds = outGames.filter(g => g[22]).length, withPoss = outGames.filter(g => g[10] != null).length;
  console.error(`  → games-${endYear}.json ${outGames.length} juegos (${withPoss} con boxscore, ${withOdds} con cierre) · player-games ${rows.length} filas`);
}

/* Lectura de los datasets compactos (la usan los scripts de backtest) */
function loadGames(endYear) {
  const d = readJson(path.join(OUT_DIR, `games-${endYear}.json`));
  if (!d) return [];
  return d.games.map(a => ({
    id: a[0], date: a[1], seasontype: a[2], neutral: !!a[3],
    home: { abbr: a[4], score: a[6], q: a[8], poss: a[10], fga: a[12], fta: a[14], oreb: a[16], tov: a[18], tpa: a[20], tpm: a[23] },
    away: { abbr: a[5], score: a[7], q: a[9], poss: a[11], fga: a[13], fta: a[15], oreb: a[17], tov: a[19], tpa: a[21], tpm: a[24] },
    close: a[22] ? { spread: a[22][0], total: a[22][1], ml_home: a[22][2], ml_away: a[22][3], spread_home_odds: a[22][4], spread_away_odds: a[22][5], over_odds: a[22][6], under_odds: a[22][7] } : null,
    open: a[25] ? { spread: a[25][0], total: a[25][1], ml_home: a[25][2], ml_away: a[25][3] } : null,
    season: endYear,
  }));
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const years = args.map(Number).filter(Boolean);
    const odds = !args.includes('--no-odds');
    if (!years.length) throw new Error('Uso: node scripts/nba-history.js 2024 2025 2026');
    for (const y of years) await buildSeason(y, { odds });
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { getSeasonSchedule, buildSeason, loadGames, CACHE_DIR, OUT_DIR, GAME_COLS, ROW_COLS };
