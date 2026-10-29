/* ============================================================
   /api/email-lunes — el marcador del lunes, solo para el dueño.
   Cron de Vercel (lunes 9:00 CDMX). Cobros pagados contra
   programados, rechazos y recuperados, ventas, registros, vivas y
   canceladas de los últimos 7 días. Datos de Stripe y Supabase.

   GET ?action=preview → el HTML (admin)
   GET (cron)          → lo manda al correo del admin
   ============================================================ */
const Stripe = require('stripe');
const { quien, ADMIN_EMAILS } = require('../lib/auth-cron');
const { getAdmin } = require('../lib/supabaseAdmin');
const email = require('../lib/email');

const USD_MXN = 18.5;
const d10 = t => new Date(t * 1000).toISOString().slice(0, 10);

async function datos(now = Date.now()) {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const desde = Math.floor(now / 1000) - 7 * 86400;
  /* renovaciones de la semana: facturas de ciclo creadas en los 7 días */
  const inv = []; for await (const i of stripe.invoices.list({ created: { gte: desde }, limit: 100 })) inv.push(i);
  const renov = inv.filter(i => i.billing_reason === 'subscription_cycle');
  const pagadasPrimera = renov.filter(i => i.status === 'paid' && i.attempt_count <= 1).length;
  const recuperados = renov.filter(i => i.status === 'paid' && i.attempt_count > 1).length;
  const rechazados = renov.filter(i => i.status === 'open' && i.attempt_count >= 1).length;
  /* ventas: cobros exitosos de la semana (Stripe) */
  const ch = []; for await (const c of stripe.charges.list({ created: { gte: desde }, limit: 100 })) ch.push(c);
  const ok = ch.filter(c => c.status === 'succeeded');
  const ingresos = ok.reduce((s, c) => s + (c.amount / 100) * (c.currency === 'usd' ? USD_MXN : 1), 0);
  const ventasNuevas = ok.filter(c => c.description !== 'Subscription update').length;
  /* vivas, MRR y canceladas */
  const subs = []; for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100 })) subs.push(s);
  const vivas = subs.filter(s => ['active', 'past_due'].includes(s.status));
  const mrr = vivas.reduce((s, x) => { const p = x.items.data[0] && x.items.data[0].price; return s + (p ? (p.unit_amount / 100) * (p.currency === 'usd' ? USD_MXN : 1) : 0); }, 0);
  const canceladas = subs.filter(s => s.status === 'canceled' && (s.canceled_at || s.ended_at || 0) >= desde);
  const listaCanceladas = [];
  for (const s of canceladas) { let em = ''; try { em = (await stripe.customers.retrieve(s.customer)).email || ''; } catch {} listaCanceladas.push(`${em} · ${(s.metadata || {}).plan || ''} · ${d10(s.canceled_at || s.ended_at)}`); }
  /* vencidos ahora */
  const open = await stripe.invoices.list({ status: 'open', limit: 50 });
  const vencidos = open.data.filter(i => i.collection_method === 'charge_automatically' && i.attempt_count >= 1 && (now / 1000 - i.created) < 45 * 86400)
    .map(i => `${i.customer_email} · ${(i.amount_due / 100)} ${i.currency.toUpperCase()} · ${i.attempt_count} intentos${i.next_payment_attempt ? ' · reintento ' + d10(i.next_payment_attempt) : ''}`);
  /* registros nuevos (Supabase) */
  const sb = getAdmin(); let registros = 0; let page = 1; const lim = new Date(desde * 1000).toISOString();
  while (true) { const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 }); if (error) throw error; registros += data.users.filter(u => u.created_at >= lim).length; if (data.users.length < 1000) break; page++; }
  /* correos mandados en la semana */
  const log = await email.bitacora(); const limIso = new Date(desde * 1000).toISOString();
  const mailsCobro = log.filter(l => l.at >= limIso && /^cobro/.test(l.tipo || '') && !l.error).length;
  const mailsJueves = log.filter(l => l.at >= limIso && l.tipo === 'jueves').reduce((s, l) => s + (parseInt(l.to) || 0), 0);
  return { cobrosProgramados: renov.length, cobrosPagados: pagadasPrimera, cobrosRechazados: rechazados, recuperados, ventas: ok.length, ingresos: Math.round(ingresos), ventasNuevas, registros, activas: vivas.length, mrr: Math.round(mrr), canceladas: canceladas.length, listaCanceladas, vencidos, mailsCobro, mailsJueves };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rol = await quien(req);
  if (!rol) { res.setHeader('Content-Type', 'application/json'); return res.status(403).json({ error: 'Acceso no autorizado.' }); }
  const action = (req.query && req.query.action) || null;
  try {
    const d = await datos();
    const semana = new Date(Date.now() - 7 * 86400000).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' });
    const msg = email.plantillas.marcador({ semana, d });
    if (action === 'preview') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).send(msg.html); }
    res.setHeader('Content-Type', 'application/json');
    if (action === 'datos') return res.status(200).json(d);
    if (!email.configurado()) return res.status(200).json({ ok: false, error: 'Falta RESEND_API_KEY.', datos: d });
    const r = await email.enviar({ to: ADMIN_EMAILS[0], subject: msg.subject, html: msg.html, text: msg.text, tag: 'marcador' });
    await email.anota({ tipo: 'marcador', to: ADMIN_EMAILS[0], asunto: msg.subject, id: r.id });
    return res.status(200).json({ ok: true, id: r.id, datos: d });
  } catch (e) {
    console.error('email-lunes:', e);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: e.message });
  }
};
