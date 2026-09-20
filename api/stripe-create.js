/* POST /api/stripe-create  { plan }
   Crea una sesión de Stripe Checkout y devuelve la URL de pago. */
const Stripe = require('stripe');
const { getUserFromToken, getEntitlement, getEntitlements, productsForPlan } = require('../lib/supabaseAdmin');
const { discountFor, priceWith, labelWith } = require('../lib/discounts');
const { upgradeCreditFor } = require('../lib/pase-credit');
const { isSubscription, normalizaMoneda, isUpcoming, isChoosePlan, validChoice, PLANS: SERVER_PLANS, comboPermanentDiscount, monthlyUpgradeFor, precioDe, montoDe, productsAlreadyCovered, FULL_PASS_PLANS } = require('../lib/plans');
const { saveChoice } = require('../lib/choices');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* Nombres para el checkout de Stripe. El PRECIO ya no vive aquí: sale
   SIEMPRE de lib/plans.js (única fuente de verdad). Lección del
   18-ago-2026: este archivo tenía un espejo de precios en centavos que
   se desincronizó (mlb_temporada subió a $599 en plans.js y aquí quedó
   en $549) — Stripe cobraba distinto de lo publicado. */
const PLAN_NAMES = {
  mexico:        'DATTIP — Partido de México',
  torneo:        'DATTIP — Partidos finales del Mundial',
  final:         'DATTIP — La final: Argentina vs España',
  mlb_pase:      'Modelo MLB — Pase del día',
  mlb_semana:    'Modelo MLB — Semana de prueba',
  mlb_fundador:  'Modelo MLB — Mensual Fundador',
  mlb_temporada: 'Modelo MLB — Temporada 2026',
  mx_fundador:    'Modelo Liga MX — Mensual Fundador',
  mx_semana:      'Modelo Liga MX — Semana de prueba',
  combo_fundador: 'Combo MLB + Liga MX (legado)',
  combo_total:    'Combo Total — MLB + Liga MX + NFL',
  combo_2026:     'Combo Total — MLB + Liga MX + NFL (pago único)',
  mx_apertura:    'Modelo Liga MX — Apertura 2026 completo',
  nfl_semana:     'Modelo NFL — Semana de prueba',
  nfl_fundador:   'Modelo NFL — Mensual Fundador',
  nfl_temporada:  'Modelo NFL — Temporada 26-27 completa',
  circulo_fundador: 'Círculo Fundador — todo + línea directa',
  /* Pricing por suscripción (28-ago-2026) */
  mlb_mensual:   'Modelo MLB — Suscripción mensual',
  mx_mensual:    'Modelo Liga MX — Suscripción mensual',
  nfl_mensual:   'Modelo NFL — Suscripción mensual',
  combo_mensual: 'Los 3 modelos — Suscripción mensual',
  /* Fútbol europeo, un modelo por liga (cableado; a la venta cuando el dueño quite
     `upcoming` en lib/plans.js) */
  epl_mensual: 'Modelo Premier League — Suscripción mensual',
  laliga_mensual: 'Modelo LaLiga — Suscripción mensual',
  bundesliga_mensual: 'Modelo Bundesliga — Suscripción mensual',
  ucl_mensual: 'Modelo Champions League — Suscripción mensual',
  tres_mensual: 'Tres modelos a elegir — Suscripción mensual',
  todo_mensual: 'Todos los modelos (7) — Suscripción mensual',
  epl_temporada: 'Modelo Premier League — Temporada 2026-27 completa',
  laliga_temporada: 'Modelo LaLiga — Temporada 2026-27 completa',
  bundesliga_temporada: 'Modelo Bundesliga — Temporada 2026-27 completa',
  ucl_temporada: 'Modelo Champions League — Temporada 2026-27 completa',
  /* Paquete de las 4 ligas europeas (solo con código, p. ej. DAYOG).
     Sin nombre aquí el checkout con TARJETA lo rechazaba por "Plan
     inválido" y el cliente solo podía pagar con Mercado Pago. */
  europa_temporada: 'Las 4 ligas de Europa — Temporadas completas',
};

/* Suscripción vs pago único = ÚNICA fuente de verdad en lib/plans.js
   (bandera `recurring`). Los planes de temporada / pago único jamás
   entran al modo suscripción. */

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host && !host.includes('localhost')) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://ricky-picks.vercel.app';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const plan = (body && body.plan) || 'torneo';
    const def = SERVER_PLANS[plan];
    /* price > 0 también excluye los planes permanentes (price 0): esos
       solo se otorgan por código/soporte, jamás se venden. */
    if (!def || !PLAN_NAMES[plan] || !(def.price > 0)) {
      return res.status(400).json({ error: 'Plan inválido.' });
    }
    /* Plan cableado pero todavía no a la venta (Europa en beta
       privada): se rechaza ANTES de tocar Stripe, sin excepciones. */
    if (isUpcoming(plan)) {
      return res.status(400).json({ error: 'Ese plan todavía no está a la venta.' });
    }
    const discountCode = ((body && body.discount_code) || '').toString().trim().toUpperCase();
    const discount = discountFor(discountCode, plan);

    const user = await getUserFromToken(bearer(req));
    if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

    /* Plan "a elegir" (tres_mensual): la elección llega del checkout
       y se valida aquí (exactamente 3 modelos válidos). Viaja en la
       metadata de la sesión Y de la suscripción (el webhook de
       renovaciones la lee de ahí) y se guarda como respaldo. */
    let models = null;
    if (isChoosePlan(plan)) {
      models = validChoice(plan, body && body.models);
      if (!models) return res.status(400).json({ error: 'Elige exactamente 3 modelos.' });
      try { await saveChoice(user.id, plan, models); } catch (e) { console.error('stripe-create: elección no respaldada', e.message); }
    }
    /* Accesos actuales de ESTE usuario (filas expandidas por producto):
       deciden la excepción de los retirados, el candado de "ya lo
       tienes" y los precios especiales. Nunca lo que diga el navegador. */
    const ents = await getEntitlements(user.id, user.email);

    /* Un plan retirado no se vende — salvo ofertas prometidas
       vigentes: el upgrade de $199 de los mensuales fundador a su
       temporada (retiradas del público el 8-sep-2026) y combo_2026
       con $799 por un modelo completo pagado. */
    if (def.retired) {
      const up = monthlyUpgradeFor(ents);
      let permitido = !!(up && up.target === plan);
      if (plan === 'combo_2026') permitido = permitido || !!comboPermanentDiscount(ents);
      /* Un código válido PARA ESTE PLAN también abre la compra: así se
         venden los pases que están fuera del catálogo público y se
         cierran uno a uno (europa_temporada con DAYOG). El código se
         valida contra lib/discounts.js en el servidor — el navegador
         solo manda el texto. */
      permitido = permitido || !!discount;
      if (!permitido) return res.status(400).json({ error: 'Ese plan ya no está a la venta.' });
    }

    /* Ya tiene TODO lo que incluye este plan con un acceso que dura
       más (pase de temporada o permanente vigente): no se le cobra
       algo que no le agrega nada. Si solo cubre ALGUNOS productos
       (tiene mlb_temporada y compra todo_mensual) la compra sigue y
       grantEntitlement conserva ese pase (coverageBeats). */
    const yaCubiertos = productsAlreadyCovered(ents, plan, undefined, models);
    if (yaCubiertos.length && yaCubiertos.length >= (models || productsForPlan(plan)).length) {
      return res.status(400).json({ error: 'Ya tienes todo lo que incluye ese plan con un acceso vigente que dura más. No hace falta comprarlo.', covered: true });
    }

    const NOMBRE = { mlb: 'MLB', mx: 'Liga MX', nfl: 'NFL', epl: 'Premier League', laliga: 'LaLiga', bundesliga: 'Bundesliga', ucl: 'Champions League' };
    /* Precio de fundador: quien ya era cliente de los modelos previos
       paga menos por "Todos los modelos". Va en el precio BASE de la
       suscripción —no como cupón— para que valga en CADA renovación:
       un cupón de Stripe con duration 'once' solo abarataría el primer
       mes y al segundo le llegaría el cobro completo. */
    /* Precio para ESTE cliente (fundador o upgrade por tener un modelo).
       lib/plans.js decide cuál le toca y elige el mejor; aquí solo se
       cobra lo que diga. */
    /* Moneda del cobro. PESOS por defecto (17-sep-2026): a la mayoría
       de los clientes mexicanos su banco les rechazaba el cargo en
       dólares o les sumaba comisión por compra internacional. El dólar
       sigue disponible si el cliente lo pide (`moneda: 'USD'`, el
       selector del checkout), y es la única pasarela que puede darlo:
       Mercado Pago México solo procesa pesos.

       normalizaMoneda deja fuera cualquier valor raro cayendo al peso;
       si aun así el plan no tuviera precio en esa moneda se RECHAZA la
       compra en vez de cobrar el número de la otra (un $499 de pesos
       cobrado en dólares serían 17 veces de más). */
    const MONEDA = normalizaMoneda(body && body.moneda, 'stripe');
    const lista = montoDe(plan, MONEDA);
    if (lista == null) {
      console.error('stripe-create: plan sin precio en', MONEDA, '—', plan);
      return res.status(400).json({ error: 'Ese plan no está disponible en esa moneda. Intenta de nuevo o paga con Mercado Pago.' });
    }
    const oferta = precioDe(plan, ents, MONEDA);
    const precioBase = oferta ? oferta.price : lista;
    const p = {
      name: PLAN_NAMES[plan] + (models ? ` (${models.map(m => NOMBRE[m] || m).join(', ')})` : '')
        + (oferta ? (oferta.motivo === 'fundador' ? ' — precio de fundador' : ' — precio por ser cliente') : ''),
      price: Math.round(precioBase * 100), currency: MONEDA.toLowerCase(),
    };
    /* metadata que leen stripe-capture (alta) y stripe-webhook
       (renovaciones): user_id, plan y, en "a elegir", los modelos. */
    const META = models ? { user_id: user.id, plan, models: models.join(',') } : { user_id: user.id, plan };
    const SITE_URL = siteUrl(req);

    /* ---- Mensuales (MLB, Liga MX, Combo): SUSCRIPCIÓN real ----
       El acceso inicial se otorga en stripe-capture al volver del
       checkout; las RENOVACIONES mensuales las otorga
       api/stripe-webhook (evento invoice.paid). El crédito del Pase
       del día se aplica como cupón de una sola vez en los planes que
       incluyen MLB. */
    if (isSubscription(plan)) {
      const sessionParams = {
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: p.currency,
            product_data: { name: p.name },
            unit_amount: p.price,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],
        // metadata en la suscripción: el webhook la lee en cada renovación
        subscription_data: { metadata: META },
        success_url: `${SITE_URL}/checkout.html?plan=${plan}&via=stripe&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/checkout.html?plan=${plan}`,
        metadata: META,
        customer_email: user.email,
      };
      if (discount) {
        /* Código de descuento sobre suscripción: cupón de UNA sola vez
           (solo el primer mes; las renovaciones van a precio completo).
           Redondeado a pesos para que coincida con lo que ve el cliente. */
        const pesosOff = lista - priceWith(discount, lista, MONEDA);
        if (pesosOff > 0) {
          const coupon = await stripe.coupons.create({
            amount_off: Math.round(pesosOff * 100), currency: p.currency,
            duration: 'once', name: `Código ${discountCode}`,
          });
          sessionParams.discounts = [{ coupon: coupon.id }];
        }
      } else {
        /* Rollover: lo pagado por el Pase (24 h) o la Semana (48 h)
           se descuenta del primer mes del plan mensual con MLB. */
        const includesMlb = plan === 'mlb_fundador' || plan === 'combo_total';
        const ent = includesMlb ? await getEntitlement(user.id, user.email, 'mlb') : null;
        const credit = upgradeCreditFor(ent, MONEDA); // en la moneda del cobro, o 0
        if (credit > 0) {
          const coupon = await stripe.coupons.create({
            amount_off: Math.round(credit * 100), currency: p.currency,
            duration: 'once', name: `Crédito de tu compra anterior ($${credit})`,
          });
          sessionParams.discounts = [{ coupon: coupon.id }];
        }
      }
      const session = await stripe.checkout.sessions.create(sessionParams);
      return res.status(200).json({ url: session.url });
    }

    /* ---- resto de planes: pago único ---- */
    let finalPrice = Math.round(priceWith(discount, precioBase, MONEDA) * 100); // Stripe cobra en centavos
    let productName = discount ? `${p.name} (${labelWith(discount)})` : p.name;

    /* Precios especiales de los pases completos (manda el más fuerte):
       1) Upgrade del MENSUAL: con cualquier mensualidad vigente, el
          pase que le corresponde cuesta $199 y su suscripción se
          cancela sola al pagar (ver monthlyUpgradeFor).
       2) Combo con UN modelo completo pagado: $799. */
    let permDisc = null;
    let upgrade = null;
    if (FULL_PASS_PLANS.includes(plan)) {
      const up = monthlyUpgradeFor(ents);
      if (up && up.target === plan) {
        upgrade = up;
        const montoUp = MONEDA === 'USD' ? up.usd : up.price;
        finalPrice = Math.round(montoUp * 100);
        productName = `${p.name} — upgrade de tu plan mensual ($${montoUp} ${MONEDA}; tu mensualidad se cancela sola)`;
      } else if (plan === 'combo_2026') {
        permDisc = comboPermanentDiscount(ents);
        if (permDisc) {
          const montoPerm = MONEDA === 'USD' ? permDisc.usd : permDisc.price;
          finalPrice = Math.round(montoPerm * 100);
          productName = `${p.name} — precio especial: ya tienes uno de los modelos ($${montoPerm} ${MONEDA})`;
        }
      }
    }

    /* Crédito de la Semana MLB (48 h) hacia los pases completos:
       antes apuntaba a los mensuales (retirados 27-jul). No se
       encima con los precios especiales de arriba. */
    if (!permDisc && !upgrade && (plan === 'mlb_temporada' || plan === 'combo_2026')) {
      const ent = await getEntitlement(user.id, user.email, 'mlb');
      const credit = upgradeCreditFor(ent, MONEDA); // en la moneda del cobro, o 0
      if (credit > 0) {
        finalPrice = Math.max(0, finalPrice - Math.round(credit * 100));
        productName += ` (crédito de tu Semana: -$${credit})`;
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: p.currency,
          product_data: { name: productName },
          unit_amount: finalPrice,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${SITE_URL}/checkout.html?plan=${plan}&via=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout.html?plan=${plan}`,
      metadata: { user_id: user.id, plan },
      customer_email: user.email,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('stripe-create:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
