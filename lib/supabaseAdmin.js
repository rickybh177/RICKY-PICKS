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

// Un usuario puede tener VARIOS entitlements activos a la vez: Mundial
// (mexico/individual/torneo), MLB (mlb_*) y Liga MX (mx_*). Se guardan
// como filas separadas en `entitlements`, distinguidas por `product`.
// El combo (combo_*) otorga mlb + mx en DOS filas con el mismo plan.
function productForPlan(plan) {
  if (plan && plan.startsWith('mlb_')) return 'mlb';
  if (plan && plan.startsWith('mx_')) return 'mx';
  if (plan && plan.startsWith('combo_')) return 'combo';
  return 'mundial';
}

// Todos los productos que cubre un plan (el combo cubre dos).
function productsForPlan(plan) {
  if (plan && plan.startsWith('combo_')) return ['mlb', 'mx'];
  return [productForPlan(plan)];
}

// Lee el acceso (entitlement) activo de un usuario para un producto.
// El producto se deriva del `plan` en JS (nunca de una columna de la
// BD), así que esto funciona haya corrido o no la migración de
// `entitlements` que agrega la columna `product`.
// Si no se pasa `product`, regresa cualquiera de los activos (compat).
// Las cuentas admin tienen acceso completo automático a ambos productos.
async function getEntitlement(userId, userEmail, product) {
  if (!userId) return null;
  if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
    if (product === 'mlb') return { plan: 'mlb_fundador', active: true, product: 'mlb' };
    if (product === 'mx') return { plan: 'mx_fundador', active: true, product: 'mx' };
    return { plan: 'torneo', active: true, product: 'mundial' };
  }
  const admin = getAdmin();
  const { data, error } = await admin
    .from('entitlements')
    .select('plan, active, updated_at')
    .eq('user_id', userId)
    .eq('active', true);
  if (error || !data || !data.length) return null;
  if (!product) return data[0];
  const match = data.find(e => productsForPlan(e.plan).includes(product));
  return match || null;
}

// Regresa TODOS los entitlements activos de un usuario (uno por producto).
async function getEntitlements(userId, userEmail) {
  if (!userId) return [];
  if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
    return [
      { plan: 'torneo', active: true, product: 'mundial' },
      { plan: 'mlb_fundador', active: true, product: 'mlb' },
      { plan: 'mx_fundador', active: true, product: 'mx' },
    ];
  }
  const admin = getAdmin();
  const { data, error } = await admin
    .from('entitlements')
    .select('plan, active, updated_at')
    .eq('user_id', userId)
    .eq('active', true);
  if (error || !data) return [];
  // Un plan combo cubre dos productos; expandimos y deduplicamos por
  // producto (el combo se guarda en 2 filas con el mismo plan, así que
  // la segunda fila ya no aporta productos nuevos).
  const out = [];
  for (const e of data) {
    for (const p of productsForPlan(e.plan)) {
      if (!out.some(x => x.product === p)) out.push({ ...e, product: p });
    }
  }
  return out;
}

// Otorga (o renueva) el acceso de un usuario tras un pago aprobado.
// Intenta el esquema nuevo (una fila por producto, sin pisar la otra).
// Si la migración de `entitlements` (columna `product` + índice único
// user_id+product) todavía no se corrió en Supabase, esto cae de vuelta
// al esquema viejo (una sola fila por usuario) para que las compras
// SIGAN funcionando mientras se corre la migración.
async function grantEntitlement(userId, plan) {
  const admin = getAdmin();
  const now = new Date().toISOString();
  const products = productsForPlan(plan); // el combo escribe 2 filas (mlb y mx)

  let attempt1Error = null;
  for (const product of products) {
    const attempt1 = await admin
      .from('entitlements')
      .upsert(
        { user_id: userId, plan, product, active: true, updated_at: now },
        { onConflict: 'user_id,product' }
      );
    if (attempt1.error) { attempt1Error = attempt1.error; break; }
  }
  if (!attempt1Error) return true;
  if (products.length > 1) throw attempt1Error; // combo requiere la migración; sin ella no hay fallback seguro
  const product = products[0];

  // Fallback: esquema viejo (migración pendiente). PELIGRO conocido:
  // con una sola fila por usuario, un upsert ciego PISA el acceso del
  // OTRO producto (así se perdieron Mundiales al comprar MLB el
  // 10-17 jul 2026). Si la fila existente es de otro producto y está
  // activa, NO la tocamos: fallamos fuerte para que el webhook
  // reintente después de correr la migración.
  const existing = await admin
    .from('entitlements')
    .select('plan, active')
    .eq('user_id', userId)
    .maybeSingle();
  if (!existing.error && existing.data && existing.data.active &&
      productForPlan(existing.data.plan) !== product) {
    throw new Error(
      `grantEntitlement: el usuario ${userId} ya tiene ${existing.data.plan} activo (otro producto). ` +
      'CORRE scripts/migrate-entitlements-product.sql en Supabase para poder tener ambos.'
    );
  }
  const attempt2 = await admin
    .from('entitlements')
    .upsert(
      { user_id: userId, plan, active: true, updated_at: now },
      { onConflict: 'user_id' }
    );
  if (attempt2.error) throw attempt2.error;
  return true;
}

// Lista todos los usuarios con sus planes (solo para admin).
async function getAllUsersWithPlans() {
  const admin = getAdmin();
  const users = [];
  let page = 1;
  while (true) {
    const { data, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (usersErr) throw usersErr;
    const batch = data.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
    page++;
  }
  const { data: ents, error: entsErr } = await admin
    .from('entitlements')
    .select('user_id, plan, active, updated_at');
  if (entsErr) throw entsErr;
  // Un usuario puede tener 2 filas (mundial + mlb). Agrupamos por user_id
  // y mantenemos `plan`/`active`/`plan_updated` (el más reciente) para no
  // romper el dashboard actual, más un arreglo `plans` con ambos si existen.
  const entMap = {};
  (ents || []).forEach(e => {
    (entMap[e.user_id] = entMap[e.user_id] || []).push({ ...e, product: productForPlan(e.plan) });
  });
  return (users || []).map(u => {
    const list = entMap[u.id] || [];
    const primary = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at,
      plan: primary ? primary.plan : null,
      active: primary ? primary.active : false,
      plan_updated: primary ? primary.updated_at : null,
      plans: list,
    };
  });
}

module.exports = { getAdmin, getUserFromToken, getEntitlement, getEntitlements, grantEntitlement, getAllUsersWithPlans, productForPlan, productsForPlan };
