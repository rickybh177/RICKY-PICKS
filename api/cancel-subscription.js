/* ============================================================
   POST /api/cancel-subscription   (requiere sesión)
   Cancelación self-service de la suscripción Mensual Fundador.

   Busca las suscripciones del usuario en AMBAS pasarelas:
   - Stripe: clientes por email → suscripciones activas cuyo
     metadata sea de este usuario → se cancelan al
     FINAL del periodo pagado (cancel_at_period_end), así el
     cliente conserva lo que ya pagó y no hay reembolsos raros.
   - Mercado Pago: preapprovals por external_reference
     (userId:planId, TODOS los planes recurrentes) → status
     'cancelled' (MP no cobra más;
     el entitlement vigente expira solo a sus 30 días).

   Responde cuántas se cancelaron. Si no encuentra ninguna, lo
   dice claro (p. ej. compró un plan de pago único, no recurrente).
   ============================================================ */
const Stripe = require('stripe');
const { getUserFromToken } = require('../lib/supabaseAdmin');
const { PLANS, isSubscription } = require('../lib/plans');

/* Estados de Stripe en los que una suscripción todavía puede cobrar. */
const PUEDE_COBRAR = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

  let cancelled = 0;
  const notes = [];

  /* ---- Stripe ---- */
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const customers = await stripe.customers.list({ email: user.email, limit: 10 });
      for (const c of customers.data) {
        /* TODAS las que todavía pueden cobrar, no solo las `active`
           (17-oct-2026). Antes un cliente con el pago fallido (past_due)
           no aparecía: el botón le decía "no encontramos una suscripción"
           mientras Stripe le seguía reintentando el cobro. */
        const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 });
        for (const s of subs.data) {
          if (!PUEDE_COBRAR.has(s.status)) continue;
          const meta = s.metadata || {};
          const isOurs = meta.user_id === user.id || String(meta.plan || '').startsWith('mlb_');
          if (!isOurs) continue;
          if (s.status === 'active' || s.status === 'trialing') {
            /* Pagó el periodo en curso: se cancela AL FINAL, así conserva
               lo que ya pagó y no hay reembolsos raros. */
            if (s.cancel_at_period_end) { notes.push('Tu suscripción con tarjeta ya estaba programada para cancelarse.'); continue; }
            await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
            cancelled++;
            const until = s.current_period_end ? new Date(s.current_period_end * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : null;
            notes.push(until ? `Conservas tu acceso hasta el ${until}.` : 'Conservas tu acceso hasta el final del periodo pagado.');
          } else {
            /* Pago fallido (past_due / unpaid / incomplete): NO hay periodo
               pagado que conservar. Si se programara para el final del
               periodo, Stripe seguiría reintentando el cobro fallido hasta
               entonces — justo lo que el cliente quiere parar. Se cancela
               ya. */
            await stripe.subscriptions.cancel(s.id);
            cancelled++;
            notes.push('No se te volverá a intentar cobrar.');
          }
          console.log('cancel-subscription: stripe', s.status, user.id, s.id);
        }
      }
    }
  } catch (e) { console.error('cancel-subscription stripe:', e); }

  /* ---- Mercado Pago ----
     El buscador de MP IGNORA el filtro `external_reference` (medido el
     17-oct-2026: pedir la suscripción de un cliente devolvía las 10
     primeras de las 28 de la cuenta, y ninguna era la suya). El código
     ya descartaba las ajenas —bien—, pero entonces no encontraba la del
     cliente y le decía "no encontramos una suscripción": NINGÚN
     suscriptor de Mercado Pago podía cancelar.

     Lo que MP sí respeta es el filtro por `status` y la paginación. Así
     que se piden TODAS las que todavía pueden cobrar, página por página,
     y la coincidencia exacta con este cliente se hace aquí. El
     external_reference es `userId:planId`, así que el prefijo
     `userId:` agarra todos sus planes recurrentes de una vez. */
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (token) {
      const mio = p => typeof p.external_reference === 'string'
        && p.external_reference.startsWith(`${user.id}:`)
        && isSubscription(p.external_reference.slice(user.id.length + 1));
      for (const status of ['authorized', 'pending', 'paused']) {
        for (let offset = 0; offset < 2000; offset += 100) {
          const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=${status}&limit=100&offset=${offset}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!r.ok) break;
          const data = await r.json();
          const page = data.results || [];
          for (const p of page) {
            if (!mio(p) || p.status !== status) continue;
            const upd = await fetch(`https://api.mercadopago.com/preapproval/${p.id}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' }),
            });
            if (upd.ok) {
              cancelled++;
              notes.push('Conservas tu acceso hasta el final del periodo ya pagado.');
              console.log('cancel-subscription: mercadopago', status, user.id, p.external_reference, p.id);
            } else {
              console.error('cancel-subscription mp: PUT', p.id, upd.status);
            }
          }
          if (page.length < 100) break;
        }
      }
    }
  } catch (e) { console.error('cancel-subscription mp:', e); }

  if (cancelled > 0) {
    return res.status(200).json({
      ok: true, cancelled,
      message: 'Listo: tu suscripción quedó cancelada y no se te volverá a cobrar. ' + (notes[0] || ''),
    });
  }
  return res.status(200).json({
    ok: false, cancelled: 0,
    message: 'No encontramos una suscripción activa en esta cuenta. Si compraste un pase o acceso de pago único, no se renueva solo — no hay nada que cancelar.',
  });
};
