/* ============================================================
   /api/email-cobros — barrido diario de cobros rechazados.
   Cron de Vercel (10:00 CDMX): manda la liga de pago a quien no la
   recibió por el webhook y el recordatorio al día 3.
   GET ?action=status → registro y bitácora (admin).
   ============================================================ */
const { quien } = require('../lib/auth-cron');
const { barrido, registro } = require('../lib/cobros');
const email = require('../lib/email');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const rol = await quien(req);
  if (!rol) return res.status(403).json({ error: 'Acceso no autorizado.' });
  const action = (req.query && req.query.action) || null;
  try {
    if (action === 'status') return res.status(200).json({ configurado: email.configurado(), registro: await registro(), bitacora: (await email.bitacora()).slice(0, 50) });
    if (!email.configurado()) return res.status(200).json({ ok: false, error: 'Falta RESEND_API_KEY.' });
    const out = await barrido();
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    console.error('email-cobros:', e);
    return res.status(500).json({ error: e.message });
  }
};
