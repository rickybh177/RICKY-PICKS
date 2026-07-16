/* ============================================================
   POST /api/stripe-webhook
   Renovaciones de la suscripción Mensual Fundador (MLB).

   Cada mes, cuando Stripe cobra la renovación, manda invoice.paid;
   aquí se re-otorga el entitlement (updated_at = ahora), lo que
   extiende el acceso otros 30 días. Sin este webhook el cliente
   pagaría la renovación pero su acceso vencería.

   Verificación SIN raw body (Vercel ya parseó el JSON, así que la
   firma de Stripe no se puede validar): tomamos solo el event.id
   del payload y RE-CONSULTAMOS el evento a la API de Stripe con
   nuestra secret key. Solo procesamos lo que Stripe confirme —
   un payload falsificado no puede otorgar nada.

   Configurar en Stripe → Developers → Webhooks:
     URL:     https://rickypicks.com.mx/api/stripe-webhook
     Eventos: invoice.paid, checkout.session.completed
   ============================================================ */
const Stripe = require('stripe');
const { grantEntitlement } = require('../lib/supabaseAdmin');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const eventId = body && body.id;
  if (!eventId || !/^evt_/.test(String(eventId))) return res.status(400).json({ error: 'Evento inválido.' });

  let event;
  try {
    event = await stripe.events.retrieve(eventId); // fuente de verdad: Stripe
  } catch (e) {
    console.error('stripe-webhook: evento no verificable', eventId);
    return res.status(400).json({ error: 'Evento no verificable.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      // Respaldo del alta inicial (por si el cliente no regresa al sitio
      // y stripe-capture nunca corre).
      const s = event.data.object;
      const meta = s.metadata || {};
      if (meta.user_id && meta.plan && (s.payment_status === 'paid' || s.status === 'complete')) {
        await grantEntitlement(meta.user_id, meta.plan);
        console.log('stripe-webhook: alta inicial', meta.user_id, meta.plan);
      }
    } else if (event.type === 'invoice.paid') {
      // Renovación mensual: la metadata vive en la suscripción.
      const inv = event.data.object;
      const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription && inv.subscription.id;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const meta = sub.metadata || {};
        if (meta.user_id && meta.plan) {
          await grantEntitlement(meta.user_id, meta.plan);
          console.log('stripe-webhook: renovación', meta.user_id, meta.plan, inv.id);
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('stripe-webhook:', e);
    return res.status(500).json({ error: 'Error interno.' });
  }
};
