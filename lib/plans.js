/* ============================================================
   Planes y precios — fuente de verdad en el servidor.
   El precio JAMÁS se toma del navegador.
   ============================================================ */
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
    price: 149,       // MXN
    currency: 'MXN',
    days: 7,
  },
  mlb_fundador: {
    id: 'mlb_fundador',
    title: 'Doctor MLB — Mensual Fundador',
    price: 399,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },
  mlb_temporada: {
    id: 'mlb_temporada',
    title: 'Modelo MLB — Temporada 2026',
    price: 999,       // MXN (precio exclusivo del acceso fundador; regular: 2999)
    currency: 'MXN',
    days: 150,        // hasta el final de la Serie Mundial
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },

  /* ---- DOCTOR LIGA MX + COMBO DOCTOR DEPORTES ----
     El combo otorga DOS entitlements (mlb + mx) en filas separadas;
     grantEntitlement lo divide vía `products`. */
  mx_fundador: {
    id: 'mx_fundador',
    title: 'Modelo Liga MX — Mensual Fundador',
    price: 399,       // MXN (ancla: 499)
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },
  combo_fundador: {
    id: 'combo_fundador',
    title: 'Combo MLB + Liga MX',
    price: 499,       // MXN (precio regular 900 — "ahorras $401/mes")
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },
  mx_apertura: {
    id: 'mx_apertura',
    title: 'Doctor Liga MX — Apertura 2026 completo',
    price: 899,       // MXN (ancla: 1999)
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
    price: 149,       // MXN
    currency: 'MXN',
    days: 7,
  },
  nfl_fundador: {
    id: 'nfl_fundador',
    title: 'Modelo NFL — Mensual Fundador',
    price: 399,       // MXN (ancla: 499)
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual
  },
  nfl_temporada: {
    id: 'nfl_temporada',
    title: 'Modelo NFL — Temporada 26-27 completa',
    price: 999,       // MXN (ancla: 2999)
    currency: 'MXN',
    days: 180,        // hasta el Super Bowl
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
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra.
  },

  /* ---- CÍRCULO FUNDADOR (ancla premium, Anchor Upsell) ----
     Tier real 5x el Fundador: todos los modelos + línea directa con
     Ricky por Telegram. Se presenta PRIMERO en el pricing para
     anclar el precio; las pocas ventas que haga son utilidad
     desproporcionada. */
  circulo_fundador: {
    id: 'circulo_fundador',
    title: 'Círculo Fundador — todos los modelos + línea directa',
    price: 1999,      // MXN (5x mlb_fundador)
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl'], // "todos los modelos" incluye NFL
    recurring: true,  // suscripción mensual
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
  const days = (PLANS[ent.plan] && PLANS[ent.plan].days) || 30;
  const since = ent.updated_at ? Date.parse(ent.updated_at) : 0;
  return Number.isFinite(since) && (Date.now() - since) <= days * 86400e3;
}

module.exports = { PLANS, isSubscription, planCoversProduct, entitlementGrants };
