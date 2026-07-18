/* ============================================================
   GET /api/mx-picks
   MODELO LIGA MX (Apertura 2026) — SOLO ADMIN (beta privada).

   Igual que NFL: sin sesión de admin el endpoint regresa 403 y
   CERO datos. El candado es real, del lado del servidor.
   ============================================================ */
const { buildBoard } = require('../lib/mx/model');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

let _cache = null; // { at, value }
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

  const refresh = req.query && req.query.refresh === '1';

  try {
    let value;
    if (!refresh && _cache && Date.now() - _cache.at < TTL) {
      value = _cache.value;
    } else {
      value = await buildBoard();
      _cache = { at: Date.now(), value };
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('mx-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo Liga MX.' });
  }
};
