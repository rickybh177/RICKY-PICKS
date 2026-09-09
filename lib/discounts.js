/* ============================================================
   Códigos de descuento — SERVIDOR únicamente.
   El navegador nunca decide un precio: manda el código y el
   servidor recalcula contra lib/plans.js.

   Dos formas de definir un código:
     pct:   descuento porcentual sobre el precio de lista.
     price: PRECIO FINAL fijo en MXN.
   `price` existe para códigos que se comunican como un precio
   cerrado ("Champions a $499"): con `pct` habría que escribir
   44.494% y el importe cambiaría solo si algún día se mueve el
   precio de lista del plan.
   ============================================================ */
const DISCOUNTS = {
  'VIEJITOVIP': { plan: 'torneo', pct: 20 },
  'ANGEL50':    { plan: 'torneo', pct: 50 },
  /* 8-sep-2026: Champions completa (lista $899) a $499 de pago único. */
  'AMIGOKIT':   { plan: 'ucl_temporada', price: 499 },
  /* 8-sep-2026: las CUATRO ligas europeas completas (lista $3,596) a
     $2,399 de pago único. Es la única forma de comprar
     `europa_temporada`, que está fuera del catálogo público. */
  'DAYOG':      { plan: 'europa_temporada', price: 2399 },
};

/* El código válido para ESTE plan, o null. Normaliza mayúsculas y
   espacios, y verifica que el código sea del plan que se está
   comprando (un código de Champions no abarata otro modelo). */
function discountFor(code, planId) {
  const key = String(code == null ? '' : code).trim().toUpperCase();
  if (!key) return null;
  const d = DISCOUNTS[key];
  if (!d || d.plan !== planId) return null;
  return { ...d, code: key };
}

/* Precio final en MXN. ÚNICO lugar donde se calcula: stripe-create,
   create-payment y el checkout leen de aquí para que las tres cifras
   no puedan discrepar. */
function priceWith(discount, listPrice) {
  if (!discount) return listPrice;
  /* Nunca cobrar MÁS que el precio de lista: si algún día el plan baja
     por debajo del precio del código, el cliente paga el menor. */
  if (discount.price != null) return Math.min(discount.price, listPrice);
  return Math.round(listPrice * (1 - discount.pct / 100));
}

/* Cómo se nombra el descuento en el cobro y en el recibo. */
function labelWith(discount) {
  if (!discount) return '';
  return discount.price != null
    ? `precio especial con código ${discount.code}`
    : `${discount.pct}% descuento`;
}

module.exports = { DISCOUNTS, discountFor, priceWith, labelWith };
