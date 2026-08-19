/* ============================================================
   Meta Pixel — evento Purchase al volver de una compra.

   Se carga en las páginas a las que regresa el usuario después de
   pagar (mlb / nfl / mx / mis-modelos). Lee el plan del query string
   y dispara fbq('track','Purchase') UNA sola vez por compra.

   Cómo llega el plan, según la pasarela:
     Mercado Pago -> ?pago=ok&plan=<id>   (back_urls en api/create-payment.js)
     Stripe       -> ?pago=<id>           (redirect de checkout.html)

   El precio de aquí es SOLO para el reporte de Meta. El cobro real y
   el acceso los decide el servidor (lib/plans.js + el webhook); si
   alguien manipula la URL solo ensucia su propia métrica, nunca
   obtiene acceso.
   ============================================================ */
(function () {
  if (typeof fbq !== 'function') return;

  /* Espejo de los precios publicados (lib/plans.js es la fuente de
     verdad; esto solo reporta el valor a Meta). */
  var PRICES = {
    mexico: 199,
    torneo: 299,
    final: 99,
    mlb_semana: 199,
    mlb_temporada: 599,
    mx_semana: 249,
    mx_apertura: 699,
    nfl_semana: 249,
    nfl_temporada: 799,
    combo_2026: 1199,
  };

  var params = new URLSearchParams(window.location.search);
  var pago = params.get('pago');
  if (!pago || pago === 'pendiente' || pago === 'error') return;

  /* 'ok' (Mercado Pago) trae el plan aparte; Stripe lo manda en `pago`. */
  var plan = pago === 'ok' ? params.get('plan') : pago;
  if (!plan || !PRICES[plan]) return;

  /* `val` lo manda el servidor con el precio REALMENTE cobrado (hay
     upgrades y descuentos que cambian el precio de lista); el mapa de
     arriba es el respaldo cuando no viene. */
  var val = parseFloat(params.get('val'));
  if (!Number.isFinite(val) || val <= 0) val = PRICES[plan];

  /* Una recarga de la página no debe volver a contar la compra. */
  var mark = 'fbq_purchase:' + plan;
  try {
    if (sessionStorage.getItem(mark)) return;
    sessionStorage.setItem(mark, '1');
  } catch (e) { /* sessionStorage bloqueado: preferimos contar a no contar */ }

  fbq('track', 'Purchase', {
    value: val,
    currency: 'MXN',
    content_ids: [plan],
    content_type: 'product',
  });
})();
