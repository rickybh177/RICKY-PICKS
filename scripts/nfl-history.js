/* ============================================================
   NFL — histórico juego por juego para scripts (priors/backtest).
   Baja temporadas completas del scoreboard de ESPN (semana por
   semana) y cachea en disco los juegos TERMINADOS para no
   refetchear en cada corrida. Solo scripts; nunca en runtime.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getWeek } = require('../lib/nfl/data');

const CACHE_DIR = path.join(os.tmpdir(), 'ricky-nfl-history');

const WEEKS = { 1: 5, 2: 18, 3: 5 }; // semanas máximas por seasontype

function cacheFile(year, st) { return path.join(CACHE_DIR, `${year}-st${st}.json`); }

/* Juegos terminados de una temporada/fase, con caché en disco. */
async function getSeasonGames(year, seasontype) {
  const file = cacheFile(year, seasontype);
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(j) && j.length) return j;
  } catch (e) {}

  const out = [];
  for (let w = 1; w <= WEEKS[seasontype]; w++) {
    let games = [];
    try { games = await getWeek(year, w, seasontype); } catch (e) {}
    for (const g of games) {
      if (g.state !== 'post' || g.home.score == null || g.away.score == null) continue;
      if (g.home.abbr === 'AFC' || g.away.abbr === 'AFC') continue; // Pro Bowl fuera
      out.push({
        id: g.id, date: g.date, week: w,
        seasontype, seasonYear: g.seasonYear || year,
        neutral: g.neutral,
        home: { abbr: g.home.abbr, score: g.home.score },
        away: { abbr: g.away.abbr, score: g.away.score },
      });
    }
  }
  if (out.length) {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(out));
    } catch (e) {}
  }
  return out;
}

module.exports = { getSeasonGames, CACHE_DIR };
