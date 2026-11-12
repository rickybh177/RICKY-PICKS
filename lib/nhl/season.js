/* ============================================================
   NHL — estado de la TEMPORADA EN CURSO para el runtime (mismo
   esquema que lib/nba/season.js).

   Para tener los ratings al día el modelo necesita TODOS los juegos
   terminados de la 2026-27 (hasta 1,312) con su boxscore (tiros a
   puerta, goles a puerta vacía, portero que jugó). Bajar eso en cada
   cold start de Vercel es inviable, así que se arma en dos capas:

   1. ESTÁTICA: lib/nhl/data/games-2027.json, generada por
      scripts/nhl-history.js (se regenera cuando el dueño quiera; trae
      la temporada hasta la fecha de build).
   2. DELTA en el KV compartido (Supabase Storage, llave
      nhl-season-2027-delta): los juegos terminados DESPUÉS del build
      estático, que cualquier request completa (scoreboard desde el
      último día guardado → summary de los nuevos) y guarda para las
      demás lambdas. Un cold start típico baja 0-15 boxscores.

   Las dos capas usan el formato compacto de lib/nhl/compact.js.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { getRange, getSummary, addDays } = require('./data');
const { kvGet, kvPut } = require('../odds/theoddsapi');
const { compactGame, gameObj } = require('./compact');

const SEASON = 2027; // temporada 2026-27 (año en que termina)
const DATA_DIR = path.join(__dirname, 'data');
const KV_KEY = `nhl-season-${SEASON}-delta`;
const MAX_NEW_PER_REQUEST = 40; // boxscores nuevos por request (cold start acotado)
const SEASON_START = `${SEASON - 1}-10-01T00:00:00Z`;

let _mem = null; // { at, games, lastDate, … }
const MEM_TTL = 5 * 60 * 1000;

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

/* Carga estática + delta, actualiza con los juegos nuevos y regresa
   { games: [obj], lastDate, newGames, staticBuilt, staticGames } */
async function loadSeason({ update = true } = {}) {
  if (_mem && Date.now() - _mem.at < MEM_TTL) return _mem;

  // 1) estática
  const st = readJson(path.join(DATA_DIR, `games-${SEASON}.json`)) || { games: [] };
  const games = st.games.map(a => a.slice());
  const seen = new Set(games.map(a => String(a[0])));

  // 2) delta del KV
  let delta = null;
  try { delta = await kvGet(KV_KEY); } catch (e) {}
  const deltaGames = (delta && Array.isArray(delta.games) ? delta.games : []);
  for (const a of deltaGames) if (!seen.has(String(a[0]))) { seen.add(String(a[0])); games.push(a); }

  const byDate = (a, b) => new Date(a[1]) - new Date(b[1]) || String(a[0]).localeCompare(String(b[0]));
  games.sort(byDate);
  let lastDate = games.length ? games[games.length - 1][1] : SEASON_START;
  let newGames = 0;

  // 3) juegos terminados nuevos (desde el último día guardado −1 hasta mañana)
  if (update) {
    try {
      const from = new Date(Math.max(new Date(lastDate).getTime() - 86400000, new Date(SEASON_START).getTime()));
      const fresh = (await getRange(from, addDays(new Date(), 1)))
        .filter(g => g.state === 'post' && g.home.score != null && g.away.score != null && g.home.p && g.home.p.length >= 3 && g.away.p && g.away.p.length >= 3 && !seen.has(g.id))
        .sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, MAX_NEW_PER_REQUEST);
      if (fresh.length) {
        const add = [];
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(6, fresh.length) }, async () => {
          while (i < fresh.length) {
            const g = fresh[i++];
            let s = null;
            try { s = await getSummary(g.id, 0, { cache: false }); } catch (e) { s = null; }
            /* sin boxscore todavía (ESPN tarda unos minutos tras el
               final): no se guarda; la siguiente corrida lo vuelve a
               intentar con el boxscore completo */
            if (s && s.team && Object.keys(s.team).length === 2) add.push(compactGame(g, s, null));
          }
        }));
        add.sort(byDate);
        for (const a of add) { deltaGames.push(a); games.push(a); seen.add(String(a[0])); }
        if (add.length) {
          games.sort(byDate);
          lastDate = games[games.length - 1][1];
          newGames = add.length;
          try { await kvPut(KV_KEY, { at: Date.now(), games: deltaGames }); } catch (e) {}
        }
      }
    } catch (e) { console.error('nhl season update', e.message); }
  }

  _mem = { at: Date.now(), games: games.map(a => gameObj(a, SEASON)), lastDate, newGames, staticBuilt: st.built || null, staticGames: st.games.length };
  return _mem;
}

module.exports = { loadSeason, SEASON, KV_KEY };
