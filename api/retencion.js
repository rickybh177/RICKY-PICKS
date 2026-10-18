/* ============================================================
   POST /api/retencion   (requiere sesión)
   { accion: 'ver' }      → la oferta para quedarse, si le toca
   { accion: 'quedarme' } → la aplica a su PRÓXIMO cobro

   Es el camino "quedarse" de lib/retencion: el cliente apretó Cancelar
   y todavía tiene una suscripción que cobra. En vez de cancelar se le
   ofrece su siguiente mes al 50%; después vuelve solo a su precio.

   Solo suscripciones que están PAGANDO (Stripe active/trialing, MP
   authorized). Un pago fallido no recibe oferta: lo que ese cliente
   necesita es poder cancelar, no un descuento sobre un cobro que no
   pasa.
   ============================================================ */
const Stripe = require('stripe');
const { getUserFromToken, getEntitlements } = require('../lib/supabaseAdmin');
const { suscripcionesVivas } = require('../lib/suscripciones');
const { mitad, ofertaDisponible, marcaOfertaUsada, anotaRestauracionMP } = require('../lib/retencion');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
const pesos = (n, m) => m === 'USD' ? '$' + Number(n).toFixed(2) + ' USD' : '$' + Number(n).toLocaleString('en-US') + ' MXN';

/* La que está pagando y vale más (normalmente hay una sola). */
function principal(vivas) {
  return vivas
    .filter(s => s.monto > 0 && (s.via === 'stripe' ? (s.status === 'active' || s.status === 'trialing') : s.status === 'authorized'))
    .sort((a, b) => b.monto - a.monto)[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const accion = body.accion === 'quedarme' ? 'quedarme' : 'ver';

  try {
    const ents = await getEntitlements(user.id, user.email);
    if (!(await ofertaDisponible(user.id, ents))) return res.status(200).json({ oferta: null });

    const s = principal(await suscripcionesVivas(user));
    if (!s) return res.status(200).json({ oferta: null });
    const oferta = { via: s.via, plan: s.plan, moneda: s.moneda, precio: s.monto, precioOferta: mitad(s.monto, s.moneda) };
    if (accion === 'ver') return res.status(200).json({ oferta });

    /* ---- aplicar: 50% SOLO al próximo cobro ---- */
    if (s.via === 'stripe') {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      /* duration 'once': Stripe lo aplica a UN cobro y después cobra
         normal, sin que haya que acordarse de quitarlo. Si ya estaba
         programada para cancelarse, se le quita eso: decidió quedarse. */
      const cupon = await stripe.coupons.create({ percent_off: 50, duration: 'once', name: 'Tu siguiente mes al 50%' });
      await stripe.subscriptions.update(s.id, { discounts: [{ coupon: cupon.id }], cancel_at_period_end: false });
    } else {
      /* Mercado Pago no tiene "un cobro con descuento": se baja el monto y
         api/mp-webhook lo regresa en cuanto entra el cobro al 50%. */
      const r = await fetch(`https://api.mercadopago.com/preapproval/${s.id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: oferta.precioOferta, currency_id: s.moneda || 'MXN' } }),
      });
      if (!r.ok) {
        console.error('retencion: MP no aceptó el monto', s.id, r.status, await r.text().catch(() => ''));
        return res.status(502).json({ error: 'No pudimos aplicar el descuento. Intenta de nuevo.' });
      }
      /* El aviso se anota DESPUÉS de que MP aceptó el monto: si se anotara
         antes y MP fallara, el webhook "regresaría" un precio que nunca
         se bajó. */
      await anotaRestauracionMP(s.id, { completo: s.monto, descuento: oferta.precioOferta, moneda: s.moneda || 'MXN' });
    }
    await marcaOfertaUsada(user.id, { tipo: 'quedarse', ...oferta, suscripcion: s.id });
    console.log('retencion: se queda', user.id, s.via, s.plan, s.monto, '→', oferta.precioOferta);
    return res.status(200).json({
      ok: true, oferta,
      message: `Listo, te quedas. Tu siguiente cobro será de ${pesos(oferta.precioOferta, oferta.moneda)} en vez de ${pesos(oferta.precio, oferta.moneda)}; después vuelve a tu precio normal.`,
    });
  } catch (e) {
    console.error('retencion:', e);
    return res.status(500).json({ error: 'No pudimos aplicar el descuento. Intenta de nuevo.' });
  }
};
