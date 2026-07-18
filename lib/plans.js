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
  mlb_pase: {
    id: 'mlb_pase',
    title: 'Doctor MLB — Pase del día',
    price: 99,        // MXN
    currency: 'MXN',
    days: 1,
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
  },
  mlb_temporada: {
    id: 'mlb_temporada',
    title: 'Modelo MLB — Temporada 2026',
    price: 999,       // MXN (precio exclusivo del acceso fundador; regular: 2999)
    currency: 'MXN',
    days: 150,        // hasta el final de la Serie Mundial
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
  },
  combo_fundador: {
    id: 'combo_fundador',
    title: 'Combo MLB + Liga MX',
    price: 499,       // MXN (precio regular 900 — "ahorras $401/mes")
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx'],
  },
  mx_apertura: {
    id: 'mx_apertura',
    title: 'Doctor Liga MX — Apertura 2026 completo',
    price: 899,       // MXN (ancla: 1999)
    currency: 'MXN',
    days: 170,        // jornada 1 → final de la liguilla (dic 2026)
  },
};

module.exports = { PLANS };
