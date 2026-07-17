/* ============================================================
   POST /api/billing-portal   (requiere sesión)
   Abre el Customer Portal de Stripe para el usuario: una página
   hosteada por Stripe (estilo Netflix) donde puede actualizar su
   tarjeta, ver sus facturas y cancelar su suscripción.

   - Busca al customer de Stripe por el email de la cuenta y
     prefiere el que tenga suscripciones.
   - Si el usuario no tiene customer en Stripe (p. ej. se suscribió
     por Mercado Pago, que no tiene portal), responde
     { fallback: true } y el frontend abre nuestro modal propio de
     cancelación.

   Requiere activar una vez el Customer Portal en el dashboard:
   Stripe → Settings → Billing → Customer portal → Save.
   ============================================================ */
const Stripe = require('stripe');
const { getUserFromToken } = require('../lib/supabaseAdmin');

let _stripe = null;
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) _stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host && !host.includes('localhost')) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://rickypicks.com.mx';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

  try {
    const stripe = getStripe();
    if (!stripe) return res.status(200).json({ fallback: true });
    // customer de Stripe por email; preferir el que tenga suscripciones
    const customers = await stripe.customers.list({ email: user.email, limit: 10 });
    let customerId = null;
    for (const c of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 5 });
      if (subs.data.length) { customerId = c.id; break; }
    }
    if (!customerId && customers.data.length) customerId = customers.data[0].id;
    if (!customerId) return res.status(200).json({ fallback: true });

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl(req)}/mlb.html`,
    });
    return res.status(200).json({ url: portal.url });
  } catch (e) {
    // Portal sin configurar en el dashboard u otro error: no bloquear
    // al cliente — que al menos pueda cancelar con nuestro modal.
    console.error('billing-portal:', e && e.message);
    return res.status(200).json({ fallback: true });
  }
};
