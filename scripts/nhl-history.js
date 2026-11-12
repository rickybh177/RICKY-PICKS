#!/usr/bin/env node
/* ============================================================
   NHL — histórico juego por juego para scripts (priors/backtest) y
   para el runtime (temporada en curso).

   Por temporada (se nombra por el año en que TERMINA: 2026 =
   2025-26) baja de ESPN:
   1. el scoreboard día por día (oct → jun): resultados, fase
      (regular / playoffs) y goles por periodo (así se separa el
      tiempo reglamentario del tiempo extra y los penales);
   2. el boxscore de cada juego: tiros a puerta, fallados y
      bloqueados, power play, portero que jugó y goles a puerta vacía;
   3. la línea de APERTURA y CIERRE del mercado (core API de ESPN:
      ESPN BET / DraftKings): moneyline, línea de gol ±1.5 y total.

   Guarda:
   - caché en disco (tmp, o NHL_CACHE_DIR) para re-correr sin refetchear;
   - el dataset compacto lib/nhl/data/games-<año>.json.

   Uso:  node scripts/nhl-history.js 2023 2024 2025 2026
         node scripts/nhl-history.js 2027 --no-odds   (temporada en curso)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getRange, getSummary, getCloseOddsRaw, parseCloseOdds } = require('../lib/nhl/data');
const { GAME_COLS, compactGame, gameObj } = require('../lib/nhl/compact');

const CACHE_DIR = process.env.NHL_CACHE_DIR || path.join(os.tmpdir(), 'ricky-nhl-history');
const OUT_DIR = path.join(__dirname, '..', 'lib', 'nhl', 'data');

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
  let games = (cached && cached.games) || [];
  const seen = new Set(games.map(g => g.id));
  const start = cached && cached.to && !refresh ? new Date(new Date(cached.to).getTime() - 2 * 86400000) : from;
  const fresh = await getRange(start, to, { concurrency: 6 });
  for (const g of fresh) {
    if (g.state !== 'post' || g.home.score == null || g.away.score == null) continue;
    if (!g.home.p || g.home.p.length < 3 || !g.away.p || g.away.p.length < 3) continue; // suspendido / sin parciales
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    games.push({
      id: g.id, date: g.date, seasontype: g.seasontype, seasonYear: g.seasonYear, neutral: g.neutral,
      home: { abbr: g.home.abbr, score: g.home.score, p: g.home.p, gk: g.home.goalie ? g.home.goalie.id : null },
      away: { abbr: g.away.abbr, score: g.away.score, p: g.away.p, gk: g.away.goalie ? g.away.goalie.id : null },
    });
  }
  games.sort((a, b) => new Date(a.date) - new Date(b.date) || a.id.localeCompare(b.id));
  writeJson(file, { to: to.toISOString(), games });
  return games;
}

async function summaryCached(g) {
  const f = path.join(CACHE_DIR, 'summaries', g.id + '.json');
  const c = readJson(f);
  if (c && c.team && Object.keys(c.team).length === 2) return c;
  const s = await getSummary(g.id, 0, { cache: false });
  if (s && s.team && Object.keys(s.team).length === 2) writeJson(f, s);
  return s;
}
/* se cachea el JSON del core API ya recortado a lo que lee el parser */
async function oddsCached(g) {
  const f = path.join(CACHE_DIR, 'odds-raw', g.id + '.json');
  let raw = readJson(f);
  if (!raw) {
    try {
      const j = await getCloseOddsRaw(g.id);
      raw = { items: (j.items || []).map(it => ({ provider: it.provider && { id: it.provider.id, name: it.provider.name }, overUnder: it.overUnder, overOdds: it.overOdds, underOdds: it.underOdds, open: it.open, close: it.close, homeTeamOdds: it.homeTeamOdds && { moneyLine: it.homeTeamOdds.moneyLine, spreadOdds: it.homeTeamOdds.spreadOdds, open: it.homeTeamOdds.open, close: it.homeTeamOdds.close }, awayTeamOdds: it.awayTeamOdds && { moneyLine: it.awayTeamOdds.moneyLine, spreadOdds: it.awayTeamOdds.spreadOdds, open: it.awayTeamOdds.open, close: it.awayTeamOdds.close } })) };
    } catch (e) { raw = { items: [], error: e.message }; }
    if (!raw.error) writeJson(f, raw);
  }
  return parseCloseOdds(raw);
}

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
  const outGames = games.map((g, gi) => compactGame(g, sums[gi].s, sums[gi].o));
  const built = new Date().toISOString().slice(0, 10);
  writeJson(path.join(OUT_DIR, `games-${endYear}.json`), { season: endYear, built, cols: GAME_COLS, games: outGames });
  const withOdds = outGames.filter(g => g[24]).length, withBox = outGames.filter(g => g[10] != null).length, withEn = outGames.filter(g => g[20] != null).length;
  console.error(`  → games-${endYear}.json ${outGames.length} juegos (${withBox} con boxscore, ${withEn} con jugada por jugada, ${withOdds} con cierre)`);
}

/* Lectura de los datasets compactos (la usan los scripts de backtest) */
function loadGames(endYear) {
  const d = readJson(path.join(OUT_DIR, `games-${endYear}.json`));
  if (!d) return [];
  return d.games.map(a => gameObj(a, endYear));
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const years = args.map(Number).filter(Boolean);
    const odds = !args.includes('--no-odds');
    if (!years.length) throw new Error('Uso: node scripts/nhl-history.js 2024 2025 2026');
    for (const y of years) await buildSeason(y, { odds });
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { getSeasonSchedule, buildSeason, loadGames, gameObj, compactGame, CACHE_DIR, OUT_DIR, GAME_COLS };
