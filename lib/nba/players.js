/* ============================================================
   NBA — capa de JUGADORES: historial jugador-juego, rotación de
   cada equipo, valor de un jugador y AUSENCIAS. Solo backend.

   Lo usan dos cosas:
   - el modelo de equipo (lib/nba/model.js): cuánto vale lo que le
     falta hoy a cada equipo (lesionados) en puntos de eficiencia;
   - el motor de props (lib/nba/props.js): el historial por jugador.

   Datasets: lib/nba/data/player-games-<año>.json (generados por
   scripts/nba-history.js; el año es en el que TERMINA la temporada)
   + filas extra de la temporada en curso (KV).

   VALOR DE UN JUGADOR = Game Score de Hollinger por juego
     (PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA−FTM) + 0.7·OREB + 0.3·DREB
      + STL + 0.7·AST + 0.7·BLK − 0.4·PF − TOV)
   menos lo que produciría un suplente en sus minutos (REPL_RATE por
   minuto). Es una medida de caja (no plus-minus ajustado), pero se
   calcula con lo que ESPN publica y el backtest mide cuánto pesa
   (coeficiente ABS_C en lib/nba/priors.js).

   ROTACIÓN de un equipo antes de una fecha: quienes jugaron ≥40% de
   sus últimos ROT_WINDOW juegos con ≥ROT_MIN_MPG minutos. Un titular
   que lleva 8 juegos fuera SIGUE en la rotación (ventana larga a
   propósito): así la expectativa del equipo mientras él falta lleva
   el descuento de su ausencia, el rating aprende "a plantel completo"
   y, cuando vuelve, el descuento desaparece solo.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

const P = {
  ROT_WINDOW: 20,     // juegos del equipo que definen la rotación
  ROT_MIN_APP: 0.4,   // fracción mínima de apariciones
  ROT_MIN_MPG: 15,    // minutos por aparición mínimos
  REPL_RATE: 0.28,    // Game Score por minuto de un suplente (liga: ~0.4 promedio, banca ~0.28)
  VAL_HALF_LIFE: 10,  // recencia del valor (juegos)
};

function gameScore(r) {
  return r.pts + 0.4 * r.fgm - 0.7 * r.fga - 0.4 * (r.fta - r.ftm) + 0.7 * r.oreb + 0.3 * r.dreb
    + r.stl + 0.7 * r.ast + 0.7 * r.blk - 0.4 * r.pf - r.tov;
}

/* ---- carga ---- */
function loadStatic(endYear) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `player-games-${endYear}.json`), 'utf8')); } catch (e) { return null; }
}
/* dataset compacto → filas {gameId,date,seasontype,team,opp,home,
   teamPts,oppPts, id,name,pos,starter,dnp,min,pts,reb,ast,tpm,…} */
/* posesiones por equipo-juego (de games-<año>.json), para el ritmo de
   los props: Map gameId → { home: poss, away: poss } */
function loadPoss(endYear) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `games-${endYear}.json`), 'utf8'));
    const m = new Map();
    for (const a of d.games) m.set(String(a[0]), { home: a[10], away: a[11] });
    return m;
  } catch (e) { return new Map(); }
}
function expand(ds, possMap) {
  const out = [];
  if (!ds) return out;
  const G = ds.games;
  for (const r of ds.rows) {
    const g = G[r[0]];
    const [gid, date, st, , home, away, hs, as] = g;
    const team = r[3];
    const isHome = team === home;
    const pp = possMap && possMap.get(String(gid));
    out.push({
      gameId: String(gid), date, seasontype: st, season: ds.season,
      team, opp: isHome ? away : home, home: isHome,
      teamPts: isHome ? hs : as, oppPts: isHome ? as : hs,
      poss: pp ? (isHome ? pp.home : pp.away) : null,
      id: String(r[1]), name: r[2], pos: r[4], starter: !!r[5], dnp: !!r[6],
      min: r[7], pts: r[8], reb: r[9], ast: r[10], tpm: r[11], tpa: r[12], fgm: r[13], fga: r[14], ftm: r[15], fta: r[16],
      oreb: r[17], dreb: r[18], stl: r[19], blk: r[20], tov: r[21], pf: r[22],
    });
  }
  return out;
}
function loadHistory({ years = [2026, 2027], extraRows = [] } = {}) {
  const rows = [];
  for (const y of years) rows.push(...expand(loadStatic(y), loadPoss(y)));
  rows.push(...extraRows);
  rows.sort((a, b) => new Date(a.date) - new Date(b.date) || a.gameId.localeCompare(b.gameId));
  return rows;
}

/* Índice: por jugador y por equipo-juego (quién jugó en cada juego). */
function buildIndex(rows) {
  const byPlayer = new Map();     // id -> filas (orden cronológico)
  const teamGames = new Map();    // team -> [{gameId, date, opp, home, teamPts, oppPts, played: Map id->row}]
  const gameKey = new Map();      // team|gameId -> entrada
  for (const r of rows) {
    if (!byPlayer.has(r.id)) byPlayer.set(r.id, []);
    byPlayer.get(r.id).push(r);
    const k = r.team + '|' + r.gameId;
    let tg = gameKey.get(k);
    if (!tg) {
      tg = { gameId: r.gameId, date: r.date, team: r.team, opp: r.opp, home: r.home, teamPts: r.teamPts, oppPts: r.oppPts, played: new Map(), rows: [] };
      gameKey.set(k, tg);
      if (!teamGames.has(r.team)) teamGames.set(r.team, []);
      teamGames.get(r.team).push(tg);
    }
    tg.rows.push(r);
    if (!r.dnp && r.min > 0) tg.played.set(r.id, r);
  }
  for (const arr of teamGames.values()) arr.sort((a, b) => new Date(a.date) - new Date(b.date) || a.gameId.localeCompare(b.gameId));
  return { byPlayer, teamGames, gameKey, rows };
}

/* Últimos N juegos del equipo ANTES de una fecha (exclusiva). */
function lastTeamGames(idx, team, beforeDate, n) {
  const cut = new Date(beforeDate).getTime();
  const arr = idx.teamGames.get(team) || [];
  const out = [];
  for (let i = arr.length - 1; i >= 0 && out.length < n; i--) {
    if (new Date(arr[i].date).getTime() < cut) out.push(arr[i]);
  }
  return out.reverse();
}

/* Rotación del equipo antes de la fecha: Map id → { name, apps, mpg,
   value } con value = Game Score sobre reemplazo por juego (≥0),
   ponderado por recencia. */
function rotation(idx, team, beforeDate, params = P) {
  const games = lastTeamGames(idx, team, beforeDate, params.ROT_WINDOW);
  if (games.length < 5) return new Map();
  const acc = new Map();
  const n = games.length;
  games.forEach((tg, i) => {
    const w = Math.pow(0.5, (n - 1 - i) / params.VAL_HALF_LIFE);
    for (const [id, r] of tg.played) {
      let a = acc.get(id);
      if (!a) { a = { name: r.name, pos: r.pos, apps: 0, w: 0, min: 0, gs: 0 }; acc.set(id, a); }
      a.apps++; a.w += w; a.min += w * r.min; a.gs += w * gameScore(r);
    }
  });
  const out = new Map();
  for (const [id, a] of acc) {
    const mpg = a.min / a.w;
    if (a.apps / n < params.ROT_MIN_APP || mpg < params.ROT_MIN_MPG) continue;
    const gs = a.gs / a.w;
    out.set(id, { name: a.name, pos: a.pos, apps: a.apps, mpg: +mpg.toFixed(1), gs: +gs.toFixed(1), value: +Math.max(0, gs - params.REPL_RATE * mpg).toFixed(2) });
  }
  return out;
}

/* AUSENCIAS HISTÓRICAS de un equipo en un juego: jugadores de su
   rotación (calculada ANTES de ese juego) que no jugaron. Regresa
   { value, players:[{id,name,value}] }. */
function absencesInGame(idx, team, gameId, params = P) {
  const tg = idx.gameKey.get(team + '|' + gameId);
  if (!tg) return { value: 0, players: [] };
  const rot = rotation(idx, team, tg.date, params);
  const players = [];
  let value = 0;
  for (const [id, p] of rot) {
    if (tg.played.has(id)) continue;
    players.push({ id, name: p.name, value: p.value });
    value += p.value;
  }
  return { value: +value.toFixed(2), players };
}

/* AUSENCIAS DE HOY a partir del reporte de lesiones de ESPN:
   injuries = [{id, name, status}] del equipo. Cada estado pesa una
   fracción (Out seguro, Doubtful casi, Questionable/Day-To-Day a
   medias). Se casa por id y, si el reporte no lo trae, por nombre. */
const STATUS_W = { 'out': 1, 'doubtful': 0.8, 'questionable': 0.4, 'day-to-day': 0.4, 'game time decision': 0.5, 'probable': 0.1, 'suspended': 1, 'injured reserve': 1 };
const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
function absencesToday(idx, team, injuries, asOfDate, params = P) {
  const rot = rotation(idx, team, asOfDate, params);
  const byName = new Map();
  for (const [id, p] of rot) byName.set(normName(p.name), id);
  const players = [];
  let value = 0;
  for (const inj of injuries || []) {
    const w = STATUS_W[String(inj.status || '').toLowerCase()];
    if (!w) continue;
    const id = inj.id && rot.has(inj.id) ? inj.id : byName.get(normName(inj.name));
    if (!id) continue; // no está en la rotación: su ausencia ya no pesa (o nunca pesó)
    const p = rot.get(id);
    players.push({ id, name: p.name, status: inj.status, value: p.value, w });
    value += p.value * w;
  }
  return { value: +value.toFixed(2), players };
}

module.exports = { loadHistory, buildIndex, expand, loadPoss, gameScore, rotation, lastTeamGames, absencesInGame, absencesToday, normName, STATUS_W, PARAMS: P, DATA_DIR };
