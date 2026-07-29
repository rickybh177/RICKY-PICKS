/* Códigos de descuento — servidor únicamente. */
const DISCOUNTS = {
  'VIEJITOVIP': { plan: 'torneo', pct: 20 },
  'ANGEL50':    { plan: 'torneo', pct: 50 },
  /* "Gana tu Semana": el cliente compró mlb_semana, su primera semana
     cerró perdedora y nos escribió dentro de los 7 días. Sus $149 se
     acreditan al primer mes del Fundador: $399 - $149 = $250 exactos
     (37.34% ≈ $149). Solo con tarjeta (cupón Stripe de una vez). */
  'GANASTE':    { plan: 'mlb_fundador', pct: 37.34 },
};

module.exports = { DISCOUNTS };
