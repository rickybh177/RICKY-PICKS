/* GET /api/stripe-capture?session_id=XXX&user_id=XXX&plan=XXX
   Verifica la sesión de Stripe y otorga el plan al usuario. */
const Stripe = require('stripe');
const { grantEntitlement } = require('../lib/supabaseAdmin');
const { cancelOtherRecurring, cancelCoveredRecurring } = require('../lib/cancel-recurring');
const { FULL_PASS_PLANS } = require('../lib/plans');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id requerido.' });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Pago no completado.' });
    }

    const userId = session.metadata && session.metadata.user_id;
    const plan   = session.metadata && session.metadata.plan;
    if (!userId || !plan) return res.status(400).json({ error: 'Metadatos inválidos.' });

    await grantEntitlement(userId, plan);
    const email = (session.customer_details && session.customer_details.email) || session.customer_email;
    /* Upgrade al Combo Total: cancelar la suscripción anterior
       (combo legado o mensual individual) para no cobrar doble. */
    if (plan === 'combo_total') {
      await cancelOtherRecurring(userId, email, 'combo_total');
    }
    /* Pase completo comprado: cualquier mensualidad que cubra se
       cancela sola (upgrade mensual → pase por $199). */
    if (FULL_PASS_PLANS.includes(plan)) {
      await cancelCoveredRecurring(userId, email, plan);
    }
    return res.status(200).json({ ok: true, plan });
  } catch (e) {
    console.error('stripe-capture:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
