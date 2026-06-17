/* POST /api/paypal-capture  { orderId }
   Captura el pago de PayPal y otorga el entitlement al usuario. */
const { getUserFromToken, grantEntitlement } = require('../lib/supabaseAdmin');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET    = process.env.PAYPAL_SECRET;
const BASE             = 'https://api-m.paypal.com';

async function getAccessToken() {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('No se pudo obtener token de PayPal');
  return d.access_token;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const orderId = body && body.orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido.' });

    const user = await getUserFromToken(bearer(req));
    if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

    const token = await getAccessToken();

    // Capturar el pago
    const capture = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const cd = await capture.json();

    if (cd.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Pago no completado: ' + cd.status });
    }

    // Extraer plan del custom_id (formato: "userId:plan")
    const customId = cd.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id || '';
    const plan = customId.split(':')[1] || 'torneo';

    await grantEntitlement(user.id, plan);
    return res.status(200).json({ ok: true, plan });
  } catch (e) {
    console.error('paypal-capture:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
