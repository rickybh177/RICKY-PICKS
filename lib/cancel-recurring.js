/* ============================================================
   Cancela las suscripciones recurrentes ANTERIORES de un usuario
   en ambas pasarelas, excepto el plan indicado.

   Se usa al completar el upgrade al Combo Total: si el cliente
   venía pagando el combo legado ($499) o un mensual individual,
   su suscripción vieja se cancela sola para que NUNCA pague doble.
   La cancelación es inmediata en cobros futuros; lo ya pagado no
   se toca (el entitlement lo pisa el plan nuevo de todos modos).

   Best-effort: cualquier error se loguea y no revienta el alta
   del plan nuevo (peor un upgrade fallido que una doble cobranza
   que igual podemos arreglar a mano).
   ============================================================ */
const Stripe = require('stripe');
const { PLANS, isSubscription } = require('./plans');

async function cancelOtherRecurring(userId, userEmail, exceptPlan) {
  const summary = { stripe: 0, mercadopago: 0 };

  /* ---- Stripe: suscripciones activas del usuario con otro plan ---- */
  try {
    if (process.env.STRIPE_SECRET_KEY && userEmail) {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const customers = await stripe.customers.list({ email: userEmail, limit: 10 });
      for (const c of customers.data) {
        const subs = await stripe.subscriptions.list({ customer: c.id, status: 'active', limit: 10 });
        for (const s of subs.data) {
          const meta = s.metadata || {};
          const isOurs = meta.user_id === userId;
          if (isOurs && meta.plan && meta.plan !== exceptPlan && !s.cancel_at_period_end) {
            await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
            summary.stripe++;
            console.log('cancel-recurring: stripe', userId, meta.plan, s.id, '(upgrade a', exceptPlan + ')');
          }
        }
      }
    }
  } catch (e) { console.error('cancel-recurring stripe:', e); }

  /* ---- Mercado Pago: preapprovals de los demás planes recurrentes ---- */
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (token) {
      const otros = Object.keys(PLANS).filter(p => isSubscription(p) && p !== exceptPlan);
      for (const planId of otros) {
        const q = encodeURIComponent(`${userId}:${planId}`);
        const r = await fetch(`https://api.mercadopago.com/preapproval/search?external_reference=${q}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!r.ok) continue;
        const data = await r.json();
        for (const p of (data.results || [])) {
          if (p.status === 'authorized' || p.status === 'pending') {
            const upd = await fetch(`https://api.mercadopago.com/preapproval/${p.id}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' }),
            });
            if (upd.ok) {
              summary.mercadopago++;
              console.log('cancel-recurring: mercadopago', userId, planId, p.id, '(upgrade a', exceptPlan + ')');
            }
          }
        }
      }
    }
  } catch (e) { console.error('cancel-recurring mp:', e); }

  return summary;
}

module.exports = { cancelOtherRecurring };
