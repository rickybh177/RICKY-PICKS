/* ============================================================
   GET /api/mlb-picks?date=YYYY-MM-DD
   Corre el modelo MLB (Monte Carlo turno al bate) en el servidor
   y devuelve SOLO probabilidades y datos públicos del juego.
   Las tasas/splits/parámetros nunca salen del backend.

   Acceso: SOLO ADMIN por ahora (producto no publicado).
   Cuando se publique: cambiar el gate por getEntitlement con el
   plan 'mlb' (mismo patrón que api/picks.js).
   ============================================================ */
const { buildDay } = require('../lib/mlb/model');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];

// En dev local (dev-server.js, sin Vercel) no exigimos sesión.
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

// Caché in-memory del día ya simulado (por instancia de lambda).
const _dayCache = new Map(); // date -> { at, value }
const DAY_TTL = 5 * 60 * 1000; // lineups y clima cambian: 5 min

// Fecha "de hoy" en horario del Este (los días de MLB van con ET).
function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  // ---- gate de acceso (admin-only mientras no se publique) ----
  if (!IS_DEV) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const user = await getUserFromToken(token);
    if (!user || !ADMIN_EMAILS.includes(user.email)) {
      return res.status(403).json({ error: 'Acceso no autorizado.' });
    }
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query && req.query.date || ''))
    ? req.query.date
    : todayET();
  const refresh = req.query && req.query.refresh === '1';

  try {
    const hit = _dayCache.get(date);
    let value;
    if (!refresh && hit && Date.now() - hit.at < DAY_TTL) {
      value = hit.value;
    } else {
      value = await buildDay(date);
      _dayCache.set(date, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('mlb-picks:', e);
    return res.status(500).json({ error: 'Error al correr el modelo MLB.' });
  }
};
