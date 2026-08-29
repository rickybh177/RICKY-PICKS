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
const { cancelOtherRecurring, cancelCoveredRecurring } = require('../lib/cancel-recurring');
const { FULL_PASS_PLANS, isSubscription } = require('../lib/plans');

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
        const email = (s.customer_details && s.customer_details.email) || s.customer_email;
        if (meta.plan === 'combo_total') {
          await cancelOtherRecurring(meta.user_id, email, 'combo_total');
        }
        /* Pase completo: las mensualidades que cubre se cancelan solas. */
        if (FULL_PASS_PLANS.includes(meta.plan)) {
          await cancelCoveredRecurring(meta.user_id, email, meta.plan);
        }
        /* Mensual nuevo: las mensualidades anteriores cubiertas se
           cancelan, conservando la recién creada (ver stripe-capture). */
        if (isSubscription(meta.plan)) {
          const nueva = typeof s.subscription === 'string' ? s.subscription
            : (s.subscription && s.subscription.id) || null;
          await cancelCoveredRecurring(meta.user_id, email, meta.plan, { stripeSubId: nueva });
        }
      }
    } else if (event.type === 'invoice.paid') {
      // Renovación mensual: la metadata vive en la suscripción.
      const inv = event.data.object;
      /* El id de la suscripción cambió de lugar según la versión del API:
         hasta 2025 venía en inv.subscription; desde 2026 (p.ej.
         2026-05-27.dahlia) vive en inv.parent.subscription_details y en
         cada línea. Se buscan TODAS las rutas — si ninguna existe y la
         factura es de suscripción, se responde 500 para que Stripe
         reintente en vez de perder la renovación en silencio (eso dejó
         sin acceso a un cliente que sí pagó el 17-ago-2026). */
      const line = inv.lines && inv.lines.data && inv.lines.data[0];
      const candidates = [
        inv.subscription,
        inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription,
        line && line.subscription,
        line && line.parent && line.parent.subscription_item_details && line.parent.subscription_item_details.subscription,
      ];
      let subId = null;
      for (const c of candidates) {
        if (typeof c === 'string' && /^sub_/.test(c)) { subId = c; break; }
        if (c && typeof c === 'object' && c.id) { subId = c.id; break; }
      }
      if (!subId && inv.billing_reason && inv.billing_reason.startsWith('subscription')) {
        console.error('stripe-webhook: factura de suscripción SIN subId', inv.id, 'api:', event.api_version);
        return res.status(500).json({ error: 'No se encontró la suscripción en la factura.' });
      }
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
