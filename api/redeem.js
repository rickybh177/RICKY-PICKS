/* POST /api/redeem  { code }
   Canjea un código de acceso y otorga el plan correspondiente al usuario autenticado. */
const { getUserFromToken, grantEntitlement } = require('../lib/supabaseAdmin');

// Códigos válidos: código -> plan que otorga
const CODES = {
  'TEST1':   'torneo',
  'RAFAVIP': 'torneo',
  'NOTVIP':  'torneo',
  'EDUVIP':  'torneo',
  'JERSONVIP': 'torneo',
  'OVIEDO':    'torneo',
};

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
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
  } catch (e) {
    console.error('redeem error:', e);
    return res.status(500).json({ error: 'Error interno: ' + (e.message || JSON.stringify(e)) });
  }
};
