#!/usr/bin/env node
/* ============================================================
   Construye el dataset JUGADOR-JUEGO de la NFL a partir de los
   boxscores de ESPN: una fila por jugador por juego con sus
   números de pase / carrera / recepción. Lo usan:
   - lib/nfl/props.js en runtime (temporadas pasadas, estáticas)
   - scripts/nfl-props-backtest.js (validación honesta)

   Salida: lib/nfl/data/player-games-<año>.json (compacto).
   Caché en disco de cada summary (los juegos terminados no
   cambian) para poder re-correr sin refetchear 544 juegos.

   Uso:  node scripts/nfl-player-history.js 2024 2025
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getSeasonGames } = require('./nfl-history');
const { getEventPlayerStats, getRoster } = require('../lib/nfl/players');
const { TEAMS } = require('../lib/nfl/teams');

const CACHE_DIR = path.join(os.tmpdir(), 'ricky-nfl-history', 'summaries');
const OUT_DIR = path.join(__dirname, '..', 'lib', 'nfl', 'data');

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function summaryCached(eventId) {
  const f = path.join(CACHE_DIR, eventId + '.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  const s = await getEventPlayerStats(eventId);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s));
  return s;
}

/* Posición: del roster actual si está; si no (retirado, cortado),
   se infiere de sus números. */
function inferPos(r) {
  if (r.pass && r.pass.att >= 5) return 'QB';
  const ratt = r.rush ? r.rush.att : 0, tgt = r.rec ? r.rec.tgt : 0;
  if (ratt > tgt) return 'RB';
  return 'WR';
}

async function main() {
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  if (!years.length) throw new Error('Uso: node scripts/nfl-player-history.js 2024 2025');

  console.error('rosters actuales (posiciones)…');
  const posById = new Map();
  await mapLimit(Object.keys(TEAMS), 6, async abbr => {
    const r = await getRoster(abbr);
    for (const [id, p] of r) if (p.pos) posById.set(id, p.pos);
  });
  console.error('  ' + posById.size + ' jugadores con posición');

  for (const year of years) {
    const games = [...await getSeasonGames(year, 2), ...await getSeasonGames(year, 3)]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    console.error(year + ': ' + games.length + ' juegos, bajando boxscores…');
    let done = 0;
    const sums = await mapLimit(games, 6, async g => {
      const s = await summaryCached(g.id);
      if (++done % 50 === 0) console.error('  ' + done + '/' + games.length);
      return s;
    });

    const outGames = [], rows = [];
    sums.forEach((s, gi) => {
      const g = games[gi];
      outGames.push([g.id, g.date, g.week, g.seasontype, s.home, s.away, s.homeScore, s.awayScore]);
      for (const r of s.rows) {
        const P = r.pass || {}, R = r.rush || {}, C = r.rec || {};
        rows.push([
          gi, r.id, r.name, r.team, posById.get(r.id) || inferPos(r),
          P.cmp || 0, P.att || 0, P.yds || 0, P.td || 0, P.int || 0,
          R.att || 0, R.yds || 0, R.td || 0,
          C.tgt || 0, C.rec || 0, C.yds || 0, C.td || 0,
        ]);
      }
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `player-games-${year}.json`);
    fs.writeFileSync(file, JSON.stringify({
      year,
      built: new Date().toISOString().slice(0, 10),
      games_cols: ['id', 'date', 'week', 'seasontype', 'home', 'away', 'home_score', 'away_score'],
      rows_cols: ['g', 'id', 'name', 'team', 'pos', 'cmp', 'att', 'pyds', 'ptd', 'int', 'ratt', 'ryds', 'rtd', 'tgt', 'rec', 'recyds', 'rectd'],
      games: outGames, rows,
    }));
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.error(`  → ${file} · ${outGames.length} juegos · ${rows.length} filas · ${kb} KB`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
