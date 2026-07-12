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
    title: 'Torneo completo',
    price: 300,       // MXN
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
    title: 'Doctor MLB — Temporada 2026',
    price: 2999,      // MXN
    currency: 'MXN',
    days: 150,        // hasta el final de la Serie Mundial
  },
};

module.exports = { PLANS };
