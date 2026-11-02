/* ============================================================
   /api/semana?u=<userId>&t=<firma> — los datos de "Tu semana" para
   la página personal del cliente (public/semana.html). La liga va en
   el WhatsApp del seguimiento, firmada con HMAC: sin la firma correcta
   no hay datos. Solo trae sus ligas; nada de cobros.
   ============================================================ */
const seguimiento = require('../lib/seguimiento');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const q = req.query || {};
  const u = String(q.u || ''), t = String(q.t || '');
  if (!/^[0-9a-f-]{36}$/.test(u) || !seguimiento.verificaSemana(u, t)) return res.status(404).json({ error: 'Liga no válida.' });
  try {
    const data = await seguimiento.paraCliente(u);
    if (!data) return res.status(404).json({ error: 'Liga no válida.' });
    return res.status(200).json(data);
  } catch (e) {
    console.error('semana:', e);
    return res.status(500).json({ error: 'No pudimos cargar tu semana. Intenta en un rato.' });
  }
};
