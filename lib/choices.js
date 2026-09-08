/* ============================================================
   ELECCIÓN DE MODELOS de los planes "a elegir" (tres_mensual).

   El plan de tres modelos no tiene productos fijos: el cliente
   escoge 3 de los 7 en el checkout. Esa elección tiene que
   sobrevivir hasta que las pasarelas avisen que el pago se aprobó
   (y, en Mercado Pago, hasta cada renovación):
     - Stripe: viaja en la metadata de la sesión y de la suscripción
       (fuente principal) y aquí como respaldo.
     - Mercado Pago: el preapproval no admite metadata y su
       external_reference tiene formato fijo (userId:planId, lo
       verifican las cancelaciones), así que la elección se guarda
       AQUÍ antes de crear la suscripción, y además va en el texto
       del cobro (`reason`) como segundo respaldo.
   Desde el primer cobro la verdad son las filas de entitlements del
   usuario (una por modelo elegido, plan tres_mensual); esto solo
   cubre el alta. El cambio de modelo (api/swap-model.js) también
   deja registro aquí para permitir uno por periodo de cobro.

   Almacén: el KV del bucket de Supabase Storage que ya usan los
   picks gratis (kvGet/kvPut en lib/odds/theoddsapi.js): sobrevive
   cold starts y no requiere migración. Cada escritura se relee para
   confirmar que quedó; si no, se avisa y el checkout no continúa.
   ============================================================ */
const { kvGet, kvPut } = require('./odds/theoddsapi');
const { validChoice } = require('./plans');

const choiceKey = (userId, plan) => `choice-${plan}-${userId}`;
const swapKey = (userId, plan) => `swap-${plan}-${userId}`;

/* Guarda la elección (normalizada) y confirma releyendo. Lanza si la
   elección no es válida o si el almacén no la devuelve igual. */
async function saveChoice(userId, plan, products) {
  const list = validChoice(plan, products);
  if (!list) throw new Error('Elección de modelos inválida.');
  const value = { products: list, at: new Date().toISOString() };
  await kvPut(choiceKey(userId, plan), value);
  const back = await kvGet(choiceKey(userId, plan));
  if (!back || !Array.isArray(back.products) || back.products.join(',') !== list.join(',')) {
    throw new Error('No se pudo guardar tu elección de modelos. Intenta de nuevo.');
  }
  return list;
}

/* Elección guardada (normalizada) o null. */
async function loadChoice(userId, plan) {
  try {
    const v = await kvGet(choiceKey(userId, plan));
    return v && Array.isArray(v.products) ? validChoice(plan, v.products) : null;
  } catch (e) { return null; }
}

/* Borra la elección guardada (pruebas / limpieza): un {products: []}
   que loadChoice lee como "nada". */
async function clearChoice(userId, plan) {
  await kvPut(choiceKey(userId, plan), { products: [], cleared: new Date().toISOString() });
}

/* Registro del último cambio de modelo (ISO) — uno por periodo. */
async function saveSwap(userId, plan) {
  const at = new Date().toISOString();
  await kvPut(swapKey(userId, plan), { at });
  return at;
}
async function loadSwap(userId, plan) {
  try {
    const v = await kvGet(swapKey(userId, plan));
    return v && v.at ? v.at : null;
  } catch (e) { return null; }
}

/* Texto del cobro de Mercado Pago con la elección adentro, y su
   lectura de vuelta: "RICKY·PICKS — Tres modelos a elegir [mlb,nfl,epl]". */
function reasonWith(title, products) {
  return `RICKY·PICKS — ${title} [${products.join(',')}]`;
}
function choiceFromReason(plan, reason) {
  const m = /\[([a-z,]+)\]\s*$/.exec(String(reason || ''));
  return m ? validChoice(plan, m[1].split(',')) : null;
}

module.exports = { saveChoice, loadChoice, clearChoice, saveSwap, loadSwap, reasonWith, choiceFromReason };
