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

   MONEDA (16-sep-2026): el sitio PUBLICA en dólares. `price` y
   `anchor` vienen en USD —es lo que el cliente lee— y el peso viaja
   aparte en `price_mxn` / `anchor_mxn`, que es lo que cobra Mercado
   Pago (una cuenta mexicana no procesa dólares; con tarjeta cobra
   Stripe en USD). Un plan a la venta SIN precio en dólares no se
   publica: enseñar el número de pesos con signo de dólar sería
   cobrar-mostrar 17 veces de menos.

   No expone nada sensible: solo id, título, precio, moneda y vigencia
   de planes comprables (sin `retired`, sin `upcoming` y con precio
   > 0). Un plan `upcoming` (cableado pero todavía no a la venta —
   Europa en beta privada) tampoco sale: el front deduce "próximamente"
   de su ausencia, nunca de un precio que no se puede cobrar.
   ============================================================ */
const { PLANS } = require('../lib/plans');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const out = {};
  /* Precios de TODOS los planes con precio, retirados incluidos. El
     checkout necesita pintar en dólares un pase fuera del catálogo
     (europa_temporada con un código), y `plans` no lo lista porque su
     ausencia es justo lo que significa "ya no está a la venta". */
  const precios = {};
  for (const [id, p] of Object.entries(PLANS)) {
    if (!p || !(p.price > 0)) continue;
    precios[id] = {
      usd: p.usd != null ? p.usd : null,
      mxn: p.price,
      anchor_usd: p.anchor_usd || null,
      anchor_mxn: p.anchor || null,
    };
    if (p.retired || p.upcoming) continue;
    if (p.usd == null) {                       // a la venta pero sin precio en dólares
      console.error('plans-public: plan sin precio en USD, no se publica —', id);
      continue;
    }
    out[id] = {
      id,
      title: p.title,
      price: p.usd,
      /* Precio ancla (valor real pagando mes a mes) para el tachado. */
      anchor: p.anchor_usd || null,
      currency: 'USD',
      /* Lo que cobra Mercado Pago, para poder decirlo junto al botón. */
      price_mxn: p.price,
      anchor_mxn: p.anchor || null,
      days: p.days || null,
      products: Array.isArray(p.products) ? p.products : null,
      choose: p.choose || null,   // "a elegir": cuántos modelos escoge el cliente
      recurring: !!p.recurring,
    };
  }
  /* Cache corto: los precios cambian poco, pero cuando cambian no
     queremos que una CDN los sirva viejos por horas. */
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({ plans: out, precios, moneda: 'USD', moneda_mp: 'MXN' });
};
