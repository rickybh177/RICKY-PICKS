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
          /* OJO (18-ago-2026): el search de MP puede IGNORAR el filtro
             external_reference y devolver preapprovals de OTROS
             usuarios. Verificación exacta obligatoria antes de tocar. */
          if (p.external_reference !== `${userId}:${planId}`) continue;
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

/* ============================================================
   Cancela las mensualidades CUBIERTAS por un pase completo recién
   comprado (upgrade mensual → pase por $199, 18-ago-2026).

   "Cubierta" = todos los productos del plan mensual están incluidos
   en el pase que acaba de pagar. Ejemplos:
   - compra mlb_temporada → se cancela mlb_fundador; mx_fundador NO
     (el cliente seguiría queriendo su Liga MX mensual).
   - compra combo_2026 → se cancelan TODAS las mensualidades (el
     combo cubre los tres modelos).
   La cancelación es INMEDIATA (no al fin del periodo): el pase ya
   le da más de lo que el mes pagado le daba, y así "ya no se te
   cobra nada" es literal desde el momento del upgrade.
   Best-effort, igual que cancelOtherRecurring.
   ============================================================ */
function productsOfPlan(planId) {
  const p = PLANS[planId];
  if (p && Array.isArray(p.products)) return p.products;
  return [String(planId).split('_')[0]];
}

function coveredBy(boughtPlan, monthlyPlan) {
  const bought = productsOfPlan(boughtPlan);
  return productsOfPlan(monthlyPlan).every(prod => bought.includes(prod));
}

async function cancelCoveredRecurring(userId, userEmail, boughtPlan) {
  const summary = { stripe: 0, mercadopago: 0 };

  /* ---- Stripe ---- */
  try {
    if (process.env.STRIPE_SECRET_KEY && userEmail) {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const customers = await stripe.customers.list({ email: userEmail, limit: 10 });
      for (const c of customers.data) {
        const subs = await stripe.subscriptions.list({ customer: c.id, status: 'active', limit: 10 });
        for (const s of subs.data) {
          const meta = s.metadata || {};
          if (meta.user_id === userId && meta.plan && isSubscription(meta.plan) && coveredBy(boughtPlan, meta.plan)) {
            await stripe.subscriptions.cancel(s.id);
            summary.stripe++;
            console.log('cancel-covered: stripe', userId, meta.plan, s.id, '(cubierto por', boughtPlan + ')');
          }
        }
      }
    }
  } catch (e) { console.error('cancel-covered stripe:', e); }

  /* ---- Mercado Pago ---- */
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (token) {
      const cubiertos = Object.keys(PLANS).filter(p => isSubscription(p) && coveredBy(boughtPlan, p));
      for (const planId of cubiertos) {
        const q = encodeURIComponent(`${userId}:${planId}`);
        const r = await fetch(`https://api.mercadopago.com/preapproval/search?external_reference=${q}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!r.ok) continue;
        const data = await r.json();
        for (const p of (data.results || [])) {
          /* OJO (18-ago-2026): el search de MP puede IGNORAR el filtro
             external_reference y devolver preapprovals de OTROS
             usuarios — así se cancelaron 4 zombis ajenos en una prueba.
             Verificación exacta obligatoria antes de tocar. */
          if (p.external_reference !== `${userId}:${planId}`) continue;
          if (p.status === 'authorized' || p.status === 'pending') {
            const upd = await fetch(`https://api.mercadopago.com/preapproval/${p.id}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' }),
            });
            if (upd.ok) {
              summary.mercadopago++;
              console.log('cancel-covered: mercadopago', userId, planId, p.id, '(cubierto por', boughtPlan + ')');
            }
          }
        }
      }
    }
  } catch (e) { console.error('cancel-covered mp:', e); }

  return summary;
}

module.exports = { cancelOtherRecurring, cancelCoveredRecurring };
