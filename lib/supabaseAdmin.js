/* ============================================================
   Cliente de Supabase con service role (solo backend).
   Usa la SERVICE ROLE KEY: NUNCA la expongas en el navegador.
   ============================================================ */
const { createClient } = require('@supabase/supabase-js');
const { PLANS, EURO_PRODUCTS, coverageBeats, entitlementExpiry } = require('./plans');

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
// (mexico/individual/torneo), MLB (mlb_*), Liga MX (mx_*), NFL (nfl_*)
// y las ligas de Europa (epl_* / laliga_* / bundesliga_*). Se guardan
// como filas separadas en `entitlements`, distinguidas por `product`.
// Los combos (combo_*, todo_*) otorgan VARIAS filas con el
// mismo plan, una por producto. Esta función regresa UN solo producto
// (para los combos, una etiqueta agrupadora); productsForPlan es la
// que expande.
function productForPlan(plan) {
  if (plan && plan.startsWith('mlb_')) return 'mlb';
  if (plan && plan.startsWith('mx_')) return 'mx';
  if (plan && plan.startsWith('nfl_')) return 'nfl';
  if (plan && plan.startsWith('epl_')) return 'epl';
  if (plan && plan.startsWith('laliga_')) return 'laliga';
  if (plan && plan.startsWith('bundesliga_')) return 'bundesliga';
  if (plan && plan.startsWith('ucl_')) return 'ucl';
  if (plan && plan.startsWith('todo_')) return 'todo';     // agrupador: los 6 modelos
  if (plan && plan.startsWith('combo_')) return 'combo';
  if (plan === 'circulo_fundador') return 'combo';
  return 'mundial';
}

// Todos los productos que cubre un plan. La lista `products` de
// lib/plans.js es la fuente de verdad (combo_fundador legado = 2,
// combo_total y circulo = 3, todo_* = todos los modelos);
// el prefijo es solo el respaldo por si un plan la olvida.
function productsForPlan(plan) {
  const def = PLANS[plan];
  if (def && Array.isArray(def.products)) return def.products.slice();
  if (plan === 'circulo_fundador') return ['mlb', 'mx', 'nfl'];
  if (plan && plan.startsWith('combo_')) return ['mlb', 'mx'];
  if (plan && plan.startsWith('todo_')) return ['mlb', 'mx', 'nfl'].concat(EURO_PRODUCTS);
  return [productForPlan(plan)];
}

// Lee el acceso (entitlement) activo de un usuario para un producto.
// El producto se deriva del `plan` en JS (nunca de una columna de la
// BD), así que esto funciona haya corrido o no la migración de
// `entitlements` que agrega la columna `product`.
// Si no se pasa `product`, regresa cualquiera de los activos (compat).
// Las cuentas admin tienen acceso completo automático a todos los productos.
async function getEntitlement(userId, userEmail, product) {
  if (!userId) return null;
  if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
    if (product === 'mlb') return { plan: 'mlb_fundador', active: true, product: 'mlb' };
    if (product === 'mx') return { plan: 'mx_fundador', active: true, product: 'mx' };
    if (product === 'nfl') return { plan: 'nfl_fundador', active: true, product: 'nfl' };
    /* Europa: el mensual de cada liga (epl_mensual, laliga_mensual,
       bundesliga_mensual) — así el admin ve las tres en beta privada. */
    if (EURO_PRODUCTS.includes(product)) return { plan: product + '_mensual', active: true, product };
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
      { plan: 'nfl_fundador', active: true, product: 'nfl' },
      /* Europa: una fila por liga, mismo atajo que getEntitlement. */
      ...EURO_PRODUCTS.map(p => ({ plan: p + '_mensual', active: true, product: p })),
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

// Fecha (AAAA-MM-DD) en que vence una fila, para los logs.
function venceEl(row) {
  return new Date(entitlementExpiry(row.plan, row.updated_at)).toISOString().slice(0, 10);
}

// Otorga (o renueva) el acceso de un usuario tras un pago aprobado.
// Esquema nuevo: una fila por producto (user_id + product), sin pisar
// las de los demás productos.
//
// Regla de oro (5-sep-2026): tampoco pisa, en el MISMO producto, una
// fila vigente que dure más que el plan nuevo (coverageBeats en
// lib/plans.js). Antes un todo_mensual / combo_mensual
// reemplazaba mlb_temporada o epl_temporada por 30 días de mensual
// y el cliente perdía el pase que pagó ($1,199 / $1,999). Ahora esas
// filas se conservan tal cual y solo se escriben los productos donde
// el plan nuevo sí agrega algo. El mismo plan siempre se refresca
// (renovaciones). Regresa { granted: [productos escritos],
// kept: [{ product, plan }] } — nadie depende del valor, es para los
// logs y scripts/verify-plans.js.
//
// Si la migración de `entitlements` (columna `product` + índice único
// user_id+product) todavía no se corrió en Supabase, esto cae de vuelta
// al esquema viejo (una sola fila por usuario) para que las compras
// SIGAN funcionando mientras se corre la migración.
async function grantEntitlement(userId, plan) {
  const admin = getAdmin();
  const now = new Date().toISOString();
  const products = productsForPlan(plan); // los combos escriben varias filas (una por producto)
  const granted = [], kept = [];

  /* Lo que ya tiene en esos productos. Si la lectura falla (p.ej. la
     columna `product` no existe) se sigue como siempre: el upsert de
     abajo también fallará y el fallback hace su propia lectura. */
  const existing = {};
  const prev = await admin
    .from('entitlements')
    .select('plan, product, active, updated_at')
    .eq('user_id', userId)
    .in('product', products);
  if (!prev.error && Array.isArray(prev.data)) {
    for (const r of prev.data) existing[r.product] = r;
  }

  let attempt1Error = null;
  for (const product of products) {
    const cur = existing[product];
    if (cur && coverageBeats(cur, plan)) {
      kept.push({ product, plan: cur.plan });
      console.log(`grantEntitlement: ${userId} conserva ${cur.plan} en ${product} (vence ${venceEl(cur)}); ${plan} no lo pisa`);
      continue;
    }
    const attempt1 = await admin
      .from('entitlements')
      .upsert(
        { user_id: userId, plan, product, active: true, updated_at: now },
        { onConflict: 'user_id,product' }
      );
    if (attempt1.error) { attempt1Error = attempt1.error; break; }
    granted.push(product);
  }
  if (!attempt1Error) return { granted, kept };
  if (products.length > 1) throw attempt1Error; // combo requiere la migración; sin ella no hay fallback seguro
  const product = products[0];

  // Fallback: esquema viejo (migración pendiente). PELIGRO conocido:
  // con una sola fila por usuario, un upsert ciego PISA el acceso del
  // OTRO producto (así se perdieron Mundiales al comprar MLB el
  // 10-17 jul 2026). Si la fila existente es de otro producto y está
  // activa, NO la tocamos: fallamos fuerte para que el webhook
  // reintente después de correr la migración.
  const old = await admin
    .from('entitlements')
    .select('plan, active, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!old.error && old.data && old.data.active) {
    if (productForPlan(old.data.plan) !== product) {
      throw new Error(
        `grantEntitlement: el usuario ${userId} ya tiene ${old.data.plan} activo (otro producto). ` +
        'CORRE scripts/migrate-entitlements-product.sql en Supabase para poder tener ambos.'
      );
    }
    /* Misma regla de cobertura que arriba: un pase vigente que dura
       más no se pisa por un mensual. */
    if (coverageBeats(old.data, plan)) {
      console.log(`grantEntitlement: ${userId} conserva ${old.data.plan} en ${product} (vence ${venceEl(old.data)}); ${plan} no lo pisa`);
      return { granted: [], kept: [{ product, plan: old.data.plan }] };
    }
  }
  const attempt2 = await admin
    .from('entitlements')
    .upsert(
      { user_id: userId, plan, active: true, updated_at: now },
      { onConflict: 'user_id' }
    );
  if (attempt2.error) throw attempt2.error;
  return { granted: [product], kept: [] };
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
  // Leemos la columna `product` real (ya existe tras la migración): así
  // el combo aparece como DOS filas (mlb + mx) con su producto correcto,
  // en vez de derivarlo del nombre del plan (que daría "combo").
  const { data: ents, error: entsErr } = await admin
    .from('entitlements')
    .select('user_id, plan, active, updated_at, product');
  if (entsErr) throw entsErr;
  // Un usuario puede tener varias filas (mundial + mlb + mx). Agrupamos
  // por user_id; el producto viene de la columna, con respaldo al nombre
  // del plan por si alguna fila vieja lo tiene en null.
  const entMap = {};
  (ents || []).forEach(e => {
    /* Respaldo si la fila no trae `product` (escrita antes de la
       migración): productForPlan devolvería "combo", que no es un
       modelo real y dejaría al cliente como "Sin plan" en el panel.
       productsForPlan lo expande a los modelos que de verdad cubre. */
    const products = e.product ? [e.product] : productsForPlan(e.plan);
    for (const product of products) {
      (entMap[e.user_id] = entMap[e.user_id] || []).push({ ...e, product });
    }
  });
  return (users || []).map(u => {
    const list = entMap[u.id] || [];
    const primary = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    // Resumen por producto: la fila activa de cada modelo (mundial/mlb/mx).
    const byProduct = {};
    for (const e of list) {
      if (!e.active) continue;
      const cur = byProduct[e.product];
      if (!cur || new Date(e.updated_at) > new Date(cur.updated_at)) {
        byProduct[e.product] = { plan: e.plan, active: e.active, updated_at: e.updated_at };
      }
    }
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at,
      plan: primary ? primary.plan : null,
      active: primary ? primary.active : false,
      plan_updated: primary ? primary.updated_at : null,
      plans: list,
      products: byProduct, // { mundial?: {plan,active,updated_at}, mlb?, mx?, nfl?, epl?, laliga?, bundesliga? }
    };
  });
}

module.exports = { getAdmin, getUserFromToken, getEntitlement, getEntitlements, grantEntitlement, getAllUsersWithPlans, productForPlan, productsForPlan };
