/* ============================================================
   Aviso de cobro fallido (28-oct-2026).

   Lo comparten el webhook de Stripe (`invoice.payment_failed`, el
   mismo día que falla) y el cron diario api/email-cobros (recordatorio
   al tercer día y red de seguridad si el webhook no llegó).
   Registro en el KV `email-cobros`: { [invoiceId]: { enviado, recordado } }.
   ============================================================ */
const Stripe = require('stripe');
const { kvGet, kvPut } = require('./odds/theoddsapi');
const email = require('./email');

const DIAS_RECORDATORIO = 3;

function stripe() { return Stripe(process.env.STRIPE_SECRET_KEY); }
async function registro() { return (await kvGet('email-cobros')) || {}; }

/* Nombre legible del plan desde la línea de la factura:
   "1 × Modelo NFL — Suscripción mensual (at $349.00 / month)" → "Modelo NFL — Suscripción mensual" */
function nombrePlan(inv) {
  const l = inv.lines && inv.lines.data && inv.lines.data[0];
  const d = (l && l.description) || 'tu suscripción';
  return d.replace(/^\d+\s*×\s*/, '').replace(/\s*\(at .*?\)\s*$/, '').trim();
}

/* Manda el correo (primero o recordatorio) y lo anota. Devuelve lo que
   hizo; nunca lanza hacia el webhook (un error de correo no debe
   responder 500 a Stripe). */
async function avisa(inv, { recordatorio = false } = {}) {
  const to = inv.customer_email;
  if (!to) return { ok: false, motivo: 'factura sin correo' };
  if (!inv.hosted_invoice_url) return { ok: false, motivo: 'factura sin liga de pago' };
  const reg = await registro();
  const r = reg[inv.id] || {};
  if (!recordatorio && r.enviado) return { ok: true, repetido: true };
  if (recordatorio && r.recordado) return { ok: true, repetido: true };
  let nombre = inv.customer_name || '';
  if (!nombre && inv.customer) { try { const c = await stripe().customers.retrieve(inv.customer); nombre = c.name || ''; } catch {} }
  const plan = nombrePlan(inv);
  const msg = email.plantillas.pagoFallido({ nombre, plan, monto: inv.amount_due / 100, moneda: inv.currency, ligaPago: inv.hosted_invoice_url, portalUrl: email.siteUrl() + '/mis-modelos.html', recordatorio });
  try {
    const res = await email.enviar({ to, subject: msg.subject, html: msg.html, text: msg.text, tag: recordatorio ? 'cobro-recordatorio' : 'cobro-fallido' });
    reg[inv.id] = Object.assign(r, recordatorio ? { recordado: new Date().toISOString() } : { enviado: new Date().toISOString() }, { to, plan, monto: inv.amount_due / 100, moneda: inv.currency });
    await kvPut('email-cobros', reg);
    await email.anota({ tipo: recordatorio ? 'cobro-recordatorio' : 'cobro-fallido', to, asunto: msg.subject, id: res.id, factura: inv.id });
    return { ok: true, id: res.id };
  } catch (e) {
    await email.anota({ tipo: recordatorio ? 'cobro-recordatorio' : 'cobro-fallido', to, asunto: msg.subject, factura: inv.id, error: e.message });
    return { ok: false, motivo: e.message };
  }
}

/* Barrido diario: facturas abiertas de suscripción con al menos un
   intento fallido. Primer correo si no se mandó (p.ej. el fallo fue
   antes de que existiera el webhook) y recordatorio al día 3. */
async function barrido({ ahora = Date.now() } = {}) {
  const st = stripe();
  const open = await st.invoices.list({ status: 'open', limit: 100 });
  const reg = await registro();
  const hechos = [];
  for (const inv of open.data) {
    if (inv.collection_method !== 'charge_automatically') continue;
    if (!inv.attempt_count) continue;                                   // todavía no se ha intentado
    if ((ahora / 1000 - inv.created) > 45 * 86400) continue;            // viejas: no molestar
    const r = reg[inv.id] || {};
    if (!r.enviado) { hechos.push({ factura: inv.id, to: inv.customer_email, que: 'primero', ...(await avisa(inv)) }); continue; }
    const dias = (ahora - new Date(r.enviado).getTime()) / 86400000;
    if (!r.recordado && dias >= DIAS_RECORDATORIO) hechos.push({ factura: inv.id, to: inv.customer_email, que: 'recordatorio', ...(await avisa(inv, { recordatorio: true })) });
  }
  return { abiertas: open.data.length, hechos };
}

module.exports = { avisa, barrido, registro, nombrePlan };
