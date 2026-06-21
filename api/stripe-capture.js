/* GET /api/stripe-capture?session_id=XXX&user_id=XXX&plan=XXX
   Verifica la sesión de Stripe y otorga el plan al usuario. */
const Stripe = require('stripe');
const { grantEntitlement } = require('../lib/supabaseAdmin');

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
    return res.status(200).json({ ok: true, plan });
  } catch (e) {
    console.error('stripe-capture:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
