/* ============================================================
   Créditos de upgrade hacia los planes mensuales que incluyen MLB
   (Rollover Upsell: lo que ya pagaste cuenta hacia lo siguiente).

   - Pase del día (LEGACY, ya no se vende): $99 si el pase sigue
     vigente (comprado en las últimas 24 h).
   - Semana de prueba: $149 si la semana se compró en las últimas
     48 h — es la oferta post-compra "tus $149 cuentan si subes ya".

   Lo usan api/stripe-create.js y api/create-payment.js para que
   AMBAS pasarelas cobren lo mismo. El descuento se aplica como
   cupón de UNA sola vez (solo el primer mes) y únicamente con
   tarjeta (Stripe); las suscripciones de Mercado Pago no soportan
   un primer cobro distinto. Solo backend.
   ============================================================ */
const { PLANS } = require('./plans');

const CREDIT_MXN = PLANS.mlb_pase ? PLANS.mlb_pase.price : 99;

/* Ventana del crédito de la Semana: 48 h desde la compra. */
const SEMANA_WINDOW_MS = 48 * 3600e3;

function within(ent, ms) {
  if (!ent || !ent.active || !ent.updated_at) return false;
  const since = Date.parse(ent.updated_at);
  return Number.isFinite(since) && (Date.now() - since) <= ms;
}

/* LEGACY — ent = entitlement MLB del usuario (o null). */
function paseCreditFor(ent) {
  if (!ent || ent.plan !== 'mlb_pase') return 0;
  const days = (PLANS.mlb_pase && PLANS.mlb_pase.days) || 1;
  return within(ent, days * 86400e3) ? CREDIT_MXN : 0;
}

/* Crédito total de upgrade hacia mlb_fundador / combo_fundador:
   el que aplique según el plan vigente del usuario. Nunca se suman. */
function upgradeCreditFor(ent) {
  if (!ent) return 0;
  if (ent.plan === 'mlb_semana' && within(ent, SEMANA_WINDOW_MS)) {
    return PLANS.mlb_semana ? PLANS.mlb_semana.price : 149;
  }
  return paseCreditFor(ent);
}

module.exports = { paseCreditFor, upgradeCreditFor, CREDIT_MXN, SEMANA_WINDOW_MS };
