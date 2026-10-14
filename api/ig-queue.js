/* ============================================================
   /api/ig-queue — publica los partidos PROGRAMADOS de Instagram.

   El cron de Vercel lo dispara cada 5 minutos (vercel.json). Lee la
   cola (lib/ig/publish: `ig-daily-queue`) y lo que ya esté en su
   hora lo publica con el mismo carrusel que "Un partido específico"
   del panel. El tablero completo lo pide con x-internal-auth
   (CRON_SECRET) porque el cron no tiene sesión de Supabase.

   Quién puede llamarlo: el cron (Bearer CRON_SECRET), el admin, dev.
   ============================================================ */
const pub = require('../lib/ig/publish');
const { publicaPartido } = require('./ig-daily');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  let ok = IS_DEV || (process.env.CRON_SECRET && token === process.env.CRON_SECRET);
  if (!ok && token) {
    const user = await getUserFromToken(token).catch(() => null);
    ok = !!(user && ADMIN_EMAILS.includes(user.email));
  }
  if (!ok) return res.status(403).json({ error: 'Acceso no autorizado.' });

  const ahora = Date.now();
  const items = await pub.cola();
  const debidos = items.filter(i => i.status === 'pending' && new Date(i.at).getTime() <= ahora);
  if (!debidos.length) return res.status(200).json({ ok: true, publicados: 0, pendientes: items.filter(i => i.status === 'pending').length });

  if (!(await pub.tomaCandado())) return res.status(200).json({ ok: false, error: 'Ya hay una corrida en curso.' });
  const resultados = [];
  try {
    for (const it of debidos) {
      /* se marca ANTES de publicar: si la lambda muriera a media
         publicación, el siguiente cron no lo repetiría */
      await pub.actualizaCola(it.id, { status: 'running' });
      try {
        const out = await publicaPartido({ liga: it.liga, equipo: it.equipo, gameId: it.game },
          { 'x-internal-auth': process.env.CRON_SECRET || '' }, 'programado');
        await pub.actualizaCola(it.id, { status: 'done', permalink: out.permalink, done_at: new Date().toISOString() });
        resultados.push({ ok: true, id: it.id, partido: out.partido, permalink: out.permalink });
      } catch (e) {
        console.error('ig-queue:', it, e);
        await pub.actualizaCola(it.id, { status: 'error', error: e.message });
        await pub.anota({ ok: false, modo: 'programado', entradas: [`${it.liga}: ${it.equipo || it.game}`], error: e.message });
        resultados.push({ ok: false, id: it.id, error: e.message });
      }
    }
  } finally {
    await pub.sueltaCandado();
  }
  return res.status(200).json({ ok: resultados.every(r => r.ok), publicados: resultados.filter(r => r.ok).length, resultados });
};
