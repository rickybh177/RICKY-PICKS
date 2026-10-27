/* ============================================================
   OFERTA DE RETENCIÓN: 50% en el SIGUIENTE cobro (17-oct-2026).

   Decisión del dueño: a quien intenta cancelar (o ya canceló) se le
   ofrece su siguiente mes a mitad de precio; después vuelve solo a su
   precio de siempre. Dos caminos:

   - "quedarse": todavía tiene una suscripción viva. Se le aplica el 50%
     a su PRÓXIMO cobro, sin checkout (api/retencion).
   - "regreso": ya canceló. Se suscribe de nuevo con el primer cobro al
     50% y luego su precio de antes (checkout normal con `regreso=1`).

   UNA sola vez por cliente, de por vida: si no, cualquiera aprende a
   apretar "Cancelar" cada mes para pagar la mitad.

   Cómo se hace en cada pasarela:
   - Stripe: cupón de 50% con `duration: 'once'` — Stripe lo aplica a un
     solo cobro y luego cobra normal. Nativo.
   - Mercado Pago: cobra el MISMO monto cada mes y no tiene "primer cobro
     distinto". Se baja el monto al 50%, se deja un aviso en el KV y
     api/mp-webhook lo regresa al precio completo en cuanto procesa el
     cobro con descuento (y SOLO si ese cobro fue el de descuento: si MP
     cobró otra cosa, no se toca nada).
   ============================================================ */
const { kvGet, kvPut } = require('./odds/theoddsapi');
const { PLANS, montoDe, entitlementGrants } = require('./plans');

const PCT = 50;
const claveUso = userId => `retencion-${userId}`;
const claveMP = preapprovalId => `mp-restaura-${preapprovalId}`;

/* Mitad del precio, en la moneda del cobro. Pesos sin centavos (así
   se ve en el sitio); dólares con centavos. */
function mitad(monto, moneda) {
  const m = Number(monto) * (100 - PCT) / 100;
  return moneda === 'USD' ? Math.round(m * 100) / 100 : Math.round(m);
}

/* ¿Todavía puede usar la oferta? Una vez de por vida, con una salvedad:
   si la reservó para REGRESAR y abandonó el checkout (no hay ningún plan
   recurrente otorgado después), la sigue teniendo. Si no, quien cierra
   la pestaña de pago sin pagar la perdería sin haberla usado. */
async function ofertaDisponible(userId, ents) {
  const u = await kvGet(claveUso(userId));
  if (!u || !u.at) return true;
  if (u.tipo !== 'regreso') return false;
  const at = Date.parse(u.at);
  const volvio = (ents || []).some(e => e && e.active && PLANS[e.plan] && PLANS[e.plan].recurring
    && Date.parse(e.updated_at) > at);
  return !volvio;
}
async function ofertaUsada(userId, ents) { return !(await ofertaDisponible(userId, ents)); }

/* Oferta de REGRESO para quien ya no tiene suscripción viva: su plan
   de antes, primer cobro al 50% y después su precio.

   SIEMPRE sobre el precio de LISTA (decisión del dueño, 27-oct-2026):
   ni fundador ni precio por ser cliente. Quien se va pierde esos
   precios; el regreso es la lista con su primer mes a mitad.

   El plan sale del registro de su cancelación (lib/cancelaciones) o, si
   no hay (se le venció solo), del plan mensual que se le venció. Solo
   planes que se pueden volver a comprar: uno retirado no se ofrece. */
function ofertaRegreso({ cancelada, expirados_plan, ents, moneda }) {
  const M = moneda === 'USD' ? 'USD' : 'MXN';
  const vendible = id => PLANS[id] && PLANS[id].recurring && !PLANS[id].retired && !PLANS[id].upcoming;
  let plan = null;
  if (cancelada && cancelada.plan && vendible(cancelada.plan)) plan = cancelada.plan;
  if (!plan) {
    const g = (expirados_plan || []).find(x => x && x.tipo === 'mensual' && vendible(x.plan));
    if (g) plan = g.plan;
  }
  if (!plan) return null;
  const precio = montoDe(plan, M);
  if (!(precio > 0)) return null;
  return { plan, moneda: M, precio, precioOferta: mitad(precio, M) };
}
/* ¿Le toca la oferta de REGRESO a este usuario, y cuál? La usan
   my-access (para enseñarla), create-payment y stripe-create (para
   cobrarla): los tres preguntan aquí, así no pueden discrepar.

   Le toca si la oferta sigue disponible y además:
   - canceló y todavía no se le acaba el acceso (registro vigente), o
   - ya no tiene NINGÚN plan recurrente vigente y alguno se le venció.
   Quien tiene una suscripción viva no entra por aquí (su camino es
   "quedarse", api/retencion): si no, podría comprar un plan nuevo al
   50% sin haber cancelado nada. */
async function regresoPara(userId, ents, moneda) {
  if (!(await ofertaDisponible(userId, ents))) return null;
  const { cancelacionVigente } = require('./cancelaciones');
  const cancelada = await cancelacionVigente(userId, ents);
  const recurrentes = (ents || []).filter(e => e && e.active && PLANS[e.plan] && PLANS[e.plan].recurring);
  const vigentes = recurrentes.filter(e => entitlementGrants(e, e.product));
  if (!cancelada && vigentes.length) return null;
  const expirados_plan = recurrentes.filter(e => !entitlementGrants(e, e.product))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map(e => ({ plan: e.plan, tipo: 'mensual' }));
  return ofertaRegreso({ cancelada, expirados_plan, ents, moneda });
}

async function marcaOfertaUsada(userId, detalle) {
  await kvPut(claveUso(userId), { at: new Date().toISOString(), ...detalle });
}

/* Mercado Pago: anota a qué precio hay que regresar esta preapproval
   después del cobro con descuento. */
async function anotaRestauracionMP(preapprovalId, { completo, descuento, moneda }) {
  await kvPut(claveMP(preapprovalId), { completo, descuento, moneda, at: new Date().toISOString() });
}

/* Lo llama api/mp-webhook tras procesar un cobro. Si esta preapproval
   tiene un descuento pendiente de regresar y el cobro que acaba de
   entrar fue el de descuento, sube el monto a su precio completo.
   Devuelve true si restauró. */
async function restauraSiToca(preapprovalId, montoCobrado, token) {
  const r = await kvGet(claveMP(preapprovalId));
  if (!r || r.hecho || r.completo == null) return false;
  /* Solo después del cobro CON descuento. Si MP mandó el aviso de otro
     cobro (uno viejo reenviado, por ejemplo), regresar el precio antes
     de tiempo le quitaría el descuento al cliente. */
  if (montoCobrado != null && Math.abs(Number(montoCobrado) - Number(r.descuento)) > 0.01) return false;
  const res = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto_recurring: { transaction_amount: r.completo, currency_id: r.moneda || 'MXN' } }),
  });
  if (!res.ok) {
    /* Si esto falla el cliente se quedaría al 50% para siempre: que se
       note en los logs. El aviso queda en el KV y el siguiente cobro lo
       vuelve a intentar. */
    console.error('retencion: NO se pudo regresar el precio de', preapprovalId, 'a', r.completo, '— HTTP', res.status);
    return false;
  }
  await kvPut(claveMP(preapprovalId), { ...r, hecho: new Date().toISOString() });
  console.log('retencion: precio regresado a', r.completo, r.moneda, 'en', preapprovalId);
  return true;
}

module.exports = { PCT, mitad, ofertaDisponible, ofertaUsada, ofertaRegreso, regresoPara, marcaOfertaUsada, anotaRestauracionMP, restauraSiToca };
