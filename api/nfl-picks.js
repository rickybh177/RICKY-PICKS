/* ============================================================
   GET /api/nfl-picks?week=N
   MODELO NFL 26-27 — FREEMIUM con paywall server-side (mismo
   esquema que MLB):

   - Invitado (sin sesión o sin plan): el juego DESTACADO de la
     jornada va completo (es el pick gratis); el resto llega SIN
     veredictos, sin mercados, sin props y sin análisis
     (locked: true). El candado es real: esos datos nunca salen
     del servidor; el blur del frontend es solo cosmético.
   - Plan nfl_* / combo_* vigente (o admin): jornada completa.

   Vigencia del plan = PLANS[plan].days desde entitlements.updated_at.
   ============================================================ */
const { buildWeek } = require('../lib/nfl/model');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { entitlementGrants } = require('../lib/plans');
const { kvGet, kvPut } = require('../lib/odds/theoddsapi');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const _cache = new Map(); // week -> { at, value }
const TTL = 5 * 60 * 1000;

/* ---- pick gratis: UNO por semana ----
   Regla: mientras el destacado NO haya arrancado, es el juego con
   el pick más probable estadísticamente (los BET mandan) y puede
   re-elegirse si llegan momios que revelan uno mejor. En cuanto
   patea, queda CONGELADO toda la semana (persistido en el bucket
   de Supabase Storage): si ya se jugó, el frontend lo dice y manda
   al modelo completo. Antes se re-elegía entre los juegos por
   empezar y cada juego jugado regalaba un pick nuevo — el pick
   gratis debe rotar semana con semana, no día con día. */
function pickBest(list) {
  if (!list.length) return null;
  const score = g => {
    const vs = g.verdicts || [];
    const bestBet = Math.max(0, ...vs.filter(v => v.verdict === 'bet').map(v => v.prob || 0));
    const bestAny = Math.max(0, ...vs.map(v => v.prob || 0));
    return bestBet * 10 + bestAny; // los BET mandan; desempate por probabilidad
  };
  return list.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
}

async function resolveFeatured(value) {
  const games = (value.games || []).filter(g => !g.error);
  if (!games.length) return null;
  const kvKey = `nfl-free-${value.season}-st${value.seasontype}-w${value.week}`;
  const saved = await kvGet(kvKey);
  const savedGame = saved && saved.id ? games.find(g => g.id === saved.id) : null;
  // ya arrancó o terminó: fijo, aunque sus momios hayan desaparecido
  if (savedGame && savedGame.state !== 'pre') return savedGame.id;
  // aún no arranca: elegir el más probable entre los POR JUGAR
  const pool = games.filter(g => g.state === 'pre');
  const id = pickBest(pool.length ? pool : games);
  if (id && (!savedGame || savedGame.id !== id)) await kvPut(kvKey, { id });
  return id || (savedGame ? savedGame.id : null);
}

/* Versión censurada de un juego para invitados: se queda lo que
   ya es público (equipos, hora, sede, marcador) y se va TODO lo
   que produce el modelo. */
function lockGame(g) {
  return {
    id: g.id,
    date: g.date,
    venue: g.venue,
    neutral: g.neutral,
    preseason: g.preseason,
    home: g.home,
    away: g.away,
    state: g.state,
    score: g.score,
    rest: g.rest,
    locked: true,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  // ---- nivel de acceso ----
  let access = 'guest';
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    const user = await getUserFromToken(token);
    if (user) {
      if (ADMIN_EMAILS.includes(user.email)) access = 'full';
      else {
        const ent = await getEntitlement(user.id, user.email, 'nfl');
        if (entitlementGrants(ent, 'nfl')) access = 'full';
      }
    }
  }
  // dev local: acceso completo, salvo que se pida ver como invitado
  if (IS_DEV && access === 'guest' && req.query.as !== 'guest') access = 'full';

  const week = req.query && req.query.week ? Number(req.query.week) : null;
  // st: 1 pretemporada · 2 regular · vacío = fase actual del calendario
  const st = req.query && req.query.st ? Number(req.query.st) : null;
  const refresh = req.query && req.query.refresh === '1' && access === 'full';
  const key = (st || 'auto') + ':' + (week || 'auto');

  try {
    const hit = _cache.get(key);
    let value;
    if (!refresh && hit && Date.now() - hit.at < TTL) {
      value = hit.value;
    } else {
      value = await buildWeek(week, st);
      value.featured_id = await resolveFeatured(value);
      _cache.set(key, { at: Date.now(), value });
      if (key === 'auto:auto') _cache.set(value.seasontype + ':' + value.week, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'no-store');
    if (access === 'full') {
      return res.status(200).json({ ...value, access: 'full' });
    }
    // invitado: destacado completo, el resto bloqueado
    const games = (value.games || []).map(g =>
      g.id === value.featured_id ? g : lockGame(g));
    return res.status(200).json({
      ...value,
      access: 'guest',
      locked_count: games.filter(g => g.locked).length,
      games,
    });
  } catch (e) {
    console.error('nfl-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo NFL.' });
  }
};
