/* ============================================================
   /api/huella — recibe los avisos de public/huella.js.
   POST { evento: 'pagina'|'salida', liga, sid, movil, segundos }
   con el token de la sesión en Authorization. Sin sesión válida no
   se guarda nada. El admin no se registra (ensuciaría el uso).
   ============================================================ */
const { getUserFromToken } = require('../lib/supabaseAdmin');
const { ADMIN_EMAILS } = require('../lib/auth-cron');
const uso = require('../lib/uso');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST.' });
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(204).end();
  try {
    const user = await getUserFromToken(token).catch(() => null);
    if (!user || ADMIN_EMAILS.includes(user.email)) return res.status(204).end();
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    await uso.registra(user.id, { evento: b.evento, liga: b.liga, sid: b.sid, movil: !!b.movil, segundos: b.segundos });
    return res.status(204).end();
  } catch (e) {
    console.error('huella:', e.message);
    return res.status(204).end();
  }
};
