/* ============================================================
   GET /api/mx-picks
   Doctor Liga MX — corre el modelo en el servidor y devuelve SOLO
   probabilidades/veredictos. FREEMIUM con paywall server-side
   (mismo esquema que /api/mlb-picks):

   - Invitado (sin sesión o sin plan): el partido DESTACADO de la
     jornada va completo (es el pick gratis); el resto llega SIN
     veredictos, sin mercados y sin análisis (locked: true). El
     candado es real: los datos nunca salen del servidor, el blur
     del frontend es solo cosmético.
   - Plan mx_* / combo_* vigente (o admin): cartelera completa.

   Vigencia del plan = PLANS[plan].days desde entitlements.updated_at.
   ============================================================ */
const { buildBoard } = require('../lib/mx/model');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { PLANS } = require('../lib/plans');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

let _cache = null; // { at, value }
const TTL = 5 * 60 * 1000;

/* ¿El entitlement da acceso Liga MX vigente? (mx_* o combo_*) */
function mxAccessValid(ent) {
  if (!ent || !ent.active || !ent.plan) return false;
  if (!ent.plan.startsWith('mx_') && !ent.plan.startsWith('combo_')) return false;
  const plan = PLANS[ent.plan];
  if (!plan) return false;
  const days = plan.days || 30;
  const since = ent.updated_at ? Date.parse(ent.updated_at) : 0;
  return Number.isFinite(since) && (Date.now() - since) <= days * 86400e3;
}

/* El partido destacado = el pick con más convicción entre los que
   aún no empiezan (misma regla que /api/mx-free). */
function featuredId(games) {
  const pre = games.filter(g => !g.error && g.state === 'pre');
  const pool = pre.length ? pre : games.filter(g => !g.error);
  if (!pool.length) return null;
  return pool.reduce((a, b) => ((b.strength || 0) > (a.strength || 0) ? b : a)).id;
}

/* Versión censurada de un partido para invitados. */
function lockGame(g) {
  return {
    id: g.id,
    date: g.date,
    venue: g.venue,
    venue_city: g.venue_city,
    home: g.home,
    away: g.away,
    state: g.state,
    detail: g.detail,
    score: g.score,
    altitude_m: g.altitude_m,
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
        const ent = await getEntitlement(user.id, user.email, 'mx');
        if (mxAccessValid(ent)) access = 'full';
      }
    }
  }
  // dev local: acceso completo, salvo que se pida ver como invitado
  if (IS_DEV && access === 'guest' && req.query.as !== 'guest') access = 'full';

  const refresh = req.query && req.query.refresh === '1' && access === 'full';

  try {
    let value;
    if (!refresh && _cache && Date.now() - _cache.at < TTL) {
      value = _cache.value;
    } else {
      value = await buildBoard();
      value.featured_id = featuredId(value.games || []);
      _cache = { at: Date.now(), value };
    }

    res.setHeader('Cache-Control', 'no-store');
    if (access === 'full') {
      return res.status(200).json({ ...value, access: 'full' });
    }
    // invitado: destacado completo, el resto bloqueado
    const games = (value.games || []).map(g =>
      (g.error || g.id === value.featured_id) ? g : lockGame(g));
    return res.status(200).json({
      tournament: value.tournament,
      jornada: value.jornada,
      method: value.method,
      games_learned: value.games_learned,
      odds_source: value.odds_source,
      league: value.league,
      featured_id: value.featured_id,
      access: 'guest',
      locked_count: games.filter(g => g.locked).length,
      games,
    });
  } catch (e) {
    console.error('mx-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo Liga MX.' });
  }
};
