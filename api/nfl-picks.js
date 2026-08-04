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

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const _cache = new Map(); // week -> { at, value }
const TTL = 5 * 60 * 1000;

/* El juego destacado de la jornada = el del pick con más
   convicción entre los que aún no empiezan. */
function featuredId(games) {
  const pool = (games || []).filter(g => g.state === 'pre');
  const list = pool.length ? pool : (games || []);
  if (!list.length) return null;
  return list.reduce((a, b) => ((b.strength || 0) > (a.strength || 0) ? b : a)).id;
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
      value.featured_id = featuredId(value.games || []);
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
