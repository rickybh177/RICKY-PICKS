/* POST /api/paypal-create  { plan }
   Crea una orden de PayPal y devuelve el approvalUrl para redirigir al cliente. */
const fetch = require('node-fetch');
const { getUserFromToken } = require('../lib/supabaseAdmin');
const { DISCOUNTS } = require('../lib/discounts');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET    = process.env.PAYPAL_SECRET;
const BASE            = 'https://api-m.paypal.com';

// Deriva la URL base del request (evita depender de SITE_URL, que puede apuntar a localhost).
function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host && !host.includes('localhost')) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://ricky-picks.vercel.app';
}

const PLANS = {
  individual: { name: 'RICKY-PICKS — Partidos del día', price: '22.99', currency: 'USD' },
  torneo:     { name: 'RICKY-PICKS — Torneo completo',  price: '28.99', currency: 'USD' },
};

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

    const plan = (body && body.plan) || 'torneo';
    if (!PLANS[plan]) return res.status(400).json({ error: 'Plan inválido.' });
    const discountCode = ((body && body.discount_code) || '').toString().trim().toUpperCase();
    const discount = discountCode && DISCOUNTS[discountCode] && DISCOUNTS[discountCode].plan === plan ? DISCOUNTS[discountCode] : null;

    const user = await getUserFromToken(bearer(req));
    if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

    const token = await getAccessToken();
    const p = PLANS[plan];
    const finalPrice = discount ? (parseFloat(p.price) * (1 - discount.pct / 100)).toFixed(2) : p.price;
    const productName = discount ? `${p.name} (${discount.pct}% descuento)` : p.name;
    const SITE_URL = siteUrl(req);

    const order = await fetch(`${BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: p.currency, value: finalPrice },
          description: productName,
          custom_id: `${user.id}:${plan}`,
        }],
        application_context: {
          brand_name: 'RICKY PICKS',
          landing_page: 'BILLING',
          user_action: 'PAY_NOW',
          return_url: `${SITE_URL}/checkout.html?plan=${plan}&via=paypal`,
          cancel_url: `${SITE_URL}/checkout.html?plan=${plan}`,
        },
      }),
    });

    const od = await order.json();
    const approvalUrl = (od.links || []).find(l => l.rel === 'approve')?.href;
    if (!approvalUrl) throw new Error('No se obtuvo URL de aprobación: ' + JSON.stringify(od));

    return res.status(200).json({ approvalUrl, orderId: od.id });
  } catch (e) {
    console.error('paypal-create:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
