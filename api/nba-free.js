/* ============================================================
   GET /api/nba-free
   Devuelve UN solo juego de NBA — el pick gratis del día (el mismo
   destacado que /api/nba-picks, overrides y clavado incluidos) — con
   la forma de /api/mx-free, para la card del landing, producto.html y
   el post diario de Instagram (lib/ig/plan.js).

   BETA PRIVADA: mientras NBA_PUBLIC sea false (mismo valor que en
   api/nba-picks.js), contesta 403 { error, beta: true } a quien no sea
   admin. Al abrirse es PÚBLICO sin sesión, como /api/mx-free.
   ============================================================ */
const { buildBoard } = require('../lib/nba/model');
const { featuredId, pickDeCard } = require('../lib/nba/featured');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const NBA_PUBLIC = false;

let _cache = null; // { at, value }
const TTL = 10 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Método no permitido.' }); }

  const simulate = IS_DEV && req.query && (req.query.as === 'guest' || req.query.as === 'beta') ? req.query.as : null;
  let isAdmin = (IS_DEV && !simulate) || (process.env.CRON_SECRET && req.headers['x-internal-auth'] === process.env.CRON_SECRET);
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token && !isAdmin && !simulate) {
    const user = await getUserFromToken(token);
    if (user && ADMIN_EMAILS.includes(user.email)) isAdmin = true;
  }
  if (!(NBA_PUBLIC || simulate === 'guest') && !isAdmin) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Modelo en beta privada.', beta: true, league_id: 'nba', league_name: 'NBA' });
  }

  try {
    let value;
    if (_cache && Date.now() - _cache.at < TTL) value = _cache.value;
    else {
      const board = await buildBoard();
      const id = await featuredId(board);
      const best = (board.games || []).find(g => g.id === id) || null;
      if (!best) value = { days: board.days, game: null };
      else {
        const pick = pickDeCard(best);
        value = {
          days: board.days, league_id: 'nba', league_name: 'NBA',
          game: {
            id: best.id, date: best.date, day_mx: best.day_mx, venue: best.venue, state: best.state,
            home: { abbr: best.home.abbr, name: best.home.name, logo: best.home.logo, record: best.home.record, city: best.home.city },
            away: { abbr: best.away.abbr, name: best.away.name, logo: best.away.logo, record: best.away.record, city: best.away.city },
            moneyline: best.markets ? best.markets.moneyline : null,
            pick,
            verdicts: best.verdicts || [],
            margin_dist: (best.markets && best.markets.margin_dist) || [],
            env: best.env || null,
          },
        };
      }
      _cache = { at: Date.now(), value };
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('nba-free:', e);
    return res.status(500).json({ error: 'Sin datos por ahora.' });
  }
};
