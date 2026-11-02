/* ============================================================
   /api/seguimiento — el panel de seguimiento semanal (solo admin).
   Ver lib/seguimiento.js.

   GET                → todos los clientes vivos con ficha y mensaje
   GET ?u=<userId>    → la ficha de uno (aunque no tenga plan vivo)
   GET ?fresco=1      → rehace el caché de pagos (Stripe + MP)
   POST { u, enviado } → marca (o desmarca) el mensaje de la semana
   ============================================================ */
const { quien } = require('../lib/auth-cron');
const seguimiento = require('../lib/seguimiento');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const rol = await quien(req);
  if (rol !== 'admin' && rol !== 'dev') return res.status(403).json({ error: 'Acceso no autorizado.' });
  try {
    if (req.method === 'POST') {
      let b = req.body || {};
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
      if (!b.u) return res.status(400).json({ error: 'Falta u.' });
      const envios = await seguimiento.marcaEnviado(String(b.u), { quitar: b.enviado === false });
      return res.status(200).json({ ok: true, enviado: envios[b.u] || null });
    }
    const q = req.query || {};
    const data = await seguimiento.construir({ soloUid: q.u || null, fresco: q.fresco === '1' });
    if (q.u) return res.status(200).json(data.clientes[0] || { error: 'Sin datos para ese cliente.' });
    return res.status(200).json(data);
  } catch (e) {
    console.error('seguimiento:', e);
    return res.status(500).json({ error: e.message });
  }
};
