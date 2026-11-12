/* ============================================================
   GET /api/nhl-picks[?day=YYYY-MM-DD][&refresh=1][&as=guest|beta]
   MODELO NHL 2026-27 — cartelera de hoy y mañana (hora CDMX).

   BETA PRIVADA (mismo esquema con que nacieron MLB / Liga MX /
   Europa / NBA): mientras NHL_PUBLIC sea false, cualquier caller que no sea
   admin recibe 403 { error, beta: true } y la página muestra "Beta
   privada". Al abrirla: freemium con paywall server-side como NFL —
   el juego DESTACADO va completo (pick gratis) y el resto llega SIN
   veredictos, sin mercados ni análisis (locked: true). El candado es
   real: esos datos nunca salen del servidor.

   Acceso completo: admin, plan con producto `nhl` vigente, o la
   llamada interna del cron de Instagram (x-internal-auth: CRON_SECRET).
   Dev local: acceso completo; `?as=guest` simula al público con la
   liga abierta; `?as=beta` simula al público con la liga privada.
   ============================================================ */
const { buildBoard } = require('../lib/nhl/model');
const { featuredId, pickDeCard } = require('../lib/nhl/featured');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { entitlementGrants } = require('../lib/plans');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

/* 11-nov-2026: NACE EN BETA PRIVADA (solo admin). Para abrirla al
   público (freemium: pick gratis completo, el resto bloqueado en el
   servidor): true aquí y en api/nhl-free.js. */
const NHL_PUBLIC = true;   // 11-nov-2026: abierto al público (freemium)

const _cache = new Map(); // day|auto -> { at, value }
const TTL = 5 * 60 * 1000;

function lockGame(g) {
  return { id: g.id, date: g.date, day_mx: g.day_mx, venue: g.venue, home: g.home, away: g.away, state: g.state, score: g.score, rest: g.rest, goalies: g.goalies, locked: true };
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
      else { const ent = await getEntitlement(user.id, user.email, 'nhl'); if (entitlementGrants(ent, 'nhl')) access = 'full'; }
    }
  }
  if (IS_DEV && !simulate) { isAdmin = true; access = 'full'; }

  const isPublic = NHL_PUBLIC || simulate === 'guest';
  if (!isPublic && !isAdmin) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Modelo en beta privada.', beta: true, league_id: 'nhl', league_name: 'NHL' });
  }

  const day = req.query && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? String(req.query.day) : null;
  const refresh = req.query && req.query.refresh === '1' && access === 'full';
  const key = day || 'auto';
  try {
    const hit = _cache.get(key);
    let value;
    if (!refresh && hit && Date.now() - hit.at < TTL) value = hit.value;
    else {
      value = await buildBoard({ day });
      value.featured_id = await featuredId(value);
      _cache.set(key, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'no-store');
    const destacado = (value.games || []).find(g => g.id === value.featured_id) || null;
    const featured_pick = pickDeCard(destacado);
    if (access === 'full') return res.status(200).json({ ...value, featured_pick, access: 'full' });
    const games = (value.games || []).map(g => (g.error || g.id === value.featured_id) ? g : lockGame(g));
    return res.status(200).json({
      season: value.season, days: value.days, games_learned: value.games_learned, odds_source: value.odds_source,
      featured_id: value.featured_id, featured_pick, access: 'guest', locked_count: games.filter(g => g.locked).length, games,
    });
  } catch (e) {
    console.error('nhl-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo NHL.' });
  }
};
module.exports.NHL_PUBLIC = NHL_PUBLIC;
