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
const { getUserFromToken, getEntitlements } = require('../lib/supabaseAdmin');
const { accesoHasta, marcaCancelada, cancelacionVigente, fechaMX } = require('../lib/cancelaciones');
const { suscripcionesVivas } = require('../lib/suscripciones');

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
  /* El plan y el precio que pagaba: la oferta de regreso le respeta su
     precio de antes (ver lib/retencion). */
  let pagaba = null;

  /* Las encuentra lib/suscripciones — la misma búsqueda que usa la
     oferta de retención, con el arreglo del buscador de Mercado Pago. */
  const vivas = await suscripcionesVivas(user);
  const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
  for (const s of vivas) {
    try {
      if (s.via === 'stripe' && stripe) {
        if (s.status === 'active' || s.status === 'trialing') {
          /* Pagó el periodo en curso: se cancela AL FINAL, así conserva
             lo que ya pagó y no hay reembolsos raros. */
          if (s.cancelAlFinal) { notes.push('Tu suscripción con tarjeta ya estaba programada para cancelarse.'); continue; }
          await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
        } else {
          /* Pago fallido (past_due / unpaid / incomplete): NO hay periodo
             pagado que conservar. Si se programara para el final, Stripe
             seguiría reintentando el cobro fallido hasta entonces — justo
             lo que el cliente quiere parar. Se cancela ya. */
          await stripe.subscriptions.cancel(s.id);
          notes.push('No se te volverá a intentar cobrar.');
        }
      } else if (s.via === 'mp') {
        const upd = await fetch(`https://api.mercadopago.com/preapproval/${s.id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        });
        if (!upd.ok) { console.error('cancel-subscription mp: PUT', s.id, upd.status); continue; }
      } else continue;
      cancelled++;
      if (!pagaba && s.plan && s.monto != null) pagaba = { plan: s.plan, precio: s.monto, moneda: s.moneda };
      console.log('cancel-subscription:', s.via, s.status, user.id, s.plan, s.id);
    } catch (e) { console.error('cancel-subscription', s.via, s.id, e.message); }
  }

  /* La fecha que se le dice al cliente sale de sus accesos, no de la
     pasarela: es cuando de verdad se le apagan los modelos. */
  const ents = await getEntitlements(user.id, user.email).catch(() => []);
  const hasta = accesoHasta(ents);
  const hastaTxt = hasta && Date.parse(hasta) > Date.now() ? `Conservas tu acceso hasta el ${fechaMX(hasta)}.` : null;

  if (cancelled > 0) {
    /* Se guarda para que Mis modelos lo recuerde al recargar: sin esto el
       aviso salía una sola vez y el botón de cancelar volvía a aparecer. */
    await marcaCancelada(user.id, { hasta, via: 'boton', ...(pagaba || {}) }).catch(e => console.error('cancel-subscription kv:', e.message));
    return res.status(200).json({
      ok: true, cancelled, hasta,
      message: 'Listo: cancelaste tu suscripción y no se te volverá a cobrar. ' + (hastaTxt || notes[0] || ''),
    });
  }

  /* Ya la había cancelado (él mismo o el dueño desde el panel): decirle
     eso, con su fecha, en vez de "no encontramos una suscripción". */
  const previa = await cancelacionVigente(user.id, ents).catch(() => null);
  if (previa) {
    return res.status(200).json({
      ok: true, cancelled: 0, hasta: previa.hasta,
      message: 'Tu suscripción ya está cancelada: no se te volverá a cobrar.' +
        (previa.hasta ? ` Conservas tu acceso hasta el ${fechaMX(previa.hasta)}.` : ''),
    });
  }
  return res.status(200).json({
    ok: false, cancelled: 0,
    message: 'No encontramos una suscripción activa en esta cuenta. Si compraste un pase o acceso de pago único, no se renueva solo — no hay nada que cancelar.',
  });
};
