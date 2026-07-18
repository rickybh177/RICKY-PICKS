/* ============================================================
   POST /api/create-payment  { plan }   (requiere sesión)
   Crea una preferencia de pago en Mercado Pago y devuelve la URL
   del checkout. El precio se toma del servidor, nunca del cliente.
   El acceso se concede en /api/mp-webhook cuando el pago se aprueba.
   ============================================================ */
const { PLANS } = require('../lib/plans');
const { getUserFromToken } = require('../lib/supabaseAdmin');
const { DISCOUNTS } = require('../lib/discounts');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function siteUrl(req) {
  const env = process.env.SITE_URL || process.env.PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'El cobro no está configurado todavía.' });
  }

  // Requiere sesión: el acceso se asocia a la cuenta del comprador.
  const user = await getUserFromToken(bearer(req));
  if (!user) {
    return res.status(401).json({ error: 'Inicia sesión para comprar.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const planId = body && body.plan;
  const plan = PLANS[planId];
  if (!plan) {
    return res.status(400).json({ error: 'Plan no válido.' });
  }
  const discountCode = ((body && body.discount_code) || '').toString().trim().toUpperCase();
  const discount = discountCode && DISCOUNTS[discountCode] && DISCOUNTS[discountCode].plan === planId ? DISCOUNTS[discountCode] : null;
  const finalPrice = discount ? Math.round(plan.price * (1 - discount.pct / 100)) : plan.price;
  const finalTitle = discount ? `RICKY·PICKS — ${plan.title} (${discount.pct}% descuento)` : `RICKY·PICKS — ${plan.title}`;

  const base = siteUrl(req);

  /* ---- Mensuales (MLB, Liga MX, Combo): SUSCRIPCIÓN de Mercado
     Pago (preapproval). Cargo automático cada mes; el alta y las
     renovaciones llegan a /api/mp-webhook como eventos de
     suscripción. Nota: MP cobra el mismo monto todos los meses, así
     que el crédito del Pase del día solo aplica con tarjeta (Stripe). */
  const SUBSCRIPTION_PLANS = ['mlb_fundador', 'mx_fundador', 'combo_fundador'];
  if (SUBSCRIPTION_PLANS.includes(planId)) {
    const subDest = planId === 'mlb_fundador' ? 'mlb.html' : 'mx.html';
    try {
      const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: `RICKY·PICKS — ${plan.title}`,
          external_reference: `${user.id}:${plan.id}`,
          payer_email: user.email,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: plan.price,
            currency_id: plan.currency,
          },
          back_url: `${base}/${subDest}?pago=ok`,
          status: 'pending',
        }),
      });
      const data = await mpRes.json();
      if (!mpRes.ok || !data.init_point) {
        console.error('Mercado Pago preapproval error:', data);
        return res.status(502).json({ error: 'No se pudo abrir la suscripción. Intenta con tarjeta.' });
      }
      return res.status(200).json({ checkout_url: data.init_point });
    } catch (e) {
      console.error('create-payment preapproval:', e);
      return res.status(502).json({ error: 'No se pudo conectar con el servidor de pagos. Intenta de nuevo.' });
    }
  }
  // Al volver del pago, cada producto regresa a SU modelo:
  // mlb_* -> /mlb.html, mx_*/combo_* -> /mx.html, Mundial -> /mis-modelos.html
  const dest = plan.id.startsWith('mlb_') ? 'mlb.html'
    : (plan.id.startsWith('mx_') || plan.id.startsWith('combo_')) ? 'mx.html'
    : 'mis-modelos.html';
  const preference = {
    items: [{
      id: plan.id,
      title: finalTitle,
      quantity: 1,
      unit_price: finalPrice,
      currency_id: plan.currency,
    }],
    payer: { email: user.email },
    // user_id:plan -> el webhook lo lee para otorgar el acceso correcto.
    external_reference: `${user.id}:${plan.id}`,
    metadata: { user_id: user.id, plan: plan.id },
    back_urls: {
      success: `${base}/${dest}?pago=ok`,
      pending: `${base}/${dest}?pago=pendiente`,
      failure: `${base}/checkout.html?plan=${plan.id}&pago=error`,
    },
    // auto_return solo funciona con URLs HTTPS públicas (no localhost)
    ...(base.startsWith('https://') ? { auto_return: 'approved' } : {}),
    notification_url: `${base}/api/mp-webhook`,
    statement_descriptor: 'RICKYPICKS',
  };

  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preference),
    });
    const data = await mpRes.json();
    if (!mpRes.ok) {
      console.error('Mercado Pago error:', data);
      return res.status(502).json({ error: 'No se pudo abrir el pago. Intenta de nuevo.' });
    }
    const checkout_url = data.init_point || data.sandbox_init_point;
    if (!checkout_url) {
      return res.status(502).json({ error: 'No se pudo abrir el pago. Intenta de nuevo.' });
    }
    return res.status(200).json({ checkout_url });
  } catch (e) {
    console.error('create-payment:', e);
    return res.status(502).json({ error: 'No se pudo conectar con el servidor de pagos. Intenta de nuevo.' });
  }
};
