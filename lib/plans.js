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
  individual: {
    id: 'individual',
    title: 'Cuartos de final',
    price: 299,       // MXN
    currency: 'MXN',
  },
  torneo: {
    id: 'torneo',
    title: 'Torneo completo',
    price: 499,       // MXN
    currency: 'MXN',
  },
};

module.exports = { PLANS };
