/* ============================================================
   Planes y precios — fuente de verdad en el servidor.
   El precio JAMÁS se toma del navegador.
   ============================================================ */

/* Arranque de la temporada regular NFL 26-27 (Patriots @ Seahawks).
   Los planes de NFL con `starts_at` NO empiezan a consumir su
   vigencia antes de esta fecha — así "la pretemporada va gratis" es
   real y no una promesa de marketing: quien compra en agosto ve toda
   la pretemporada y su mes (o su temporada) arranca hasta el kickoff. */
const NFL_KICKOFF = '2026-09-10T00:20:00Z';

const PLANS = {
  mexico: {
    id: 'mexico',
    title: 'Partido de México',
    price: 199,       // MXN
    currency: 'MXN',
  },
  torneo: {
    id: 'torneo',
    title: 'Partidos finales del Mundial',
    price: 299,       // MXN
    currency: 'MXN',
  },
  final: {
    id: 'final',
    title: 'La final del Mundial — Argentina vs España',
    price: 99,        // MXN
    currency: 'MXN',
  },

  /* ---- DOCTOR MLB (preventa fundador) ----
     Vigencias en días (validez del entitlement desde la compra).
     Cuando existan suscripciones reales, el fundador migra a
     cobro recurrente; mientras, es acceso renovable. */
  /* RETIRADO: ya no se puede comprar. Se queda aquí para que los
     entitlements de quienes SÍ lo compraron sigan calculando su
     vigencia (api/mlb-picks.js lee PLANS[ent.plan].days). */
  mlb_pase: {
    id: 'mlb_pase',
    title: 'Doctor MLB — Pase del día',
    price: 99,        // MXN
    currency: 'MXN',
    days: 1,
    retired: true,    // bloquea la compra en stripe-create / create-payment
  },
  mlb_semana: {
    id: 'mlb_semana',
    title: 'Doctor MLB — Semana de prueba',
    price: 199,       // MXN
    currency: 'MXN',
    days: 7,
  },
  /* RETIRADO 27-jul-2026: se eliminó el modelo de suscripción del
     sitio (decisión del dueño). Los suscriptores existentes conservan
     su plan y sus renovaciones vía webhook; solo se bloquean compras
     nuevas. */
  mlb_fundador: {
    id: 'mlb_fundador',
    title: 'Doctor MLB — Mensual Fundador',
    price: 399,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },
  mlb_temporada: {
    id: 'mlb_temporada',
    title: 'Modelo MLB — Temporada 2026',
    price: 599,       // MXN (ancla: 2999) — subió de 549 el 6-ago
    currency: 'MXN',
    days: 150,        // hasta el final de la Serie Mundial
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },

  /* ---- DOCTOR LIGA MX + COMBO DOCTOR DEPORTES ----
     El combo otorga DOS entitlements (mlb + mx) en filas separadas;
     grantEntitlement lo divide vía `products`. */
  /* RETIRADO 27-jul-2026 (fin de las suscripciones). */
  mx_fundador: {
    id: 'mx_fundador',
    title: 'Modelo Liga MX — Mensual Fundador',
    price: 399,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },
  /* Prueba semanal de Liga MX (reemplaza al mensual como entrada). */
  mx_semana: {
    id: 'mx_semana',
    title: 'Modelo Liga MX — Semana de prueba',
    price: 249,       // MXN
    currency: 'MXN',
    days: 7,
  },
  /* LEGADO: el combo de 2 modelos ya no se vende. Sigue aquí para que
     quienes lo contrataron conserven exactamente lo que compraron
     (MLB + Liga MX a $499) — NO incluye NFL. A ellos se les ofrece
     el upgrade al Combo Total pagando la diferencia. */
  combo_fundador: {
    id: 'combo_fundador',
    title: 'Combo MLB + Liga MX (legado)',
    price: 499,       // MXN
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },

  /* RETIRADO 27-jul-2026 (fin de las suscripciones): lo reemplaza
     combo_2026 (pago único). Suscriptores existentes conservan todo. */
  combo_total: {
    id: 'combo_total',
    title: 'Combo Total — MLB + Liga MX + NFL (mensual, legado)',
    price: 799,       // MXN
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },

  /* Combo 2026: los TRES modelos en pago único — el combo publicado.
     Ancla = suma real de los tres pases completos:
     599 (MLB temporada) + 699 (MX apertura) + 799 (NFL temporada)
     = 2,097. days 365 cubre las tres temporadas completas (la última
     en terminar es la NFL, feb-2027). */
  combo_2026: {
    id: 'combo_2026',
    title: 'Combo Total — MLB + Liga MX + NFL (pago único)',
    price: 1199,      // MXN (por separado: 599+699+799 = 2,097)
    currency: 'MXN',
    days: 365,
    products: ['mlb', 'mx', 'nfl'],
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },
  mx_apertura: {
    id: 'mx_apertura',
    title: 'Doctor Liga MX — Apertura 2026 completo',
    price: 699,       // MXN (ancla: 1999) — bajó de 899 el 27-jul
    currency: 'MXN',
    days: 170,        // jornada 1 → final de la liguilla (dic 2026)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },

  /* ---- MODELO NFL (temporada 26-27) ----
     Misma estructura que MLB. Ojo: la NFL es SEMANAL (16 juegos por
     jornada, ~5 meses), así que la "semana" cubre una jornada
     completa y la temporada llega hasta el Super Bowl. */
  nfl_semana: {
    id: 'nfl_semana',
    title: 'Modelo NFL — Semana de prueba',
    price: 249,       // MXN
    currency: 'MXN',
    days: 7,
  },
  /* RETIRADO 27-jul-2026 (fin de las suscripciones). */
  nfl_fundador: {
    id: 'nfl_fundador',
    title: 'Modelo NFL — Mensual Fundador',
    price: 599,       // MXN
    currency: 'MXN',
    days: 30,
    starts_at: NFL_KICKOFF, // la pretemporada NO consume el mes pagado
    recurring: true,  // suscripción mensual
    retired: true,    // bloquea compras nuevas
  },
  nfl_temporada: {
    id: 'nfl_temporada',
    title: 'Modelo NFL — Temporada 26-27 completa',
    price: 799,       // MXN (ancla: 2999) — incluye la pretemporada gratis
    currency: 'MXN',
    days: 180,        // arranque + 180 días = 9-mar-2027 (cubre el Super Bowl)
    starts_at: NFL_KICKOFF,
    // PAGO ÚNICO: sin `recurring`.
  },

  /* ---- COMBO PERMANENTE (solo por código, no se vende) ----
     Acceso a MLB + Liga MX que no expira: `days` es ~100 años porque
     la vigencia de cualquier entitlement se calcula como
     updated_at + days (ver api/mlb-picks.js / api/mx-picks.js). No
     hay forma de marcar "sin vencimiento" salvo un número enorme. */
  combo_permanente: {
    id: 'combo_permanente',
    title: 'Combo MLB + Liga MX — acceso permanente (código)',
    price: 0,         // no tiene precio: solo se otorga por código
    currency: 'MXN',
    days: 36500,      // ~100 años
    products: ['mlb', 'mx'],
    permanent: true,  // acceso de por vida (cuenta para el precio especial del Combo)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra.
  },

  /* ---- PERMANENTES INDIVIDUALES (solo soporte/código, no se venden) ----
     Un solo modelo de por vida. price 0 = jamás comprable en las
     pasarelas (ambas exigen price > 0); se otorgan con grantEntitlement
     o un código en api/redeem.js. */
  mlb_permanente: {
    id: 'mlb_permanente',
    title: 'Modelo MLB — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,      // ~100 años
    permanent: true,
  },
  mx_permanente: {
    id: 'mx_permanente',
    title: 'Modelo Liga MX — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,
    permanent: true,
  },
  nfl_permanente: {
    id: 'nfl_permanente',
    title: 'Modelo NFL — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,
    permanent: true,
  },

  /* ---- CÍRCULO FUNDADOR (ancla premium, Anchor Upsell) ----
     Tier real 5x el Fundador: todos los modelos + línea directa con
     Ricky por Telegram. Se presenta PRIMERO en el pricing para
     anclar el precio; las pocas ventas que haga son utilidad
     desproporcionada. */
  /* RETIRADO: ya no se puede comprar. Se queda aquí para que los
     entitlements de quienes SÍ lo compraron sigan calculando su
     vigencia (ver entitlementGrants más abajo). */
  circulo_fundador: {
    id: 'circulo_fundador',
    title: 'Círculo Fundador — todos los modelos + línea directa',
    price: 1999,      // MXN (5x mlb_fundador)
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl'], // "todos los modelos" incluye NFL
    recurring: true,  // suscripción mensual
    retired: true,    // bloquea la compra en stripe-create / create-payment
  },
};

/* ¿Este plan es suscripción (cobro recurrente)? ÚNICA fuente de verdad.
   Solo los planes con `recurring: true` crean suscripción/preapproval en
   las pasarelas. Cualquier plan de temporada / pago único (sin la bandera)
   se cobra UNA sola vez — nunca se re-cobra. */
function isSubscription(planId) {
  return !!(PLANS[planId] && PLANS[planId].recurring);
}

/* ¿Este plan cubre este producto? ÚNICA fuente de verdad del acceso.

   Antes cada endpoint lo resolvía por prefijo del nombre del plan
   (`mlb_`, `combo_`…), lo que dejaba fuera cualquier plan cuyo nombre
   no siguiera esa convención — `circulo_fundador` incluido, que es el
   plan MÁS caro y se quedaba sin acceso a nada. Ahora manda la lista
   `products` del plan cuando existe, y el prefijo solo es el respaldo. */
function planCoversProduct(planId, product) {
  const plan = PLANS[planId];
  if (!plan || !product) return false;
  if (Array.isArray(plan.products)) return plan.products.includes(product);
  return planId.startsWith(product + '_');
}

/* ¿El entitlement da acceso VIGENTE a este producto?
   Combina cobertura del plan + vigencia (days desde updated_at). */
function entitlementGrants(ent, product) {
  if (!ent || !ent.active || !ent.plan) return false;
  if (!planCoversProduct(ent.plan, product)) return false;
  const plan = PLANS[ent.plan] || {};
  const days = plan.days || 30;
  const bought = ent.updated_at ? Date.parse(ent.updated_at) : 0;
  if (!Number.isFinite(bought)) return false;
  /* El reloj arranca al comprar, salvo que el plan tenga `starts_at`
     (NFL: la pretemporada no consume la vigencia). En una renovación
     updated_at ya es posterior al kickoff, así que manda la compra. */
  const floor = plan.starts_at ? Date.parse(plan.starts_at) : 0;
  const since = Math.max(bought, Number.isFinite(floor) ? floor : 0);
  return Date.now() <= since + days * 86400e3;
}

/* Precio del Combo 2026 para clientes con acceso PERMANENTE.

   Regla del dueño (18-ago-2026): quien ya tiene EXACTAMENTE UN modelo
   permanente compra el Combo 2026 a $799 en vez de $1,199 (ya pagó de
   por vida una de las tres patas). Con DOS o más permanentes no aplica.
   Recibe la lista de getEntitlements (filas ya expandidas por producto)
   y regresa { price, product } o null. */
const COMBO_PERM_PRICE = 799; // MXN (combo_2026 $1,199 menos $400)

function comboPermanentDiscount(ents) {
  const perm = new Set();
  for (const e of ents || []) {
    if (!e || !e.active) continue;
    const plan = PLANS[e.plan];
    if (!plan || !plan.permanent) continue;
    const prods = Array.isArray(plan.products) ? plan.products
      : [e.product || String(e.plan).split('_')[0]];
    prods.forEach(p => perm.add(p));
  }
  if (perm.size !== 1) return null;
  return { price: COMBO_PERM_PRICE, product: [...perm][0] };
}

module.exports = { PLANS, isSubscription, planCoversProduct, entitlementGrants, comboPermanentDiscount };
