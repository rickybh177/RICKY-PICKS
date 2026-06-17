/* ============================================================
   GET /api/admin-users
   Solo accesible para el administrador del sitio.
   Devuelve todos los usuarios con sus planes y fechas.
   ============================================================ */
const { getUserFromToken, getAllUsersWithPlans } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = await getUserFromToken(token);
  if (!user || !ADMIN_EMAILS.includes(user.email)) {
    return res.status(403).json({ error: 'Acceso no autorizado.' });
  }
  try {
    const users = await getAllUsersWithPlans();
    return res.status(200).json({ users });
  } catch (e) {
    console.error('admin-users:', e);
    return res.status(500).json({ error: 'Error al obtener datos.' });
  }
};
