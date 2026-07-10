/* ============================================================
   GET /api/mlb-picks?date=YYYY-MM-DD
   Doctor MLB — corre el modelo en el servidor y devuelve SOLO
   probabilidades/veredictos. FREEMIUM con paywall server-side:

   - Invitado (sin sesión o sin plan): el juego DESTACADO del día
     va completo (es el pick gratis); el resto llega SIN veredictos,
     sin mercados y sin análisis (locked: true). El candado es real:
     los datos nunca salen del servidor, el blur del frontend es
     solo cosmético.
   - Plan mlb_* vigente (o admin): día completo.

   Vigencia del plan = PLANS[plan].days desde entitlements.updated_at.
   ============================================================ */
const { buildDay } = require('../lib/mlb/model');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { PLANS } = require('../lib/plans');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const _dayCache = new Map(); // date -> { at, value }
const DAY_TTL = 5 * 60 * 1000;

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* ¿El entitlement da acceso Doctor MLB vigente? */
function mlbAccessValid(ent) {
  if (!ent || !ent.active || !ent.plan) return false;
  if (!ent.plan.startsWith('mlb_')) return false;
  const plan = PLANS[ent.plan];
  if (!plan) return false;
  const days = plan.days || 30;
  const since = ent.updated_at ? Date.parse(ent.updated_at) : 0;
  return Number.isFinite(since) && (Date.now() - since) <= days * 86400e3;
}

/* El juego destacado del día = el del pick con más convicción
   (misma regla que /api/mlb-free para que siempre coincidan). */
function featuredPk(games) {
  const pool = games.filter(g => !g.error && g.abstract_state !== 'Final');
  const list = pool.length ? pool : games.filter(g => !g.error);
  if (!list.length) return null;
  return list.reduce((a, b) => {
    const sa = (a.picks && a.picks[0] && a.picks[0].strength) || 0;
    const sb = (b.picks && b.picks[0] && b.picks[0].strength) || 0;
    return sb > sa ? b : a;
  }).gamePk;
}

/* Versión censurada de un juego para invitados. */
function lockGame(g) {
  return {
    gamePk: g.gamePk,
    game_date: g.game_date,
    status: g.status,
    abstract_state: g.abstract_state,
    venue: g.venue,
    home: g.home,
    away: g.away,
    pitchers: g.pitchers,
    lineups_confirmed: g.lineups_confirmed,
    locked: true,
  };
}

module.exports = async function handler(req, res) {
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
        const ent = await getEntitlement(user.id, user.email);
        if (mlbAccessValid(ent)) access = 'full';
      }
    }
  }
  // dev local: acceso completo, salvo que se pida ver como invitado
  if (IS_DEV && access === 'guest' && req.query.as !== 'guest') access = 'full';

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query && req.query.date || ''))
    ? req.query.date
    : todayET();
  const refresh = req.query && req.query.refresh === '1' && access === 'full';

  try {
    const hit = _dayCache.get(date);
    let value;
    if (!refresh && hit && Date.now() - hit.at < DAY_TTL) {
      value = hit.value;
    } else {
      value = await buildDay(date);
      value.featured_pk = featuredPk(value.games || []);
      _dayCache.set(date, { at: Date.now(), value });
    }

    res.setHeader('Cache-Control', 'no-store');
    if (access === 'full') {
      return res.status(200).json({ ...value, access: 'full' });
    }
    // invitado: destacado completo, el resto bloqueado
    const games = (value.games || []).map(g =>
      (g.error || g.gamePk === value.featured_pk) ? g : lockGame(g));
    return res.status(200).json({
      date: value.date,
      featured_pk: value.featured_pk,
      access: 'guest',
      locked_count: games.filter(g => g.locked).length,
      games,
    });
  } catch (e) {
    console.error('mlb-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo MLB.' });
  }
};
