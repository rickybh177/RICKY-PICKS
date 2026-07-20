/* POST /api/redeem  { code }
   Canjea un código de acceso (gratis) o valida un código de descuento. */
const { getUserFromToken, grantEntitlement } = require('../lib/supabaseAdmin');
const { DISCOUNTS } = require('../lib/discounts');

// Códigos válidos: código -> plan que otorga
const CODES = {
  'TEST1':   'torneo',
  'RAFAVIP': 'torneo',
  'NOTVIP':  'torneo',
  'EDUVIP':  'torneo',
  'JERSONVIP': 'torneo',
  'OVIEDO':    'torneo',
  'SAUVIP':    'individual',
  'SAUVIP1':   'torneo',
  'LAMERAPOLVORAVIP': 'torneo',
  'REYES6': 'individual',
  'CESAR1': 'individual',
  'DAVID1': 'individual',
  'IGNACIO1': 'torneo',
  'MUGUELVIP': 'torneo',
  'MIGUELVIP': 'torneo',
  'JOSHVIP':   'torneo',
  'PLATA100':  'torneo',
  'FINOVIP':   'torneo',
  'MLBPLATA': 'mlb_fundador', // código de soporte: desbloqueo manual de MLB mensual
  'SAUMLB': 'mlb_semana', // código semanal de MLB
  'MLBSEM': 'mlb_semana', // código semanal de MLB
  'ARTUROF': 'mx_apertura', // acceso completo Liga MX (Apertura 2026 + liguilla)
  'LORDI': 'final', // acceso solo a la gran final del Mundial (Argentina vs España)
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

    // ¿Es código de descuento?
    const discount = DISCOUNTS[code];
    if (discount) {
      return res.status(200).json({ ok: true, type: 'discount', plan: discount.plan, pct: discount.pct });
    }

    const plan = CODES[code];
    if (!plan) return res.status(400).json({ error: 'Código inválido o expirado.' });

    const user = await getUserFromToken(bearer(req));
    if (!user) return res.status(401).json({ error: 'Inicia sesión para canjear un código.' });

    await grantEntitlement(user.id, plan);
    return res.status(200).json({ ok: true, type: 'access', plan });
  } catch (e) {
    console.error('redeem error:', e);
    return res.status(500).json({ error: 'Error interno: ' + (e.message || JSON.stringify(e)) });
  }
};
