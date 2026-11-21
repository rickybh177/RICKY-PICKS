/* ============================================================
   POST /api/upgrade-cinco   (requiere sesión)
   { accion: 'ver' }                → si puede subir y cuánto pagaría
   { accion: 'subir', add: [a, b] } → sube su plan de tres a cinco

   De "Tres modelos a elegir" a "Cinco modelos a elegir" (20-nov-2026)
   SIN perder lo que ya eligió: conserva sus tres, agrega dos y la
   MISMA suscripción de Stripe pasa al precio de cinco. Stripe cobra
   hoy solo la diferencia por los días que le quedan del mes
   (proration 'always_invoice') y en la renovación cobra el precio
   completo de cinco. Si ese cobro de hoy no pasa, no se cambia nada
   (payment_behavior 'error_if_incomplete' → Stripe responde 402).

   Mercado Pago no puede cambiar una suscripción así (su referencia
   lleva el plan dentro): a esos clientes se les manda al checkout del
   de cinco con sus tres preseleccionados, y al pagar el de tres se
   cancela solo (coveredBy en lib/cancel-recurring.js).

   Las filas nuevas copian el periodo de las de tres para que venzan
   con lo que Stripe ya cobró (no se regalan días); por eso
   api/stripe-webhook no vuelve a otorgar con la factura de este cambio
   (billing_reason 'subscription_update').
   ============================================================ */
const Stripe = require('stripe');
const { getUserFromToken, getAdmin } = require('../lib/supabaseAdmin');
const { suscripcionesVivas } = require('../lib/suscripciones');
const { PLANS, ALL_MODELS, validChoice, montoDe, coverageBeats, entitlementExpiry } = require('../lib/plans');
const { saveChoice } = require('../lib/choices');

const DE = 'tres_mensual', A = 'cinco_mensual';
const NOMBRE = { mlb: 'MLB', mx: 'Liga MX', nfl: 'NFL', epl: 'Premier League', laliga: 'LaLiga', bundesliga: 'Bundesliga', ucl: 'Champions League', nba: 'NBA', seriea: 'Serie A', ligue1: 'Ligue 1', mls: 'MLS', uel: 'Europa League', uecl: 'Conference League', nhl: 'NHL' };

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
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

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const accion = (body && body.accion) || 'ver';

  try {
    const admin = getAdmin();
    const { data, error } = await admin
      .from('entitlements')
      .select('plan, product, active, updated_at')
      .eq('user_id', user.id)
      .eq('active', true);
    if (error) throw error;
    const rows = data || [];
    const mine = rows.filter(r => r.plan === DE);
    const now = Date.now();
    if (!mine.length || entitlementExpiry(DE, mine[0].updated_at) < now) {
      return res.status(400).json({ error: 'Esto es para quien tiene el plan de tres modelos vigente.' });
    }
    const tres = mine.map(r => r.product);

    /* su suscripción de tres que está pagando */
    const vivas = await suscripcionesVivas(user);
    const deTres = vivas.filter(s => s.plan === DE && !s.cancelAlFinal);
    const stripeSub = deTres.find(s => s.via === 'stripe' && (s.status === 'active' || s.status === 'trialing'));
    if (!stripeSub) {
      if (deTres.some(s => s.via === 'mp')) {
        return res.status(200).json({ ok: true, via: 'mp', checkout: `/checkout.html?plan=${A}&modelos=${tres.join(',')}` });
      }
      return res.status(400).json({ error: 'No encontramos una suscripción de tres modelos activa. Si la cancelaste, puedes contratar el de cinco desde los planes.' });
    }
    const moneda = stripeSub.moneda === 'USD' ? 'USD' : 'MXN';
    const nuevo = montoDe(A, moneda);
    if (nuevo == null) return res.status(400).json({ error: 'Ese plan no está disponible en tu moneda.' });

    if (accion === 'ver') {
      return res.status(200).json({ ok: true, via: 'stripe', moneda, actual: stripeSub.monto, nuevo, products: tres.sort() });
    }
    if (accion !== 'subir') return res.status(400).json({ error: 'Acción no válida.' });

    const add = Array.isArray(body && body.add) ? body.add.map(x => String(x || '').toLowerCase()) : [];
    if (add.length !== 2 || add.some(x => !ALL_MODELS.includes(x) || tres.includes(x)) || add[0] === add[1]) {
      return res.status(400).json({ error: 'Elige dos modelos que no tengas.' });
    }
    const products = validChoice(A, tres.concat(add));
    if (!products) return res.status(400).json({ error: 'Alguno de esos modelos no se puede elegir ahora.' });

    /* 1) Stripe: misma suscripción, precio de cinco, diferencia hoy */
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const sub = await stripe.subscriptions.retrieve(stripeSub.id);
    const item = sub.items && sub.items.data && sub.items.data[0];
    if (!item) throw new Error('suscripción sin partidas: ' + sub.id);
    const prod = await stripe.products.create({ name: `${PLANS[A].title} (${products.map(m => NOMBRE[m] || m).join(', ')})` });
    try {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price_data: { currency: moneda.toLowerCase(), product: prod.id, unit_amount: Math.round(nuevo * 100), recurring: { interval: 'month' } } }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        metadata: { ...(sub.metadata || {}), plan: A, models: products.join(','), subio_de: DE, subio_at: new Date().toISOString() },
      });
    } catch (e) {
      console.error('upgrade-cinco: Stripe rechazó', user.id, e.code || '', e.message);
      return res.status(402).json({ error: 'Tu banco no aprobó el cobro de la diferencia. Revisa tu tarjeta e intenta de nuevo; tu plan de tres sigue igual.' });
    }

    /* 2) acceso: cinco filas con el mismo periodo que ya pagó */
    const updatedAt = new Date(Math.max(...mine.map(r => Date.parse(r.updated_at) || 0))).toISOString();
    for (const product of products) {
      const other = rows.find(r => r.product === product && r.plan !== DE);
      if (other && coverageBeats(other, A, now)) continue;   // un pase que dura más no se pisa
      const up = await admin.from('entitlements').upsert(
        { user_id: user.id, plan: A, product, active: true, updated_at: updatedAt },
        { onConflict: 'user_id,product' }
      );
      if (up.error) throw up.error;
    }
    try { await saveChoice(user.id, A, products); } catch (e) { console.error('upgrade-cinco: elección no respaldada', e.message); }
    console.log(`upgrade-cinco: ${user.id} ${tres.join(',')} → ${products.join(',')} (${sub.id}, ${moneda} ${nuevo})`);
    return res.status(200).json({ ok: true, products, message: `Listo: ya tienes cinco modelos. ${add.map(m => NOMBRE[m]).join(' y ')} entran desde hoy.` });
  } catch (e) {
    console.error('upgrade-cinco:', e);
    return res.status(500).json({ error: 'No se pudo subir tu plan. Intenta de nuevo.' });
  }
};
