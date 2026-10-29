/* ============================================================
   ¿Quién llama a un endpoint de automatización?
   - 'cron'  → Vercel Cron (Authorization: Bearer $CRON_SECRET)
   - 'admin' → sesión de Supabase del correo admin
   - 'dev'   → desarrollo local (sin Vercel)
   - null    → nadie con permiso
   Copiado de api/ig-daily.js para que los crons de correo usen la
   misma regla sin duplicarla una tercera vez.
   ============================================================ */
const { getUserFromToken } = require('./supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

async function quien(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return 'cron';
  if (token) {
    const user = await getUserFromToken(token).catch(() => null);
    if (user && ADMIN_EMAILS.includes(user.email)) return 'admin';
  }
  if (IS_DEV) return 'dev';
  return null;
}

module.exports = { quien, ADMIN_EMAILS, IS_DEV };
