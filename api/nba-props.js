/* ============================================================
   GET /api/nba-props?game=<espnId>
   PROPS DE JUGADOR de un juego: puntos, rebotes, asistencias,
   triples, PRA y doble-doble, proyectados por jugador
   (lib/nba/props.js) y medidos contra los momios de props del
   consenso (The Odds API, por evento, 6 créditos por juego, caché
   4h).

   Bajo demanda a propósito: solo cuando alguien abre los props de un
   juego. El índice de jugadores (temporada pasada + en curso) se arma
   una vez cada 10 min por lambda.

   Acceso: mismo candado que /api/nba-picks (beta privada mientras
   NBA_PUBLIC sea false). Invitado con la liga abierta: solo el juego
   del pick gratis del día.
   ============================================================ */
const { buildBoard, SEASON } = require('../lib/nba/model');
const { featuredId } = require('../lib/nba/featured');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { entitlementGrants } = require('../lib/plans');
const { loadSeason } = require('../lib/nba/season');
const { loadHistory, buildIndex, rotation, normName: normP } = require('../lib/nba/players');
const { buildPropsIndex, projectPlayer, probOver } = require('../lib/nba/props');
const { getInjuries } = require('../lib/nba/data');
const { getEventProps, normName, devigPair, probToAm } = require('../lib/nba/odds');
const { LEAGUE } = require('../lib/nba/priors');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const NBA_PUBLIC = false;

let _board = null;           // { at, value }
let _pidx = null;            // { at, pidx }
const _resp = new Map();     // gameId -> { at, value }
const BOARD_TTL = 5 * 60 * 1000, INDEX_TTL = 10 * 60 * 1000, RESP_TTL = 15 * 60 * 1000;

const LABEL = { pts: 'Puntos', reb: 'Rebotes', ast: 'Asistencias', tpm: 'Triples', pra: 'Puntos + rebotes + asistencias', dd: 'Doble-doble' };
/* Mercados donde el backtest no respalda BET: tope MAYBE (ver NBA-README). */
const CAP_MAYBE = new Set(['dd']);
/* Guardián de divergencia: línea del mercado a más de este % de la
   proyección → el mercado sabe algo (cambio de rol, minutos limitados,
   un compañero fuera). Se muestra la lectura, no se regala un BET. */
const DIVERGENCE_CAP = 0.35;
/* Un "edge" absurdo (≥12%) en un prop es señal de que el mercado sabe
   algo (minutos limitados, regreso de lesión, cambio de rol), no de
   valor: tope MAYBE. Y si CUALQUIER mercado del jugador diverge, todos
   los suyos se topan — la causa (su rol) es la misma. */
const EV_CAP = 0.12;
const OUT_STATUSES = new Set(['out', 'doubtful', 'suspended', 'injured reserve']);
const BLEND = 0.35;
function verdictOU(p, imp, pMkt, cap) {
  const pb = (1 - BLEND) * p + BLEND * pMkt;
  const ev = pb / imp - 1;
  let v = 'skip';
  if (pb >= 0.25 && ev >= 0.04) v = 'bet';
  else if (pb >= 0.25 && ev >= 0.015) v = 'maybe';
  if (cap && v === 'bet') v = 'maybe';
  return { verdict: v, ev: Math.round(ev * 1000) / 1000 };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Método no permitido.' }); }

  const simulate = IS_DEV && req.query && (req.query.as === 'guest' || req.query.as === 'beta') ? req.query.as : null;
  let isAdmin = false, access = 'guest';
  if (process.env.CRON_SECRET && req.headers['x-internal-auth'] === process.env.CRON_SECRET) { isAdmin = true; access = 'full'; }
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token && !simulate && !isAdmin) {
    const user = await getUserFromToken(token);
    if (user) {
      if (ADMIN_EMAILS.includes(user.email)) { isAdmin = true; access = 'full'; }
      else { const ent = await getEntitlement(user.id, user.email, 'nba'); if (entitlementGrants(ent, 'nba')) access = 'full'; }
    }
  }
  if (IS_DEV && !simulate) { isAdmin = true; access = 'full'; }
  if (!(NBA_PUBLIC || simulate === 'guest') && !isAdmin) {
    return res.status(403).json({ error: 'Modelo en beta privada.', beta: true });
  }

  const gameId = String(req.query.game || '');
  if (!gameId) return res.status(400).json({ error: 'Falta game.' });

  try {
    if (!_board || Date.now() - _board.at > BOARD_TTL) {
      const value = await buildBoard();
      value.featured_id = await featuredId(value);
      _board = { at: Date.now(), value };
    }
    const board = _board.value;
    if (access !== 'full' && String(board.featured_id) !== gameId) return res.status(403).json({ error: 'Los props de este juego están en tu plan.' });

    const rc = _resp.get(gameId);
    if (rc && Date.now() - rc.at < RESP_TTL) return res.status(200).json(rc.value);

    const g = (board.games || []).find(x => String(x.id) === gameId);
    if (!g || g.error) return res.status(404).json({ error: 'Juego no encontrado en la cartelera.' });
    if (g.state === 'post') return res.status(200).json({ game_id: gameId, players: [], note: 'El juego ya terminó.' });

    if (!_pidx || Date.now() - _pidx.at > INDEX_TTL) {
      const season = await loadSeason({ update: false });
      const idx = buildIndex(loadHistory({ years: [SEASON - 1], extraRows: season.playerRows }));
      _pidx = { at: Date.now(), pidx: buildPropsIndex(idx) };
    }
    const pidx = _pidx.pidx;
    const [injuries, oddsProps] = await Promise.all([getInjuries(), getEventProps(g.env && g.env.odds_event_id)]);
    const mkt = (oddsProps && oddsProps.players) || {};

    const players = [];
    for (const [side, team, opp, expPts] of [['away', g.away.abbr, g.home.abbr, g.env.exp_away], ['home', g.home.abbr, g.away.abbr, g.env.exp_home]]) {
      /* quiénes juegan hoy: la rotación reciente (umbral de minutos más
         bajo que el del modelo de equipo: aquí interesan los suplentes
         que sí tienen línea), menos los que el reporte da por fuera */
      const rot = rotation(pidx, team, g.date, { ROT_WINDOW: 15, ROT_MIN_APP: 0.4, ROT_MIN_MPG: 12, REPL_RATE: 0.28, VAL_HALF_LIFE: 10 });
      const inj = new Map();
      for (const i of injuries.get(team) || []) { inj.set(i.id || normP(i.name), i.status); inj.set(normP(i.name), i.status); }
      for (const [id, p] of rot) {
        const status = inj.get(id) || inj.get(normP(p.name)) || null;
        if (status && OUT_STATUSES.has(String(status).toLowerCase())) continue;
        const proj = projectPlayer(pidx, id, { date: g.date, team, opp, expPts, expPoss: g.env.exp_poss, lgPoss: LEAGUE.poss });
        if (!proj) continue;
        const pm = mkt[normName(p.name)] || {};
        const questionable = !!status || proj.team_changed;
        const markets = [];
        const anyDiverge = ['pts', 'reb', 'ast', 'pra'].some(k => pm[k] && pm[k].line > 0 && proj.markets[k] && Math.abs(proj.markets[k].mu - pm[k].line) / pm[k].line > DIVERGENCE_CAP);
        for (const key of ['pts', 'reb', 'ast', 'tpm', 'pra', 'dd']) {
          const m = proj.markets[key]; if (!m) continue;
          const line = pm[key] || null;
          const row = { key, label: LABEL[key], model: key === 'dd' ? { p: m.p } : { mu: m.mu, sd: m.sd }, line: null, books: line ? line.books : 0 };
          if (key === 'dd') {
            row.p = m.p;
            if (line && line.yes_imp != null) {
              const [dY, dN] = line.no_imp != null ? devigPair(line.yes_imp, line.no_imp) : [line.yes_imp, null];
              const side2 = m.p >= (dY != null ? dY : 0.5) ? 'yes' : 'no';
              const p2 = side2 === 'yes' ? m.p : 1 - m.p;
              const imp = side2 === 'yes' ? line.yes_imp : line.no_imp;
              const pMkt = side2 === 'yes' ? dY : dN;
              const v = (imp != null && pMkt != null) ? verdictOU(p2, imp, pMkt, true) : { verdict: 'lectura', ev: null };
              Object.assign(row, { line: imp != null ? { price: probToAm(imp) } : null, side: side2, p: +p2.toFixed(3), ev: v.ev, verdict: v.verdict });
            } else row.verdict = 'lectura';
          } else if (line && line.line != null) {
            const pOver = probOver(m, line.line);
            const sideOU = pOver >= 0.5 ? 'over' : 'under';
            const p2 = sideOU === 'over' ? pOver : 1 - pOver;
            const imp = sideOU === 'over' ? line.over_imp : line.under_imp;
            const [dO, dU] = devigPair(line.over_imp, line.under_imp);
            const pMkt = sideOU === 'over' ? dO : dU;
            const diverge = line.line > 0 && Math.abs(m.mu - line.line) / line.line > DIVERGENCE_CAP;
            const cap = CAP_MAYBE.has(key) || questionable || diverge || anyDiverge;
            let v = (imp != null && pMkt != null) ? verdictOU(p2, imp, pMkt, cap) : { verdict: 'skip', ev: null };
            if (v.verdict === 'bet' && v.ev >= EV_CAP) v = { ...v, verdict: 'maybe' };
            Object.assign(row, {
              line: { point: line.line, price: probToAm(imp) }, side: sideOU, p: +p2.toFixed(3), p_over: +pOver.toFixed(3), ev: v.ev, verdict: v.verdict,
              note: diverge ? 'línea muy lejos del historial: posible cambio de rol o minutos' : anyDiverge ? 'otro mercado suyo está lejos del historial: rol en duda' : proj.team_changed ? 'cambió de equipo: historial de otro sistema' : (status ? String(status).toLowerCase() : null) || (v.ev != null && v.ev >= EV_CAP ? 'edge demasiado grande para ser real: el mercado sabe algo' : null),
            });
          } else { row.verdict = 'lectura'; row.p_over = null; }
          markets.push(row);
        }
        if (!markets.length) continue;
        players.push({ id, name: p.name, pos: p.pos, team, side, status, questionable: !!status, team_changed: !!proj.team_changed,
          games: proj.games, minutes: proj.minutes, starter_rate: proj.starter_rate, f_pts: proj.f_pts, f_pace: proj.f_pace, markets });
      }
    }
    // orden: más minutos primero (los que de verdad tienen línea)
    players.sort((a, b) => (a.side === 'away' ? 0 : 1) - (b.side === 'away' ? 0 : 1) || b.minutes - a.minutes);

    const value = {
      game_id: gameId, away: g.away.abbr, home: g.home.abbr, date: g.date,
      odds_books: oddsProps ? oddsProps.books : 0,
      with_lines: players.reduce((n, p) => n + p.markets.filter(m => m.line).length, 0),
      players,
    };
    _resp.set(gameId, { at: Date.now(), value });
    return res.status(200).json(value);
  } catch (e) {
    console.error('nba-props:', e);
    return res.status(500).json({ error: 'Error al calcular los props.' });
  }
};
