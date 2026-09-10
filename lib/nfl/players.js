/* ============================================================
   NFL — capa de datos de JUGADORES (props). Solo backend.

   Fuentes (ESPN, gratis, sin key — mismo espejo y UA que data.js):
   - summary?event=ID → boxscore con passing / rushing / receiving
     (con targets) de los dos equipos. Es la fuente del dataset
     jugador-juego: una llamada por juego reconstruye a TODOS.
   - core API depthcharts → rango QB1/RB1/WR1-3/TE1 por equipo.
   - roster → nombre, posición y estado de lesión por id.

   El boxscore NO trae la posición del jugador: se toma del roster
   (runtime) o se guarda en el dataset al construirlo (scripts).
   ============================================================ */
const { fetchJson } = require('./data');
const { TEAMS } = require('./teams');

const SITE = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

const num = v => {
  if (v == null) return 0;
  const n = Number(String(v).split('/')[0]);
  return Number.isFinite(n) ? n : 0;
};
// "19/29" → [19, 29]
const pair = v => {
  const [a, b] = String(v || '0/0').split('/');
  return [num(a), num(b)];
};

/* Boxscore de un evento → filas por jugador (solo pass/rush/rec). */
function parseSummary(j) {
  const h = j.header || {};
  const comp = (h.competitions || [])[0] || {};
  const comps = comp.competitors || [];
  const homeC = comps.find(c => c.homeAway === 'home') || {};
  const awayC = comps.find(c => c.homeAway === 'away') || {};
  const home = homeC.team && homeC.team.abbreviation;
  const away = awayC.team && awayC.team.abbreviation;
  const byId = new Map();
  const teams = (j.boxscore && j.boxscore.players) || [];
  for (const t of teams) {
    const team = t.team && t.team.abbreviation;
    const opp = team === home ? away : home;
    for (const st of t.statistics || []) {
      const cat = st.name;
      if (!['passing', 'rushing', 'receiving'].includes(cat)) continue;
      const keys = st.keys || [];
      for (const a of st.athletes || []) {
        const ath = a.athlete || {};
        const id = String(ath.id || '');
        if (!id) continue;
        const s = {};
        (a.stats || []).forEach((v, i) => { s[keys[i]] = v; });
        let row = byId.get(id);
        if (!row) {
          row = { id, name: ath.displayName, team, opp, home: team === home, pass: null, rush: null, rec: null };
          byId.set(id, row);
        }
        if (cat === 'passing') {
          const [cmp, att] = pair(s['completions/passingAttempts']);
          row.pass = { cmp, att, yds: num(s.passingYards), td: num(s.passingTouchdowns), int: num(s.interceptions) };
        } else if (cat === 'rushing') {
          row.rush = { att: num(s.rushingAttempts), yds: num(s.rushingYards), td: num(s.rushingTouchdowns) };
        } else {
          row.rec = { tgt: num(s.receivingTargets), rec: num(s.receptions), yds: num(s.receivingYards), td: num(s.receivingTouchdowns) };
        }
      }
    }
  }
  return {
    eventId: String(h.id || ''),
    date: comp.date || null,
    week: h.week != null ? Number(h.week) : null,
    seasonYear: h.season && h.season.year,
    seasontype: h.season && h.season.type,
    home, away,
    homeScore: homeC.score != null ? Number(homeC.score) : null,
    awayScore: awayC.score != null ? Number(awayC.score) : null,
    rows: [...byId.values()],
  };
}

/* Un juego terminado no cambia: caché largo. */
async function getEventPlayerStats(eventId, ttlMs = 24 * 3600 * 1000) {
  const j = await fetchJson(`${SITE}/summary?event=${eventId}`, ttlMs);
  return parseSummary(j);
}

/* Depth chart ofensivo → { QB:[ids], RB:[ids], WR:[ids], TE:[ids] } (en orden). */
async function getDepthChart(abbr, season) {
  const t = TEAMS[abbr];
  if (!t) return null;
  const j = await fetchJson(`${CORE}/seasons/${season}/teams/${t.espnId}/depthcharts`, 12 * 3600 * 1000);
  const items = j.items || [];
  // el grupo ofensivo es el que tiene 'qb'; suele llamarse '3WR 1TE'
  const off = items.find(it => it.positions && it.positions.qb) || null;
  if (!off) return null;
  const out = { QB: [], RB: [], WR: [], TE: [] };
  for (const [pos, key] of [['qb', 'QB'], ['rb', 'RB'], ['wr', 'WR'], ['te', 'TE']]) {
    const pd = off.positions[pos];
    if (!pd) continue;
    out[key] = (pd.athletes || [])
      .slice().sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .map(a => { const m = /\/athletes\/(\d+)/.exec((a.athlete && a.athlete.$ref) || ''); return m ? m[1] : null; })
      .filter(Boolean);
  }
  return out;
}

/* Roster → Map id → { name, pos, status, injury } */
async function getRoster(abbr) {
  const t = TEAMS[abbr];
  if (!t) return new Map();
  const j = await fetchJson(`${SITE}/teams/${t.espnId}/roster`, 6 * 3600 * 1000);
  const out = new Map();
  for (const grp of j.athletes || []) {
    for (const a of grp.items || []) {
      const inj = (a.injuries || [])[0];
      out.set(String(a.id), {
        name: a.displayName,
        pos: (a.position && a.position.abbreviation) || null,
        status: (a.status && a.status.name) || null,       // Active | Injured Reserve | ...
        injury: inj ? (inj.status || null) : null,          // Out | Doubtful | Questionable | ...
      });
    }
  }
  return out;
}

/* Filas jugador-juego de la temporada EN CURSO (juegos terminados de
   las semanas 1..upto), en el mismo formato que expand() de props.js.
   Cada boxscore terminado se guarda en el KV compartido: se baja una
   sola vez en la vida, no por lambda. */
const { getWeek } = require('./data');
const { kvGet, kvPut } = require('../odds/theoddsapi');

async function getSeasonPlayerRows(year, upto) {
  const out = [];
  for (let w = 1; w <= upto; w++) {
    let games = [];
    try { games = await getWeek(year, w, 2); } catch (e) { continue; }
    for (const g of games) {
      if (g.state !== 'post' || g.home.score == null) continue;
      const key = `nfl-pg-${year}-${g.id}`;
      let s = await kvGet(key);
      if (!s || !s.rows) {
        try { s = await getEventPlayerStats(g.id); } catch (e) { continue; }
        if (s && s.rows && s.rows.length) await kvPut(key, s);
      }
      for (const r of s.rows) {
        const isHome = r.team === s.home;
        const P = r.pass || {}, R = r.rush || {}, C = r.rec || {};
        const ratt = R.att || 0, tgt = C.tgt || 0;
        out.push({
          gameId: String(g.id), date: g.date, week: w, seasontype: 2,
          team: r.team, opp: r.opp, home: isHome,
          teamPts: isHome ? s.homeScore : s.awayScore, oppPts: isHome ? s.awayScore : s.homeScore,
          id: r.id, name: r.name,
          pos: (P.att || 0) >= 5 ? 'QB' : (ratt > tgt ? 'RB' : 'WR'), // se corrige con el roster en el motor
          cmp: P.cmp || 0, att: P.att || 0, pyds: P.yds || 0, ptd: P.td || 0, int: P.int || 0,
          ratt, ryds: R.yds || 0, rtd: R.td || 0,
          tgt, rec: C.rec || 0, recyds: C.yds || 0, rectd: C.td || 0,
        });
      }
    }
  }
  return out;
}

module.exports = { parseSummary, getEventPlayerStats, getDepthChart, getRoster, getSeasonPlayerRows };
