/* ============================================================
   /api/email-jueves — el correo del jueves a toda la base.
   Cron de Vercel (jueves 16:00 CDMX). Manda los picks gratis de los
   próximos 7 días (los MISMOS que enseña el sitio) a todas las
   cuentas de Supabase que no se hayan dado de baja.

   GET ?action=preview → el HTML tal como lo verá un cliente (admin)
   GET ?action=test    → lo manda solo al correo del admin
   GET (cron)          → lo manda a toda la base, en lotes de 100
   ============================================================ */
const { quien, ADMIN_EMAILS } = require('../lib/auth-cron');
const { LIGAS, normaliza, getJson, baseUrl, hoyMx } = require('../lib/ig/plan');
const { getAdmin } = require('../lib/supabaseAdmin');
const { kvGet, kvPut } = require('../lib/odds/theoddsapi');
const email = require('../lib/email');

const MX_TZ = 'America/Mexico_City';
const DIAS = 7;

/* Picks gratis vigentes en los próximos 7 días, en el orden del landing. */
async function picksSemana(now = Date.now()) {
  const base = baseUrl();
  const crudos = await Promise.all(LIGAS.map(async cfg => {
    try { return { cfg, n: normaliza(cfg, await getJson(base + cfg.api)) }; }
    catch (e) { return { cfg, n: null, error: e.message }; }
  }));
  const picks = [];
  for (const { cfg, n } of crudos) {
    if (!n || !n.date || !n.pick) continue;
    const t = new Date(n.date).getTime();
    if (!(t > now) || t > now + DIAS * 86400000) continue;
    if (n.state && n.state !== 'pre') continue;
    picks.push({
      liga: cfg.nombre, partido: `${n.away.name} @ ${n.home.name}`,
      cuando: new Date(n.date).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: MX_TZ }).replace(/\./g, ''),
      pick: n.pick.label || 'Pick del modelo', prob: n.pick.prob != null ? n.pick.prob : null, fecha: n.date,
    });
  }
  return picks;
}

async function destinatarios() {
  const sb = getAdmin();
  const bajas = await email.bajas();
  const out = []; let page = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email && !bajas[u.id]) out.push({ id: u.id, email: u.email });
    if (data.users.length < 1000) break;
    page++;
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rol = await quien(req);
  if (!rol) { res.setHeader('Content-Type', 'application/json'); return res.status(403).json({ error: 'Acceso no autorizado.' }); }
  const action = (req.query && req.query.action) || null;
  try {
    const picks = await picksSemana();
    const semana = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: MX_TZ });
    if (action === 'preview') {
      const msg = email.plantillas.jueves({ picks, unsubUrl: email.urlBaja('preview'), semana });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(msg.html);
    }
    res.setHeader('Content-Type', 'application/json');
    if (!picks.length) return res.status(200).json({ ok: true, skipped: 'sin picks para la semana' });
    if (!email.configurado()) return res.status(200).json({ ok: false, error: 'Falta RESEND_API_KEY.' });
    if (action === 'test') {
      const msg = email.plantillas.jueves({ picks, unsubUrl: email.urlBaja('test'), semana });
      const r = await email.enviar({ to: ADMIN_EMAILS[0], subject: '[PRUEBA] ' + msg.subject, html: msg.html, text: msg.text, tag: 'jueves-prueba' });
      return res.status(200).json({ ok: true, id: r.id, picks: picks.length });
    }
    /* el envío real: una vez por semana (candado por fecha) */
    const clave = 'jueves-' + hoyMx(Date.now());
    const ya = (await kvGet('email-jueves')) || {};
    if (ya[clave] && !(req.query && req.query.force)) return res.status(200).json({ ok: true, skipped: 'ya se mandó hoy', ...ya[clave] });
    const gente = await destinatarios();
    const mensajes = gente.map(u => { const m = email.plantillas.jueves({ picks, unsubUrl: email.urlBaja(u.id), semana }); return { to: u.email, subject: m.subject, html: m.html, text: m.text, tag: 'jueves' }; });
    const ids = await email.enviarLote(mensajes);
    ya[clave] = { at: new Date().toISOString(), enviados: ids.length, picks: picks.map(p => p.partido) };
    await kvPut('email-jueves', ya);
    await email.anota({ tipo: 'jueves', to: `${ids.length} cuentas`, asunto: mensajes[0] && mensajes[0].subject });
    return res.status(200).json({ ok: true, enviados: ids.length, picks: picks.length });
  } catch (e) {
    console.error('email-jueves:', e);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: e.message });
  }
};
module.exports.picksSemana = picksSemana;
