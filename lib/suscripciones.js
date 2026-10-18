/* ============================================================
   Las suscripciones VIVAS de un usuario, en las dos pasarelas.

   Vive aquí y no dentro de cada endpoint porque cancelar y la oferta de
   retención tienen que encontrar EXACTAMENTE lo mismo. La búsqueda de
   Mercado Pago ya estuvo rota una vez por armarse a mano en un solo
   lugar (17-oct-2026, ver abajo): no se repite.

   Devuelve filas normalizadas:
     { via: 'stripe' | 'mp', id, status, plan, monto, moneda,
       cancelAlFinal, finPeriodo }
   ============================================================ */
const Stripe = require('stripe');
const { isSubscription } = require('./plans');

/* Estados de Stripe en los que una suscripción todavía puede cobrar. */
const PUEDE_COBRAR_STRIPE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);
/* …y los de Mercado Pago. `paused` también: puede reanudarse y cobrar. */
const PUEDE_COBRAR_MP = ['authorized', 'pending', 'paused'];

async function stripeVivas(user) {
  if (!process.env.STRIPE_SECRET_KEY || !user.email) return [];
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const out = [];
  const customers = await stripe.customers.list({ email: user.email, limit: 10 });
  for (const c of customers.data) {
    /* TODAS las que todavía pueden cobrar, no solo las `active`: un pago
       fallido (past_due) también le sigue intentando cobrar. */
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 });
    for (const s of subs.data) {
      if (!PUEDE_COBRAR_STRIPE.has(s.status)) continue;
      const meta = s.metadata || {};
      if (!(meta.user_id === user.id || String(meta.plan || '').startsWith('mlb_'))) continue;
      const item = s.items && s.items.data && s.items.data[0];
      const price = item && item.price;
      out.push({
        via: 'stripe', id: s.id, status: s.status, plan: meta.plan || null,
        monto: price && price.unit_amount != null ? price.unit_amount / 100 : null,
        moneda: price && price.currency ? price.currency.toUpperCase() : null,
        cancelAlFinal: !!s.cancel_at_period_end,
        finPeriodo: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      });
    }
  }
  return out;
}

/* El buscador de MP IGNORA el filtro `external_reference` (medido el
   17-oct-2026: pedir la suscripción de un cliente devolvía las 10
   primeras de las 28 de la cuenta, y ninguna era la suya). Lo que sí
   respeta es `status` y la paginación: se piden todas las que pueden
   cobrar, página por página, y la coincidencia exacta con este cliente
   se hace aquí. El external_reference es `userId:planId`, así que el
   prefijo `userId:` agarra todos sus planes recurrentes de una vez. */
async function mpVivas(user) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return [];
  const out = [];
  const mio = p => typeof p.external_reference === 'string'
    && p.external_reference.startsWith(`${user.id}:`)
    && isSubscription(p.external_reference.slice(user.id.length + 1));
  for (const status of PUEDE_COBRAR_MP) {
    for (let offset = 0; offset < 2000; offset += 100) {
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=${status}&limit=100&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      const page = data.results || [];
      for (const p of page) {
        if (!mio(p) || p.status !== status) continue;
        const ar = p.auto_recurring || {};
        out.push({
          via: 'mp', id: p.id, status: p.status, plan: p.external_reference.slice(user.id.length + 1),
          monto: ar.transaction_amount != null ? Number(ar.transaction_amount) : null,
          moneda: ar.currency_id || 'MXN',
          cancelAlFinal: false, finPeriodo: p.next_payment_date || null,
        });
      }
      if (page.length < 100) break;
    }
  }
  return out;
}

/* Las dos pasarelas. Si una falla, se regresa lo de la otra y se avisa
   en los logs: no se debe quedar un cliente sin poder cancelar porque
   Stripe tardó en contestar. */
async function suscripcionesVivas(user) {
  const [s, m] = await Promise.all([
    stripeVivas(user).catch(e => { console.error('suscripciones stripe:', e.message); return []; }),
    mpVivas(user).catch(e => { console.error('suscripciones mp:', e.message); return []; }),
  ]);
  return s.concat(m);
}

module.exports = { suscripcionesVivas, PUEDE_COBRAR_STRIPE, PUEDE_COBRAR_MP };
