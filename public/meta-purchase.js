/* ============================================================
   Meta Pixel — evento Purchase al volver de una compra.

   Se carga en las páginas a las que regresa el usuario después de
   pagar (mlb / nfl / mx / mis-modelos). Lee el plan del query string
   y dispara fbq('track','Purchase') UNA sola vez por compra.

   Cómo llega el plan, según la pasarela:
     Mercado Pago -> ?pago=ok&plan=<id>&payment_id=<id>  (back_urls en
                     api/create-payment.js; MP agrega payment_id solo)
     Stripe       -> ?pago=<id>&tx=<session_id>[&cur=USD] (redirect de
                     checkout.html)

   Solo cuenta si la URL trae el identificador del cobro (tx /
   payment_id). Sin él no hubo pago: un código canjeado también regresa
   con ?pago=<plan> y antes se reportaba como compra a precio completo.
   Cada cobro se cuenta UNA vez por navegador (localStorage, no
   sessionStorage: abrir la misma URL otro día ya no vuelve a sumar) y
   viaja como eventID para que Meta también lo deduplique.

   Se carga SIN defer, en el <head>: mlb.html limpia la URL mientras
   se arma la página y un script diferido ya no alcanzaba a leerla.

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
    mlb_temporada: 899,
    mx_semana: 249,
    mx_apertura: 899,
    nfl_semana: 249,
    nfl_temporada: 899,
    combo_2026: 1199,
    /* Escalera de tres tiers (8-sep-2026): Un modelo $349 · Tres a
       elegir $599 · Todos $899 (lib/plans.js manda). */
    mlb_mensual: 349,
    mx_mensual: 349,
    nfl_mensual: 349,
    epl_mensual: 349,
    laliga_mensual: 349,
    bundesliga_mensual: 349,
    ucl_mensual: 349,
    tres_mensual: 599,
    todo_mensual: 899,
    epl_temporada: 899,
    laliga_temporada: 899,
    bundesliga_temporada: 899,
    ucl_temporada: 899,
    /* Pase de las 4 ligas europeas: solo por código, así que el valor
       real lo manda el capture de la pasarela cuando existe. */
    europa_temporada: 3596,
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

  var tx = params.get('tx') || params.get('payment_id') || params.get('collection_id');
  if (!tx || tx === 'null') return;

  /* Stripe cobra también en dólares; Mercado Pago siempre en pesos. */
  var currency = (params.get('cur') || '').toUpperCase() === 'USD' ? 'USD' : 'MXN';

  /* Recargar, volver con "atrás" o abrir la URL guardada no recuenta. */
  var mark = 'fbq_purchase:' + tx;
  try {
    if (localStorage.getItem(mark)) return;
    localStorage.setItem(mark, '1');
  } catch (e) { /* storage bloqueado: el eventID deduplica del lado de Meta */ }

  fbq('track', 'Purchase', {
    value: val,
    currency: currency,
    content_ids: [plan],
    content_type: 'product',
  }, { eventID: 'purchase_' + tx });
})();
