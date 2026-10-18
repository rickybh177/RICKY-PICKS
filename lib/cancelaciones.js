/* ============================================================
   Registro de cancelaciones (17-oct-2026).

   Hasta hoy el sitio no guardaba en ningún lado que alguien canceló:
   el aviso "conservas tu acceso hasta…" salía una sola vez, en la
   respuesta del botón, y al recargar Mis modelos el cliente volvía a
   ver "Cancelar suscripción" como si nada. Peor: si la cancelación la
   hacía el dueño a mano (en el panel de la pasarela), el cliente nunca
   se enteraba de la fecha.

   Aquí se guarda, por usuario: cuándo canceló, hasta cuándo tiene
   acceso y por qué pasarela. Vive en el mismo KV que los picks gratis
   y la elección del plan de tres (bucket de Supabase Storage).

   La fecha de acceso sale de los ENTITLEMENTS, no de la pasarela: es
   lo que de verdad abre o cierra los modelos, así que el cliente ve la
   misma fecha en la que se le apagan.
   ============================================================ */
const { kvGet, kvPut } = require('./odds/theoddsapi');
const { PLANS, entitlementExpiry } = require('./plans');

const clave = userId => `cancelacion-${userId}`;

/* Hasta cuándo tiene acceso por sus planes RECURRENTES vigentes (la
   fecha más tardía), o null si no tiene ninguno. */
function accesoHasta(ents) {
  let max = null;
  for (const e of ents || []) {
    if (!e || !e.active) continue;
    const def = PLANS[e.plan];
    if (!def || !def.recurring) continue;
    const fin = entitlementExpiry(e.plan, e.updated_at);
    if (fin && (!max || fin > max)) max = fin;
  }
  return max ? new Date(max).toISOString() : null;
}

async function marcaCancelada(userId, { hasta, via, plan, precio, moneda }) {
  /* plan/precio/moneda: lo que pagaba. La oferta de regreso le respeta
     ese precio en vez de cobrarle la lista (ver lib/retencion). */
  const valor = { at: new Date().toISOString(), hasta: hasta || null, via: via || null,
    plan: plan || null, precio: precio != null ? precio : null, moneda: moneda || null };
  await kvPut(clave(userId), valor);
  return valor;
}

/* La cancelación VIGENTE de este usuario, o null. Deja de contar sola
   cuando ya pasó la fecha de acceso, o si después de cancelar volvió a
   comprar (algún plan recurrente se renovó/otorgó después de `at`). */
async function cancelacionVigente(userId, ents) {
  const c = await kvGet(clave(userId));
  if (!c || !c.at) return null;
  if (c.hasta && Date.parse(c.hasta) <= Date.now()) return null;
  const at = Date.parse(c.at);
  const volvio = (ents || []).some(e => e && e.active && PLANS[e.plan] && PLANS[e.plan].recurring
    && Date.parse(e.updated_at) > at);
  return volvio ? null : c;
}

/* "16 de noviembre" — así se le dice la fecha al cliente. */
function fechaMX(iso) {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' });
}

module.exports = { accesoHasta, marcaCancelada, cancelacionVigente, fechaMX };
