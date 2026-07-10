/* ============================================================
   GET /api/my-access
   Requiere sesión. Regresa qué productos tiene activos el usuario
   (Mundial y/o MLB) para poder mostrar el switcher entre "Mis
   modelos" (Mundial) y "Modelo MLB" cuando tiene ambos.
   ============================================================ */
const { getUserFromToken, getEntitlements } = require('../lib/supabaseAdmin');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

  try {
    const ents = await getEntitlements(user.id, user.email);
    const mundial = ents.find(e => e.product === 'mundial' && e.active);
    const mlb = ents.find(e => e.product === 'mlb' && e.active);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      mundial: !!mundial,
      mundial_plan: mundial ? mundial.plan : null,
      mlb: !!mlb,
      mlb_plan: mlb ? mlb.plan : null,
    });
  } catch (e) {
    console.error('my-access:', e);
    return res.status(500).json({ error: 'Error interno.' });
  }
};
