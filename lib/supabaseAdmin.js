/* ============================================================
   Cliente de Supabase con service role (solo backend).
   Usa la SERVICE ROLE KEY: NUNCA la expongas en el navegador.
   ============================================================ */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _admin = null;
function getAdmin() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.');
  }
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

// Verifica el token de sesión (JWT) que manda el navegador y regresa el usuario.
async function getUserFromToken(token) {
  if (!token) return null;
  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

const ADMIN_EMAILS = ['rickybh17@gmail.com'];

// Lee el acceso (entitlement) activo de un usuario.
// Las cuentas admin tienen acceso torneo gratuito automático.
async function getEntitlement(userId, userEmail) {
  if (!userId) return null;
  if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
    return { plan: 'torneo', active: true };
  }
  const admin = getAdmin();
  const { data, error } = await admin
    .from('entitlements')
    .select('plan, active')
    .eq('user_id', userId)
    .eq('active', true)
    .limit(1);
  if (error || !data || !data.length) return null;
  return data[0];
}

// Otorga (o renueva) el acceso de un usuario tras un pago aprobado.
async function grantEntitlement(userId, plan) {
  const admin = getAdmin();
  const { error } = await admin
    .from('entitlements')
    .upsert(
      { user_id: userId, plan, active: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
  return true;
}

// Lista todos los usuarios con sus planes (solo para admin).
async function getAllUsersWithPlans() {
  const admin = getAdmin();
  const { data: { users }, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) throw usersErr;
  const { data: ents, error: entsErr } = await admin
    .from('entitlements')
    .select('user_id, plan, active, updated_at');
  if (entsErr) throw entsErr;
  const entMap = {};
  (ents || []).forEach(e => { entMap[e.user_id] = e; });
  return (users || []).map(u => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in: u.last_sign_in_at,
    plan: entMap[u.id] ? entMap[u.id].plan : null,
    active: entMap[u.id] ? entMap[u.id].active : false,
    plan_updated: entMap[u.id] ? entMap[u.id].updated_at : null,
  }));
}

module.exports = { getAdmin, getUserFromToken, getEntitlement, grantEntitlement, getAllUsersWithPlans };
