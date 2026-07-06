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
    title: 'Partidos del día',
    price: 199,       // MXN
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
