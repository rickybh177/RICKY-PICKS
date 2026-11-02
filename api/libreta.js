/* ============================================================
   /api/libreta — la libreta de picks (lib/libreta.js).
   Cron de Vercel cada hora: foto de los PICK de lo que arranca en
   las próximas 30 h y calificación de lo que ya terminó.

   GET (cron)              → foto + calificar
   GET ?action=semana      → balance de la última semana cerrada, por liga (admin)
   GET ?action=semanas&n=4 → las últimas n semanas (admin)
   GET ?action=lista&desde=AAAA-MM-DD&hasta=AAAA-MM-DD → entradas crudas (admin)
   ============================================================ */
const { quien } = require('../lib/auth-cron');
const libreta = require('../lib/libreta');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const rol = await quien(req);
  if (!rol) return res.status(403).json({ error: 'Acceso no autorizado.' });
  const q = req.query || {};
  try {
    if (q.action === 'semana') return res.status(200).json((await libreta.semanas(1))[0]);
    if (q.action === 'semanas') return res.status(200).json(await libreta.semanas(Math.min(12, parseInt(q.n, 10) || 4)));
    if (q.action === 'lista') {
      const desde = q.desde ? Date.parse(q.desde + 'T06:00:00Z') : libreta.lunesDe(Date.now());
      const hasta = q.hasta ? Date.parse(q.hasta + 'T06:00:00Z') + 86400e3 : Date.now() + 7 * 86400e3;
      return res.status(200).json(await libreta.entradas(desde, hasta));
    }
    const foto = await libreta.foto();
    const calif = await libreta.calificar();
    return res.status(200).json({ ok: true, foto, calificar: calif });
  } catch (e) {
    console.error('libreta:', e);
    return res.status(500).json({ error: e.message });
  }
};
