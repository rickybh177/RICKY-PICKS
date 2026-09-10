/* ============================================================
   GET /api/nfl-props?game=<espnId>&st=<1|2>&week=<n>
   PROPS DE JUGADOR de un juego: yardas por pase / carrera /
   recepción, recepciones, completos, TDs de pase y anytime TD,
   proyectados por jugador (lib/nfl/props.js) y medidos contra los
   momios de props del consenso (The Odds API, por evento).

   Bajo demanda a propósito: cada juego cuesta 7 créditos de momios
   y se comparte 4h; el historial jugador-juego se indexa una vez
   por semana y se reutiliza.

   Acceso: mismo candado que /api/nfl-picks. Invitado: solo el
   juego del pick gratis de la semana (el guardado en el KV).
   ============================================================ */
const { buildWeek, SEASON } = require('../lib/nfl/model');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { entitlementGrants } = require('../lib/plans');
const { kvGet } = require('../lib/odds/theoddsapi');
const { getDepthChart, getRoster, getSeasonPlayerRows } = require('../lib/nfl/players');
const { loadHistory, buildIndex, projectPlayer, probOver, probAtLeastOne } = require('../lib/nfl/props');
const { getEventProps, normName, devigPair, probToAm } = require('../lib/nfl/odds');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const _weekCache = new Map();  // st:week -> { at, value }
const _indexCache = new Map(); // st:week -> { at, idx }
const WEEK_TTL = 5 * 60 * 1000, INDEX_TTL = 10 * 60 * 1000, RESP_TTL = 15 * 60 * 1000;
const _respCache = new Map();  // gameId -> { at, value }

const LABEL = {
  pass_yds: 'Yardas por pase', pass_tds: 'TDs de pase', pass_completions: 'Pases completos',
  rush_yds: 'Yardas por carrera', reception_yds: 'Yardas por recepción', receptions: 'Recepciones',
  anytime_td: 'Anota TD (anytime)',
};
/* Mercados donde el backtest no respalda BET (calibración floja):
   se muestran como lectura, tope MAYBE. */
const CAP_MAYBE = new Set(['pass_tds']);
/* Guardián de divergencia: si la línea del mercado está a más de
   este % del historial del jugador, el mercado casi siempre sabe
   algo que el historial no (cambio de equipo o de rol, lesión de un
   compañero). Se muestra la lectura pero no se regala un BET
   inflado — pasó en la prueba: Deebo Samuel 49 yds de historial vs
   línea 28.5 → "+27% EV" que era cambio de rol, no valor. */
const DIVERGENCE_CAP = 0.35;
const OUT_STATUSES = new Set(['Out', 'Doubtful', 'Injured Reserve', 'Suspended', 'Physically Unable to Perform']);

/* Titulares por equipo según depth chart, con lesiones del roster. */
async function starters(abbr, season) {
  const [dc, roster] = await Promise.all([getDepthChart(abbr, season), getRoster(abbr)]);
  if (!dc) return [];
  const pick = (ids, n, pos) => ids.slice(0, n).map(id => ({ id, pos, ...(roster.get(id) || { name: null }) }));
  const list = [...pick(dc.QB, 1, 'QB'), ...pick(dc.RB, 2, 'RB'), ...pick(dc.WR, 3, 'WR'), ...pick(dc.TE, 1, 'TE')];
  return list.filter(p => p.name && !OUT_STATUSES.has(p.injury) && !OUT_STATUSES.has(p.status));
}

/* Veredicto por EV contra el precio del consenso (blend hacia el
   devig del mercado como en el resto del modelo; props son mercados
   eficientes, así que el blend es mayor: 0.30). */
const BLEND = 0.30;
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

  // ---- acceso ----
  let access = 'guest';
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    const user = await getUserFromToken(token);
    if (user) {
      if (ADMIN_EMAILS.includes(user.email)) access = 'full';
      else { const ent = await getEntitlement(user.id, user.email, 'nfl'); if (entitlementGrants(ent, 'nfl')) access = 'full'; }
    }
  }
  if (IS_DEV && access === 'guest' && req.query.as !== 'guest') access = 'full';

  const gameId = String(req.query.game || '');
  const st = Number(req.query.st) === 1 ? 1 : 2;
  const week = Number(req.query.week) || null;
  if (!gameId || !week) return res.status(400).json({ error: 'Faltan game/week.' });
  if (st === 1) return res.status(200).json({ game_id: gameId, players: [], note: 'Sin props en pretemporada: los titulares juegan un cuarto.' });

  try {
    // invitado: solo el pick gratis de la semana
    if (access !== 'full') {
      const saved = await kvGet(`nfl-free-${SEASON}-st${st}-w${week}`);
      if (!saved || String(saved.id) !== gameId) return res.status(403).json({ error: 'Los props de este juego están en tu plan.' });
    }

    const rc = _respCache.get(gameId);
    if (rc && Date.now() - rc.at < RESP_TTL) return res.status(200).json(rc.value);

    // semana (para el entorno del juego)
    const wkKey = `${st}:${week}`;
    let wk = _weekCache.get(wkKey);
    if (!wk || Date.now() - wk.at < 0 || Date.now() - wk.at > WEEK_TTL) {
      wk = { at: Date.now(), value: await buildWeek(week, st) };
      _weekCache.set(wkKey, wk);
    }
    const g = (wk.value.games || []).find(x => String(x.id) === gameId);
    if (!g || g.error) return res.status(404).json({ error: 'Juego no encontrado en esa semana.' });
    if (!g.env) return res.status(200).json({ game_id: gameId, players: [], note: 'Sin props para este juego.' });

    // historial: temporadas pasadas + juegos ya jugados de esta
    let ic = _indexCache.get(wkKey);
    if (!ic || Date.now() - ic.at > INDEX_TTL) {
      const extraRows = await getSeasonPlayerRows(SEASON, week - 1);
      ic = { at: Date.now(), idx: buildIndex(loadHistory({ years: [2024, 2025], extraRows })) };
      _indexCache.set(wkKey, ic);
    }
    const idx = ic.idx;

    const [awaySt, homeSt, oddsProps] = await Promise.all([
      starters(g.away.abbr, SEASON), starters(g.home.abbr, SEASON), getEventProps(g.env.odds_event_id),
    ]);
    const mkt = (oddsProps && oddsProps.players) || {};

    const players = [];
    for (const [side, list, team, opp, expPts] of [
      ['away', awaySt, g.away.abbr, g.home.abbr, g.env.exp_away], ['home', homeSt, g.home.abbr, g.away.abbr, g.env.exp_home],
    ]) {
      for (const p of list) {
        const proj = projectPlayer(idx, p.id, p.pos, { date: g.date, team, opp, expPts });
        if (!proj) continue; // sin historial suficiente: no se inventa
        const pm = mkt[normName(p.name)] || {};
        // Questionable o recién cambiado de equipo: su historial no es
        // esta ofensiva/este estado → se muestra, pero tope MAYBE
        const questionable = p.injury === 'Questionable' || proj.team_changed;
        const markets = [];
        for (const key in proj.markets) {
          const m = proj.markets[key], line = pm[key] || null;
          const row = { key, label: LABEL[key] || key, model: m, line: null, books: line ? line.books : 0 };
          if (key === 'anytime_td') {
            const pYes = probAtLeastOne(m);
            row.p = +pYes.toFixed(3);
            if (line && line.yes_imp != null) {
              row.line = { price: probToAm(line.yes_imp) };
              // sin lado "No" para devig: EV con el vig adentro (conservador)
              // y tope MAYBE — el backtest calibra la probabilidad, no el precio
              const ev = pYes / line.yes_imp - 1;
              row.ev = Math.round(ev * 1000) / 1000;
              row.verdict = ev >= 0.02 ? 'maybe' : 'skip';
              row.side = 'yes';
            } else row.verdict = 'lectura';
          } else {
            if (line && line.line != null) {
              const pOver = probOver(m, line.line);
              const side = pOver >= 0.5 ? 'over' : 'under';
              const p = side === 'over' ? pOver : 1 - pOver;
              const imp = side === 'over' ? line.over_imp : line.under_imp;
              const [dO, dU] = devigPair(line.over_imp, line.under_imp);
              const pMkt = side === 'over' ? dO : dU;
              const diverge = line.line > 0 && Math.abs(m.mu - line.line) / line.line > DIVERGENCE_CAP;
              const cap = CAP_MAYBE.has(key) || questionable || diverge;
              const v = (imp != null && pMkt != null) ? verdictOU(p, imp, pMkt, cap) : { verdict: 'skip', ev: null };
              Object.assign(row, {
                line: { point: line.line, price: probToAm(imp) }, side, p: +p.toFixed(3), p_over: +pOver.toFixed(3),
                ev: v.ev, verdict: v.verdict,
                note: diverge ? 'línea muy lejos del historial: posible cambio de rol'
                  : proj.team_changed ? 'cambió de equipo: historial de otra ofensiva'
                  : (p.injury === 'Questionable' ? 'questionable' : null),
              });
            } else {
              // sin línea del mercado: solo lectura, nunca BET
              row.verdict = 'lectura';
              row.p_over = null;
            }
          }
          markets.push(row);
        }
        if (!markets.length) continue;
        players.push({ id: p.id, name: p.name, pos: p.pos, team, side,
          injury: p.injury || null, questionable: p.injury === 'Questionable', team_changed: !!proj.team_changed,
          games: proj.games, f_env: proj.f_env, markets });
      }
    }

    const value = {
      game_id: gameId, week, seasontype: st,
      away: g.away.abbr, home: g.home.abbr, date: g.date,
      odds_books: oddsProps ? oddsProps.books : 0,
      with_lines: players.reduce((n, p) => n + p.markets.filter(m => m.line).length, 0),
      players,
    };
    _respCache.set(gameId, { at: Date.now(), value });
    return res.status(200).json(value);
  } catch (e) {
    console.error('nfl-props:', e);
    return res.status(500).json({ error: 'Error al calcular los props.' });
  }
};
