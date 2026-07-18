#!/usr/bin/env node
/* ============================================================
   VERIFICACIÓN DE PLANES — corre esto DESPUÉS de agregar o
   cambiar cualquier plan, y antes de venderlo.

   Prueba la cadena completa "compra → acceso" para CADA plan de
   lib/plans.js, que es donde han vivido todos los incidentes de
   "pagué y no veo mi modelo":

   1. ESTÁTICO:
      - El plan mapea a un producto conocido (mundial/mlb/mx).
      - El validador de acceso de su modelo lo acepta (prefijos
        mlb_/mx_/combo_; el Mundial usa nombres exactos).
      - Aparece en el checkout (public/checkout.html) para que la
        página de compra no diga "Plan no válido".
      - Congruencia de suscripción: recurring ⇒ 30 días.
   2. EN VIVO (contra Supabase real):
      - Otorga cada plan a un usuario de PRUEBA dedicado y verifica
        que las filas de entitlement se crean con su producto.
        Esto atrapa candados de BD (CHECK constraints, columnas
        faltantes, FKs) que rechazan planes EN SILENCIO — la causa
        de los incidentes del 17 y 18 de julio de 2026.
      - Limpia las filas al final (el usuario de prueba se queda).

   Uso:  node scripts/verify-plans.js
   Sale con código 1 si algo falla (sirve para CI).
   ============================================================ */

const fs = require('fs');
const path = require('path');

// cargar .env
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => {
    const t = l.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i < 0) return;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  });
} catch (e) {}

const { PLANS, isSubscription } = require('../lib/plans');
const { getAdmin, grantEntitlement, productsForPlan } = require('../lib/supabaseAdmin');

const TEST_EMAIL = 'test-entitlements@rickypicks.internal';
const KNOWN_PRODUCTS = ['mundial', 'mlb', 'mx'];

/* ¿El validador de acceso del modelo acepta este plan?
   (réplica de las reglas de api/mlb-picks.js, api/mx-picks.js y
   lib/model.js matchAllowed — si cambias esas reglas, cambia esto) */
function accessRuleAccepts(product, planId) {
  if (product === 'mlb') return planId.startsWith('mlb_') || planId.startsWith('combo_');
  if (product === 'mx') return planId.startsWith('mx_') || planId.startsWith('combo_');
  if (product === 'mundial') return ['torneo', 'individual', 'final'].includes(planId);
  return false;
}

let failures = 0, warnings = 0;
const fail = msg => { console.log('  ✗ ' + msg); failures++; };
const warn = msg => { console.log('  ⚠ ' + msg); warnings++; };
const ok = msg => console.log('  ✓ ' + msg);

(async () => {
  const checkoutHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'checkout.html'), 'utf8');

  console.log('=== 1. Verificación estática de cada plan ===');
  for (const [id, plan] of Object.entries(PLANS)) {
    console.log(id + ':');
    const products = productsForPlan(id);
    if (!products.length || products.some(p => !KNOWN_PRODUCTS.includes(p))) {
      fail(`producto desconocido: ${JSON.stringify(products)}`);
    } else {
      ok(`producto(s): ${products.join(', ')}`);
    }
    for (const p of products) {
      if (accessRuleAccepts(p, id)) ok(`el modelo "${p}" acepta este plan`);
      else if (id === 'mexico') warn(`plan legado "mexico": el gate del Mundial ya no lo acepta (no se vende — ignorar o borrar)`);
      else fail(`el gate del modelo "${p}" NO acepta este plan → el cliente pagaría sin ver nada`);
    }
    if (checkoutHtml.includes(`${id}:`) || checkoutHtml.includes(`'${id}'`) || checkoutHtml.includes(`"${id}"`)) {
      ok('aparece en checkout.html');
    } else if (id === 'mexico') {
      warn('no está en checkout.html (legado, no se vende)');
    } else {
      fail('NO está en checkout.html → /checkout.html?plan=' + id + ' diría "Plan no válido"');
    }
    if (isSubscription(id) && plan.days !== 30) fail(`recurring pero days=${plan.days} (debe ser 30)`);
  }

  console.log('\n=== 2. Otorgamiento real contra Supabase (usuario de prueba) ===');
  const admin = getAdmin();
  // usuario de prueba dedicado (se crea una vez y se reusa)
  let userId = null;
  {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const found = (data && data.users || []).find(u => u.email === TEST_EMAIL);
    if (found) userId = found.id;
    else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: TEST_EMAIL, email_confirm: true,
        password: 'test-' + Math.random().toString(36).slice(2),
      });
      if (error) { console.log('  ✗ no se pudo crear el usuario de prueba: ' + error.message); process.exit(1); }
      userId = created.user.id;
    }
  }
  console.log('  usuario de prueba: ' + userId);

  for (const id of Object.keys(PLANS)) {
    try {
      await grantEntitlement(userId, id);
      const { data: rows } = await admin.from('entitlements')
        .select('plan, product, active').eq('user_id', userId).eq('plan', id).eq('active', true);
      const expected = productsForPlan(id).sort().join(',');
      const got = (rows || []).map(r => r.product).sort().join(',');
      if (got === expected) ok(`${id} → filas [${got}]`);
      else fail(`${id} → esperaba productos [${expected}], la BD tiene [${got}]`);
    } catch (e) {
      fail(`${id} → grantEntitlement FALLÓ: ${e.message} (¿candado en la BD?)`);
    }
    // limpiar para el siguiente plan (el mismo producto se pisa entre planes)
    await admin.from('entitlements').delete().eq('user_id', userId);
  }

  console.log(`\n${failures ? '✗ ' + failures + ' FALLA(S)' : '✓ Todos los planes pasan'}${warnings ? ' · ' + warnings + ' advertencia(s)' : ''}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
