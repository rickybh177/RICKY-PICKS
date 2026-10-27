/* ============================================================
   NBA — estado de la TEMPORADA EN CURSO para el runtime.

   Problema: para tener los ratings al día el modelo necesita TODOS
   los juegos terminados de la 2026-27 (hasta 1,230) con su boxscore
   (posesiones para el ritmo, minutos y producción de cada jugador
   para ausencias y props). Bajar eso en cada cold start de Vercel es
   inviable, así que se arma en dos capas:

   1. ESTÁTICA: lib/nba/data/games-2027.json + player-games-2027.json,
      generados por scripts/nba-history.js (se regeneran cuando el
      dueño quiera; traen la temporada hasta la fecha de build).
   2. DELTA en el KV compartido (Supabase Storage, llave
      nba-season-2027-delta): los juegos terminados DESPUÉS del build
      estático, que cualquier request completa (scoreboard desde el
      último día guardado → summary de los nuevos) y guarda para las
      demás lambdas. Un cold start típico baja 0-10 boxscores.

   Las dos capas se funden en el mismo formato compacto (GAME_COLS /
   ROW_COLS de scripts/nba-history.js) y se exponen como objetos.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { getRange, getSummary, ymd, addDays } = require('./data');
const { kvGet, kvPut } = require('../odds/theoddsapi');
const { expand, loadPoss } = require('./players');

const SEASON = 2027; // temporada 2026-27 (año en que termina)
const DATA_DIR = path.join(__dirname, 'data');
const KV_KEY = `nba-season-${SEASON}-delta`;
const MAX_NEW_PER_REQUEST = 40; // boxscores nuevos por request (cold start acotado)
const SEASON_START = `${SEASON - 1}-10-01T00:00:00Z`;

let _mem = null; // { at, games, rows, lastDate, staticBuilt }
const MEM_TTL = 5 * 60 * 1000;

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

/* fila compacta de juego → objeto (misma forma que scripts/nba-history loadGames) */
function gameObj(a) {
  return {
    id: String(a[0]), date: a[1], seasontype: a[2], neutral: !!a[3],
    home: { abbr: a[4], score: a[6], q: a[8], poss: a[10], tpa: a[20], tpm: a[23] },
    away: { abbr: a[5], score: a[7], q: a[9], poss: a[11], tpa: a[21], tpm: a[24] },
  };
}

/* summary + juego del scoreboard → fila compacta de juego + filas de jugadores */
function compact(g, s) {
  const th = (s && s.team && s.team[g.home.abbr]) || {}, ta = (s && s.team && s.team[g.away.abbr]) || {};
  const game = [
    g.id, g.date, g.seasontype, g.neutral ? 1 : 0, g.home.abbr, g.away.abbr, g.home.score, g.away.score,
    g.home.q || null, g.away.q || null, th.poss != null ? th.poss : null, ta.poss != null ? ta.poss : null,
    th.fga || null, ta.fga || null, th.fta || null, ta.fta || null, th.oreb || null, ta.oreb || null, th.tov || null, ta.tov || null, th.tpa || null, ta.tpa || null,
    null, th.tpm != null ? th.tpm : null, ta.tpm != null ? ta.tpm : null, null,
  ];
  const rows = (s ? s.players : []).map(p => [0, p.id, p.name, p.team, p.pos, p.starter ? 1 : 0, p.dnp ? 1 : 0, p.min, p.pts, p.reb, p.ast, p.tpm, p.tpa, p.fgm, p.fga, p.ftm, p.fta, p.oreb, p.dreb, p.stl, p.blk, p.tov, p.pf]);
  return { game, rows };
}

/* Carga estática + delta, actualiza con los juegos nuevos y regresa
   { games: [obj], playerRows: [obj], lastDate, newGames } */
async function loadSeason({ update = true } = {}) {
  if (_mem && Date.now() - _mem.at < MEM_TTL && !update) return _mem;

  // 1) estática
  const st = readJson(path.join(DATA_DIR, `games-${SEASON}.json`)) || { games: [] };
  const sp = readJson(path.join(DATA_DIR, `player-games-${SEASON}.json`)) || { games: [], rows: [] };
  let games = st.games.map(a => a.slice());
  const seen = new Set(games.map(a => String(a[0])));
  // filas estáticas de jugadores (expand ya las vuelve objetos)
  let playerRows = expand({ season: SEASON, games: sp.games, rows: sp.rows }, loadPoss(SEASON));

  // 2) delta del KV
  let delta = null;
  try { delta = await kvGet(KV_KEY); } catch (e) {}
  const deltaGames = (delta && delta.games) || [], deltaRows = (delta && delta.rows) || [];
  const dg = [];
  for (const a of deltaGames) if (!seen.has(String(a[0]))) { seen.add(String(a[0])); games.push(a); dg.push(a); }
  // filas del delta: cada entrada trae su índice al arreglo de juegos del delta
  playerRows.push(...expand({ season: SEASON, games: deltaGames.map(a => a.slice(0, 8)), rows: deltaRows }, possMapOf(deltaGames)));

  games.sort((a, b) => new Date(a[1]) - new Date(b[1]) || String(a[0]).localeCompare(String(b[0])));
  let lastDate = games.length ? games[games.length - 1][1] : SEASON_START;
  let newGames = 0;

  // 3) juegos terminados nuevos (desde el último día guardado −1 hasta mañana)
  if (update) {
    try {
      const from = addDays(new Date(Math.max(new Date(lastDate).getTime() - 86400000, new Date(SEASON_START).getTime())), 0);
      const to = addDays(new Date(), 1);
      const fresh = (await getRange(from, to)).filter(g => g.state === 'post' && g.home.score != null && g.away.score != null && !seen.has(g.id))
        .sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, MAX_NEW_PER_REQUEST);
      if (fresh.length) {
        const addG = [], addR = [];
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(6, fresh.length) }, async () => {
          while (i < fresh.length) {
            const g = fresh[i++];
            let s = null;
            try { s = await getSummary(g.id); } catch (e) { s = null; }
            const c = compact(g, s);
            addG.push({ g, c });
          }
        }));
        addG.sort((x, y) => new Date(x.g.date) - new Date(y.g.date));
        const baseIdx = deltaGames.length;
        addG.forEach(({ c }, k) => {
          deltaGames.push(c.game);
          for (const r of c.rows) { r[0] = baseIdx + k; deltaRows.push(r); }
          games.push(c.game); seen.add(String(c.game[0]));
          addR.push(...c.rows.map(r => r));
        });
        playerRows.push(...expand({ season: SEASON, games: deltaGames.map(a => a.slice(0, 8)), rows: addR }, possMapOf(deltaGames)));
        games.sort((a, b) => new Date(a[1]) - new Date(b[1]) || String(a[0]).localeCompare(String(b[0])));
        lastDate = games[games.length - 1][1];
        newGames = addG.length;
        try { await kvPut(KV_KEY, { at: Date.now(), games: deltaGames, rows: deltaRows }); } catch (e) {}
      }
    } catch (e) { console.error('nba season update', e.message); }
  }

  playerRows.sort((a, b) => new Date(a.date) - new Date(b.date) || a.gameId.localeCompare(b.gameId));
  _mem = { at: Date.now(), games: games.map(gameObj), playerRows, lastDate, newGames, staticBuilt: st.built || null, staticGames: st.games.length };
  return _mem;
}
function possMapOf(compactGames) {
  const m = new Map();
  for (const a of compactGames) m.set(String(a[0]), { home: a[10], away: a[11] });
  return m;
}

module.exports = { loadSeason, SEASON, KV_KEY, compact, gameObj };
