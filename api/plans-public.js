/* ============================================================
   GET /api/plans-public
   PÚBLICO. El catálogo de planes que SÍ se venden, tal como está en
   lib/plans.js — la única fuente de verdad de los precios.

   Existe para que el front deje de escribir los importes a mano. Ese
   fue un bug real y repetido: los banners de mlb/nfl anunciaban
   "Temporada $999" y "Mensual $599" cuando los precios reales eran
   $599 y un plan retirado, y api/stripe-create.js llegó a cobrar $549
   mientras el sitio publicaba $599. Cualquier página nueva debe leer
   de aquí, no copiar números.

   No expone nada sensible: solo id, título, precio, moneda y vigencia
   de planes comprables (sin `retired` y con precio > 0).
   ============================================================ */
const { PLANS } = require('../lib/plans');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const out = {};
  for (const [id, p] of Object.entries(PLANS)) {
    if (!p || p.retired || !(p.price > 0)) continue;
    out[id] = {
      id,
      title: p.title,
      price: p.price,
      /* Precio ancla (valor real pagando mes a mes) para el tachado. */
      anchor: p.anchor || null,
      currency: p.currency || 'MXN',
      days: p.days || null,
      products: Array.isArray(p.products) ? p.products : null,
      recurring: !!p.recurring,
    };
  }
  /* Cache corto: los precios cambian poco, pero cuando cambian no
     queremos que una CDN los sirva viejos por horas. */
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({ plans: out });
};
