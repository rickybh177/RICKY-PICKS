/* ============================================================
   POST /api/cancel-subscription   (requiere sesión)
   Cancelación self-service de la suscripción Mensual Fundador.

   Busca las suscripciones del usuario en AMBAS pasarelas:
   - Stripe: clientes por email → suscripciones activas cuyo
     metadata sea de este usuario/planes mlb_* → se cancelan al
     FINAL del periodo pagado (cancel_at_period_end), así el
     cliente conserva lo que ya pagó y no hay reembolsos raros.
   - Mercado Pago: preapprovals por external_reference
     (userId:mlb_fundador) → status 'cancelled' (MP no cobra más;
     el entitlement vigente expira solo a sus 30 días).

   Responde cuántas se cancelaron. Si no encuentra ninguna, lo
   dice claro (p. ej. compró un plan de pago único, no recurrente).
   ============================================================ */
const Stripe = require('stripe');
const { getUserFromToken } = require('../lib/supabaseAdmin');

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
        const subs = await stripe.subscriptions.list({ customer: c.id, status: 'active', limit: 10 });
        for (const s of subs.data) {
          const meta = s.metadata || {};
          const isOurs = meta.user_id === user.id || String(meta.plan || '').startsWith('mlb_');
          if (isOurs && !s.cancel_at_period_end) {
            await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
            cancelled++;
            const until = s.current_period_end ? new Date(s.current_period_end * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : null;
            notes.push(until ? `Conservas tu acceso hasta el ${until}.` : 'Conservas tu acceso hasta el final del periodo pagado.');
            console.log('cancel-subscription: stripe', user.id, s.id);
          } else if (isOurs && s.cancel_at_period_end) {
            notes.push('Tu suscripción con tarjeta ya estaba programada para cancelarse.');
          }
        }
      }
    }
  } catch (e) { console.error('cancel-subscription stripe:', e); }

  /* ---- Mercado Pago ---- */
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (token) {
      const q = encodeURIComponent(`${user.id}:mlb_fundador`);
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?external_reference=${q}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        for (const p of (data.results || [])) {
          if (p.status === 'authorized' || p.status === 'pending') {
            const upd = await fetch(`https://api.mercadopago.com/preapproval/${p.id}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' }),
            });
            if (upd.ok) {
              cancelled++;
              notes.push('Conservas tu acceso hasta el final del periodo ya pagado.');
              console.log('cancel-subscription: mercadopago', user.id, p.id);
            }
          }
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
