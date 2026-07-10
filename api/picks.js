/* ============================================================
   POST /api/picks  { home, away, neutral }
   Corre el modelo Dixon-Coles en el servidor y devuelve SOLO
   probabilidades y xG. Los coeficientes nunca salen de aquí.

   Acceso:
   - Partido gratis del día           -> sin sesión.
   - Plan "individual" / "torneo"     -> sesión (cuenta) con acceso,
                                         o un código canjeado válido.
   ============================================================ */
const { marketsFor, matchAllowed, todayFixtures, FREE_INDEX, FREE_FIXTURE } = require('../lib/model');
const { getAdmin, getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Plan asociado a un código ya canjeado (sin consumirlo). Requiere la
// función SQL `pick_access` en Supabase (ver README). Si no existe,
// regresa null y el acceso por código simplemente no se concede.
async function planFromCode(code) {
  if (!code) return null;
  try {
    const admin = getAdmin();
    const { data, error } = await admin.rpc('pick_access', { p_code: code });
    if (error || !data) return null;
    // La RPC puede regresar { plan } o directamente el texto del plan.
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return data[0] && (data[0].plan || data[0]);
    return data.plan || null;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { home, away } = body || {};
  const neutral = !!(body && body.neutral);

  if (!home || !away) {
    return res.status(400).json({ error: 'Falta el partido. Elige local y visitante.' });
  }
  if (home === away) {
    return res.status(400).json({ error: 'Elige dos selecciones distintas.' });
  }

  // ¿Qué plan acredita esta petición?
  let plan = null;

  // 1) Partido gratis del día: abierto, sin sesión.
  const today = todayFixtures();
  const free = FREE_FIXTURE || today[FREE_INDEX];
  const isFree = free && (
    (free.home === home && free.away === away) ||
    (free.home === away && free.away === home)
  );
  if (isFree) plan = 'free';

  // 2) Sesión con cuenta (JWT) + acceso activo.
  if (!plan) {
    const user = await getUserFromToken(bearer(req));
    if (user) {
      const ent = await getEntitlement(user.id, user.email, 'mundial');
      if (ent && ent.active) plan = ent.plan;
    }
  }

  // 3) Código canjeado válido.
  if (!plan) {
    const code = (req.headers['x-rp-code'] || '').toString().trim().toUpperCase();
    if (code) plan = await planFromCode(code);
  }

  if (!plan) {
    return res.status(401).json({ error: 'Necesitas acceso para ver este partido. Inicia sesión o canjea tu código.' });
  }
  if (!matchAllowed(plan, home, away)) {
    return res.status(403).json({ error: 'Tu acceso no cubre este partido.' });
  }

  const m = marketsFor(home, away, neutral);
  if (!m) {
    return res.status(422).json({ error: 'Sin datos del modelo para ese equipo.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ markets: m, neutral });
};
