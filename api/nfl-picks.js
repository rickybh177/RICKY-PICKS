/* ============================================================
   GET /api/nfl-picks?week=N
   MODELO NFL 26-27 — SOLO ADMIN (beta privada).

   A diferencia de MLB (freemium), aquí NO hay juego gratis ni
   vista de invitado: sin sesión de admin el endpoint regresa 403
   y CERO datos. El candado es real, del lado del servidor.
   ============================================================ */
const { buildWeek } = require('../lib/nfl/model');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const _cache = new Map(); // week -> { at, value }
const TTL = 5 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  // ---- candado: solo admin ----
  let isAdmin = false;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    const user = await getUserFromToken(token);
    if (user && ADMIN_EMAILS.includes(user.email)) isAdmin = true;
  }
  if (IS_DEV) isAdmin = true; // desarrollo local
  if (!isAdmin) return res.status(403).json({ error: 'Beta privada.' });

  const week = req.query && req.query.week ? Number(req.query.week) : null;
  const refresh = req.query && req.query.refresh === '1';
  const key = week || 'auto';

  try {
    const hit = _cache.get(key);
    let value;
    if (!refresh && hit && Date.now() - hit.at < TTL) {
      value = hit.value;
    } else {
      value = await buildWeek(week);
      _cache.set(key, { at: Date.now(), value });
      if (key === 'auto') _cache.set(value.week, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('nfl-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo NFL.' });
  }
};
