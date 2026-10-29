/* ============================================================
   Correo propio de Dattip (28-oct-2026).

   Hasta hoy el sitio no mandaba ningún correo: cuando un cobro
   fallaba nadie le avisaba al cliente, y los 3,339 registrados no
   recibían nada. Esto es el canal directo: Resend por HTTP (sin SDK),
   una plantilla base con la marca, y tres correos:

     - pagoFallido  → la liga de pago el mismo día que falla el cobro
                      (api/stripe-webhook) y un recordatorio al día 3
                      (api/email-cobros).
     - jueves       → el pick gratis de la semana a toda la base
                      (api/email-jueves, cron del jueves).
     - marcador     → el reporte del lunes, solo para el dueño
                      (api/email-lunes, cron del lunes).

   Env (Vercel):
     RESEND_API_KEY   llave de Resend (resend.com → API Keys)
     EMAIL_FROM       remitente, p.ej. "Dattip <picks@dattip.com>"
                      (el dominio debe estar verificado en Resend;
                      sin eso Resend solo manda al correo del dueño)
     EMAIL_REPLY_TO   (opcional) a dónde llegan las respuestas
     CRON_SECRET      firma las ligas de baja (ya existe)

   Bajas: la liga "ya no quiero estos correos" lleva el id del usuario
   firmado con HMAC; api/email-baja la verifica y guarda la baja en el
   KV (`email-bajas`). Solo aplica a los correos de marketing (jueves);
   los de cobro son transaccionales y se mandan siempre.
   ============================================================ */
const crypto = require('crypto');
const { kvGet, kvPut } = require('./odds/theoddsapi');

const RESEND = 'https://api.resend.com';
const FROM_DEFAULT = 'Dattip <picks@dattip.com>';
const AZUL = '#2563eb';

function from() { return process.env.EMAIL_FROM || FROM_DEFAULT; }
function siteUrl() {
  const dev = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
  if (dev) return 'http://localhost:' + (process.env.PORT || 3000);
  if (process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL)) return process.env.SITE_URL.replace(/\/$/, '');
  return 'https://dattip.com';
}
function configurado() { return !!process.env.RESEND_API_KEY; }

/* ---------- envío ---------- */
async function enviar({ to, subject, html, text, tag, replyTo }) {
  if (!configurado()) throw new Error('Falta RESEND_API_KEY: el correo no está conectado.');
  const body = { from: from(), to: Array.isArray(to) ? to : [to], subject, html, text };
  if (replyTo || process.env.EMAIL_REPLY_TO) body.reply_to = replyTo || process.env.EMAIL_REPLY_TO;
  if (tag) body.tags = [{ name: 'tipo', value: tag }];
  const r = await fetch(RESEND + '/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (data.message || data.error || JSON.stringify(data)).slice(0, 200));
  return data; // { id }
}

/* Hasta 100 correos por llamada (límite de Resend). Devuelve ids. */
async function enviarLote(mensajes) {
  if (!configurado()) throw new Error('Falta RESEND_API_KEY: el correo no está conectado.');
  const out = [];
  for (let i = 0; i < mensajes.length; i += 100) {
    const lote = mensajes.slice(i, i + 100).map(m => {
      const b = { from: from(), to: [m.to], subject: m.subject, html: m.html, text: m.text };
      if (process.env.EMAIL_REPLY_TO) b.reply_to = process.env.EMAIL_REPLY_TO;
      if (m.tag) b.tags = [{ name: 'tipo', value: m.tag }];
      return b;
    });
    const r = await fetch(RESEND + '/emails/batch', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(lote) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Resend batch ' + r.status + ': ' + (data.message || JSON.stringify(data)).slice(0, 200));
    out.push(...((data.data || []).map(x => x.id)));
  }
  return out;
}

/* ---------- bajas (solo marketing) ---------- */
function secreto() { return process.env.EMAIL_SECRET || process.env.CRON_SECRET || 'dattip-dev'; }
function tokenBaja(userId) { return crypto.createHmac('sha256', secreto()).update(String(userId)).digest('hex').slice(0, 24); }
function verificaBaja(userId, token) {
  const ok = tokenBaja(userId);
  return typeof token === 'string' && token.length === ok.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ok));
}
function urlBaja(userId) { return `${siteUrl()}/api/email-baja?u=${encodeURIComponent(userId)}&t=${tokenBaja(userId)}`; }
async function bajas() { return (await kvGet('email-bajas')) || {}; }
async function marcaBaja(userId) { const b = await bajas(); b[userId] = new Date().toISOString(); await kvPut('email-bajas', b); return b; }

/* ---------- bitácora (últimos 200 envíos) ---------- */
async function anota(entrada) {
  const log = (await kvGet('email-log')) || [];
  log.unshift(Object.assign({ at: new Date().toISOString() }, entrada));
  await kvPut('email-log', log.slice(0, 200));
}
async function bitacora() { return (await kvGet('email-log')) || []; }

/* ---------- plantilla base ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function layout({ titulo, preheader, cuerpo, cta, pie, unsubUrl }) {
  const site = siteUrl();
  const botones = (cta || []).map(c => `<a href="${esc(c.url)}" style="display:inline-block;background:${c.secundario ? '#fff' : AZUL};color:${c.secundario ? AZUL : '#fff'};border:1px solid ${AZUL};text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;margin:6px 8px 6px 0">${esc(c.texto)}</a>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titulo)}</title></head>
<body style="margin:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || '')}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e2e8f0">
<tr><td style="padding:22px 28px 0"><a href="${site}" style="text-decoration:none;color:${AZUL};font-weight:800;font-size:18px;letter-spacing:.5px">DAT•TIP</a></td></tr>
<tr><td style="padding:14px 28px 0"><h1 style="margin:0;font-size:22px;line-height:1.3">${esc(titulo)}</h1></td></tr>
<tr><td style="padding:12px 28px 6px;font-size:16px;line-height:1.55">${cuerpo}</td></tr>
${botones ? `<tr><td style="padding:10px 28px 6px">${botones}</td></tr>` : ''}
<tr><td style="padding:16px 28px 24px;font-size:13px;line-height:1.5;color:#64748b">${pie || ''}</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px"><tr><td style="padding:14px 10px;font-size:12px;line-height:1.5;color:#94a3b8;text-align:center">
Dattip · La data le gana al tipster · <a href="${site}" style="color:#94a3b8">dattip.com</a>${unsubUrl ? ` · <a href="${esc(unsubUrl)}" style="color:#94a3b8">Ya no quiero estos correos</a>` : ''}<br>Si vas a jugar, juega con cabeza. Dattip analiza datos; no promete resultados.
</td></tr></table>
</td></tr></table></body></html>`;
}
const fmtMxn = (n, moneda) => (moneda && moneda.toUpperCase() === 'USD' ? 'US$' : '$') + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/* ---------- 1) pago fallido ---------- */
function pagoFallido({ nombre, plan, monto, moneda, ligaPago, portalUrl, recordatorio }) {
  const hola = nombre ? `Hola ${esc(nombre.split(' ')[0])},` : 'Hola,';
  const titulo = recordatorio ? 'Tu acceso a Dattip sigue en pausa' : 'No pudimos cobrar tu suscripción';
  const cuerpo = recordatorio
    ? `<p style="margin:0 0 12px">${hola}</p><p style="margin:0 0 12px">Hace unos días no pasó el cobro de <b>${esc(plan)}</b> (${fmtMxn(monto, moneda)}) y todavía no se ha podido completar. Si no se paga en los próximos días la suscripción se cancela sola y pierdes tu precio actual.</p><p style="margin:0">Pagar toma un minuto con la liga de abajo; ahí mismo puedes cambiar de tarjeta.</p>`
    : `<p style="margin:0 0 12px">${hola}</p><p style="margin:0 0 12px">El banco rechazó el cobro de <b>${esc(plan)}</b> (${fmtMxn(monto, moneda)}). Pasa seguido por fondos, por límite de la tarjeta o por un bloqueo del banco; no es nada que hayas hecho mal.</p><p style="margin:0">Tu acceso sigue abierto unos días. Para no perderlo, paga con la liga de abajo o cambia la tarjeta ahí mismo.</p>`;
  const cta = [{ texto: 'Pagar o cambiar tarjeta', url: ligaPago }];
  if (portalUrl) cta.push({ texto: 'Ver mi suscripción', url: portalUrl, secundario: true });
  const pie = 'Si ya pagaste, ignora este correo. Si quieres pagar de otra forma, responde este correo y te decimos cómo.';
  const html = layout({ titulo, preheader: `Tu cobro de ${plan} no pasó. Paga en un minuto o cambia tu tarjeta.`, cuerpo, cta, pie });
  const text = `${titulo}\n\n${recordatorio ? 'Hace unos días no pasó el cobro de' : 'El banco rechazó el cobro de'} ${plan} (${fmtMxn(monto, moneda)}).\nPaga o cambia tu tarjeta aquí: ${ligaPago}\n\nSi ya pagaste, ignora este correo.`;
  return { subject: recordatorio ? `Recordatorio: tu cobro de ${plan} sigue pendiente` : `No pasó tu cobro de ${plan} — paga en un minuto`, html, text };
}

/* ---------- 2) el correo del jueves ---------- */
function jueves({ picks, unsubUrl, semana }) {
  const site = siteUrl();
  const filas = picks.map(p => `<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0">
<div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">${esc(p.liga)} · ${esc(p.cuando)}</div>
<div style="font-weight:700;font-size:16px;margin:2px 0">${esc(p.partido)}</div>
<div style="font-size:15px">${esc(p.pick)}${p.prob != null ? ` <span style="display:inline-block;background:#eff6ff;color:${AZUL};font-weight:700;font-size:13px;padding:2px 8px;border-radius:999px;margin-left:4px">${Math.round(p.prob * 100)}%</span>` : ''}</div>
</td></tr>`).join('');
  const cuerpo = `<p style="margin:0 0 10px">Estos son los picks gratis del modelo para los próximos días. Cada uno sale de más de 10,000 simulaciones del partido, no de corazonadas.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${filas}</table>
<p style="margin:14px 0 0;color:#475569;font-size:14px">El tablero completo (todos los partidos, hándicaps, totales y props de jugador) está en tu cuenta.</p>`;
  const html = layout({ titulo: `Los picks gratis de la semana`, preheader: picks.map(p => p.partido).join(' · ').slice(0, 120), cuerpo,
    cta: [{ texto: 'Ver el tablero completo', url: site + '/producto.html' }, { texto: 'Pick gratis de hoy', url: site + '/', secundario: true }],
    pie: 'Recibes este correo porque tienes cuenta en Dattip.', unsubUrl });
  const text = `Los picks gratis de la semana\n\n` + picks.map(p => `${p.liga} · ${p.cuando}\n${p.partido}\n${p.pick}${p.prob != null ? ' · ' + Math.round(p.prob * 100) + '%' : ''}\n`).join('\n') + `\nTablero completo: ${site}/producto.html\nYa no quiero estos correos: ${unsubUrl}`;
  return { subject: `Picks gratis de la semana${semana ? ' · ' + semana : ''}`, html, text };
}

/* ---------- 3) el marcador del lunes (solo el dueño) ---------- */
function marcador({ semana, d }) {
  const fila = (k, v, nota) => `<tr><td style="padding:7px 0;border-top:1px solid #e2e8f0;color:#475569">${esc(k)}</td><td style="padding:7px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:700;white-space:nowrap">${esc(v)}</td></tr>${nota ? `<tr><td colspan="2" style="padding:0 0 6px;font-size:12px;color:#94a3b8">${esc(nota)}</td></tr>` : ''}`;
  const lista = (arr) => arr.length ? `<ul style="margin:6px 0 0;padding-left:18px;color:#475569;font-size:14px">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div style="color:#94a3b8;font-size:14px">Ninguno.</div>';
  const cuerpo = `<p style="margin:0 0 8px;color:#475569">Semana del ${esc(semana)}. Un número primero: <b style="color:#0f172a">${d.cobrosPagados} de ${d.cobrosProgramados} cobros pagados</b>.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px">
${fila('Cobros programados (renovaciones)', String(d.cobrosProgramados))}
${fila('Pagados a la primera', String(d.cobrosPagados))}
${fila('Rechazados', String(d.cobrosRechazados), d.cobrosRechazados ? 'Ya tienen su liga de pago por correo.' : '')}
${fila('Recuperados después de fallar', String(d.recuperados))}
${fila('Ventas de la semana (cobros)', `${d.ventas} · ${fmtMxn(d.ingresos)}`)}
${fila('Ventas nuevas (no renovación)', String(d.ventasNuevas))}
${fila('Registros nuevos', String(d.registros))}
${fila('Suscripciones vivas', `${d.activas} · MRR ${fmtMxn(d.mrr)}`)}
${fila('Canceladas esta semana', String(d.canceladas))}
${fila('Correos: pago fallido / jueves', `${d.mailsCobro} / ${d.mailsJueves}`)}
</table>
<h3 style="font-size:15px;margin:16px 0 4px">Pendientes de cobro ahora</h3>${lista(d.vencidos)}
<h3 style="font-size:15px;margin:16px 0 4px">Cancelaron esta semana</h3>${lista(d.listaCanceladas)}`;
  const html = layout({ titulo: 'Marcador del lunes', preheader: `${d.cobrosPagados} de ${d.cobrosProgramados} cobros pagados · ${d.ventas} ventas · ${d.registros} registros`, cuerpo,
    cta: [{ texto: 'Abrir Stripe', url: 'https://dashboard.stripe.com/' }, { texto: 'Tablero de métricas', url: 'https://claude.ai/artifact/P7LFJYeSmuSAvW764q5ijT', secundario: true }],
    pie: 'Generado automáticamente cada lunes a las 9:00 con datos de Stripe y Supabase.' });
  const text = `Marcador del lunes · semana del ${semana}\nCobros: ${d.cobrosPagados}/${d.cobrosProgramados} pagados, ${d.cobrosRechazados} rechazados, ${d.recuperados} recuperados\nVentas: ${d.ventas} (${fmtMxn(d.ingresos)}), nuevas ${d.ventasNuevas}\nRegistros: ${d.registros}\nVivas: ${d.activas} · MRR ${fmtMxn(d.mrr)} · canceladas ${d.canceladas}\nVencidos: ${d.vencidos.join('; ') || 'ninguno'}`;
  return { subject: `Marcador: ${d.cobrosPagados}/${d.cobrosProgramados} cobros · ${d.ventas} ventas · ${d.registros} registros`, html, text };
}

module.exports = { configurado, enviar, enviarLote, tokenBaja, verificaBaja, urlBaja, bajas, marcaBaja, anota, bitacora, layout, plantillas: { pagoFallido, jueves, marcador }, siteUrl };
