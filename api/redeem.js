/* POST /api/redeem  { code }
   Canjea un código de acceso y otorga el plan correspondiente al usuario autenticado. */
const { getUserFromToken, grantEntitlement } = require('../lib/supabaseAdmin');

// Códigos válidos: código -> plan que otorga
const CODES = {
  'TEST100': 'torneo',
};

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const code = ((body && body.code) || '').toString().trim().toUpperCase();

  if (!code) return res.status(400).json({ error: 'Código requerido.' });

  const plan = CODES[code];
  if (!plan) return res.status(400).json({ error: 'Código inválido o expirado.' });

  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión para canjear un código.' });

  await grantEntitlement(user.id, plan);
  return res.status(200).json({ ok: true, plan });
};
