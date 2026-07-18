/* POST /api/stripe-create  { plan }
   Crea una sesión de Stripe Checkout y devuelve la URL de pago. */
const Stripe = require('stripe');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { DISCOUNTS } = require('../lib/discounts');
const { paseCreditFor } = require('../lib/pase-credit');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  mexico:        { name: 'RICKY-PICKS — Partido de México',           price: 19900, currency: 'mxn' },
  torneo:        { name: 'RICKY-PICKS — Partidos finales del Mundial', price: 29900, currency: 'mxn' },
  final:         { name: 'RICKY-PICKS — La final: Argentina vs España', price: 9900, currency: 'mxn' },
  mlb_pase:      { name: 'Modelo MLB — Pase del día',                 price: 9900,  currency: 'mxn' },
  mlb_semana:    { name: 'Modelo MLB — Semana de prueba',             price: 14900, currency: 'mxn' },
  mlb_fundador:  { name: 'Modelo MLB — Mensual Fundador',             price: 39900, currency: 'mxn' },
  mlb_temporada: { name: 'Modelo MLB — Temporada 2026 (fundador)',    price: 99900, currency: 'mxn' },
  mx_fundador:    { name: 'Modelo Liga MX — Mensual Fundador',         price: 39900, currency: 'mxn' },
  combo_fundador: { name: 'Combo MLB + Liga MX',                       price: 49900, currency: 'mxn' },
  mx_apertura:    { name: 'Modelo Liga MX — Apertura 2026 completo',   price: 89900, currency: 'mxn' },
};

/* Planes que son suscripción mensual real (cargo recurrente). */
const SUBSCRIPTION_PLANS = ['mlb_fundador', 'mx_fundador', 'combo_fundador'];

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host && !host.includes('localhost')) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://ricky-picks.vercel.app';
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

    const p = PLANS[plan];
    const SITE_URL = siteUrl(req);

    /* ---- Mensuales (MLB, Liga MX, Combo): SUSCRIPCIÓN real ----
       El acceso inicial se otorga en stripe-capture al volver del
       checkout; las RENOVACIONES mensuales las otorga
       api/stripe-webhook (evento invoice.paid). El crédito del Pase
       del día se aplica como cupón de una sola vez en los planes que
       incluyen MLB. */
    if (SUBSCRIPTION_PLANS.includes(plan)) {
      const sessionParams = {
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: p.currency,
            product_data: { name: p.name },
            unit_amount: p.price,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],
        // metadata en la suscripción: el webhook la lee en cada renovación
        subscription_data: { metadata: { user_id: user.id, plan } },
        success_url: `${SITE_URL}/checkout.html?plan=${plan}&via=stripe&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/checkout.html?plan=${plan}`,
        metadata: { user_id: user.id, plan },
        customer_email: user.email,
      };
      const includesMlb = plan === 'mlb_fundador' || plan === 'combo_fundador';
      const ent = includesMlb ? await getEntitlement(user.id, user.email, 'mlb') : null;
      const credit = paseCreditFor(ent); // MXN (99) o 0
      if (credit > 0) {
        const coupon = await stripe.coupons.create({
          amount_off: credit * 100, currency: p.currency,
          duration: 'once', name: 'Crédito Pase del día',
        });
        sessionParams.discounts = [{ coupon: coupon.id }];
      }
      const session = await stripe.checkout.sessions.create(sessionParams);
      return res.status(200).json({ url: session.url });
    }

    /* ---- resto de planes: pago único ---- */
    let finalPrice = discount ? Math.round(p.price * (1 - discount.pct / 100)) : p.price;
    let productName = discount ? `${p.name} (${discount.pct}% descuento)` : p.name;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: p.currency,
          product_data: { name: productName },
          unit_amount: finalPrice,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${SITE_URL}/checkout.html?plan=${plan}&via=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout.html?plan=${plan}`,
      metadata: { user_id: user.id, plan },
      customer_email: user.email,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('stripe-create:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
