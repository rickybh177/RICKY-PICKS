/* ============================================================
   Crédito del Pase del día al subir a Mensual Fundador (MLB).

   Promesa del pricing: "Si subes al Fundador hoy, tus $99 se
   acreditan". Este helper la hace real: si el entitlement MLB
   vigente del usuario es un mlb_pase todavía válido (comprado en
   las últimas 24 h), regresa el crédito en MXN; si no, 0.

   Lo usan api/stripe-create.js y api/create-payment.js para que
   AMBAS pasarelas cobren lo mismo. Solo backend.
   ============================================================ */
const { PLANS } = require('./plans');

const CREDIT_MXN = PLANS.mlb_pase ? PLANS.mlb_pase.price : 99;

/* ent = entitlement MLB del usuario (o null). */
function paseCreditFor(ent) {
  if (!ent || !ent.active || ent.plan !== 'mlb_pase' || !ent.updated_at) return 0;
  const days = (PLANS.mlb_pase && PLANS.mlb_pase.days) || 1;
  const since = Date.parse(ent.updated_at);
  if (!Number.isFinite(since)) return 0;
  return (Date.now() - since) <= days * 86400e3 ? CREDIT_MXN : 0;
}

module.exports = { paseCreditFor, CREDIT_MXN };
