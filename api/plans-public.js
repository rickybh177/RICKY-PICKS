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

   MONEDA (17-sep-2026): el sitio PUBLICA en PESOS. `price` y `anchor`
   vienen en MXN —es lo que lee el cliente y lo que se le cobra por
   default en las dos pasarelas— y el dólar viaja aparte en
   `price_usd` / `anchor_usd`, para quien elija pagar en dólares con
   tarjeta (Mercado Pago México solo procesa pesos).

   Antes era al revés, un día: publicar en dólares hacía que al cliente
   mexicano su banco le rechazara el cargo o le sumara comisión por
   compra internacional.

   No expone nada sensible: solo id, título, precio, moneda y vigencia
   de planes comprables (sin `retired`, sin `upcoming` y con precio
   > 0). Un plan `upcoming` (cableado pero todavía no a la venta —
   Europa en beta privada) tampoco sale: el front deduce "próximamente"
   de su ausencia, nunca de un precio que no se puede cobrar.
   ============================================================ */
const { PLANS, MONEDA_DEFAULT, MONEDAS } = require('../lib/plans');

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
    out[id] = {
      id,
      title: p.title,
      price: p.price,
      /* Precio ancla (valor real pagando mes a mes) para el tachado. */
      anchor: p.anchor || null,
      currency: 'MXN',
      /* La alternativa en dólares, solo con tarjeta. null = ese plan no
         se puede pagar en dólares y el sitio no debe ofrecerlo. */
      price_usd: p.usd != null ? p.usd : null,
      anchor_usd: p.anchor_usd || null,
      days: p.days || null,
      products: Array.isArray(p.products) ? p.products : null,
      choose: p.choose || null,   // "a elegir": cuántos modelos escoge el cliente
      recurring: !!p.recurring,
    };
  }
  /* Cache corto: los precios cambian poco, pero cuando cambian no
     queremos que una CDN los sirva viejos por horas. */
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({
    plans: out, precios,
    moneda: MONEDA_DEFAULT,        // en la que se publica y se cobra por default
    monedas: MONEDAS,              // las que acepta la tarjeta
    moneda_mp: 'MXN',              // Mercado Pago solo procesa pesos
  });
};
