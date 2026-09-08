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
   1b. REGLA DE COBERTURA (sin BD): un plan nuevo NO pisa un pase
      vigente que dura más (coverageBeats, lib/plans.js) — la
      mecánica con la que un todo_mensual borraba mlb_temporada y
      epl_temporada (5-sep-2026).
   2. EN VIVO (contra Supabase real):
      - Otorga cada plan a un usuario de PRUEBA dedicado y verifica
        que las filas de entitlement se crean con su producto.
        Esto atrapa candados de BD (CHECK constraints, columnas
        faltantes, FKs) que rechazan planes EN SILENCIO — la causa
        de los incidentes del 17 y 18 de julio de 2026.
      - Limpia las filas al final (el usuario de prueba se queda).
   3. EN VIVO: la regla de cobertura contra la BD real — pases de
      temporada + una mensualidad encima, renovación y upgrade.

   Uso:  node scripts/verify-plans.js            (estático + en vivo)
         node scripts/verify-plans.js --static   (solo la sección 1;
                                                  no toca Supabase)
   Sale con código 1 si algo falla (sirve para CI).

   Planes `upcoming` (cableados pero todavía no a la venta, ver
   lib/plans.js): se verifican igual que los demás — la cadena
   compra → acceso debe estar lista ANTES de ponerlos a la venta —
   pero faltar en checkout.html es advertencia, no falla.
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

const { PLANS, isSubscription, isUpcoming, planCoversProduct, coverageBeats, EURO_PRODUCTS } = require('../lib/plans');
const { getAdmin, grantEntitlement, productsForPlan } = require('../lib/supabaseAdmin');

const STATIC_ONLY = process.argv.includes('--static');
const TEST_EMAIL = 'test-entitlements@rickypicks.internal';
const KNOWN_PRODUCTS = ['mundial', 'mlb', 'mx', 'nfl', 'epl', 'laliga', 'bundesliga', 'ucl'];

/* ¿El validador de acceso del modelo acepta este plan?
   Usa planCoversProduct de lib/plans.js — la MISMA regla que usan
   los gates reales (entitlementGrants). */
function accessRuleAccepts(product, planId) {
  if (product === 'mundial') return ['torneo', 'individual', 'final'].includes(planId);
  return planCoversProduct(planId, product);
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
      ok('aparece en checkout.html' + (isUpcoming(id) ? ' (todavía no a la venta: upcoming)' : ''));
    } else if (id === 'mexico' || !plan.price) {
      warn('no está en checkout.html (legado o solo por código, no se vende)');
    } else if (isUpcoming(id)) {
      warn('no está en checkout.html — todavía no se vende (upcoming), pero agrégalo ANTES de quitar la bandera');
    } else {
      fail('NO está en checkout.html → /checkout.html?plan=' + id + ' diría "Plan no válido"');
    }
    if (isSubscription(id) && plan.days !== 30) fail(`recurring pero days=${plan.days} (debe ser 30)`);
    if (isUpcoming(id) && plan.retired) fail('upcoming Y retired a la vez: no puede estar por salir y ya retirado');
  }

  console.log('\n=== 1b. Regla de cobertura: un plan nuevo no pisa un pase vigente que dura más ===');
  {
    const day = 86400e3, ahora = Date.now();
    const hace = d => new Date(ahora - d * day).toISOString();
    /* [lo que tiene, hace cuántos días lo compró, lo que compra, ¿se conserva?] */
    const casos = [
      ['mlb_temporada',    30,  'todo_mensual',   true],
      ['epl_temporada',    10,  'todo_mensual',   true],
      ['ucl_temporada',    10,  'ucl_mensual',    true],
      ['epl_permanente',   400, 'epl_mensual',    true],
      ['nfl_temporada',    20,  'combo_mensual',  true],  // starts_at: el reloj arranca en el kickoff
      ['combo_permanente', 400, 'mlb_mensual',    true],
      ['mx_mensual',       5,   'mx_apertura',    false], // upgrade: la temporada sí pisa al mensual
      ['mlb_mensual',      1,   'mlb_mensual',    false], // renovación: el mismo plan se refresca
      ['mlb_temporada',    140, 'mlb_mensual',    false], // le quedan 10 días: el mensual da más
      ['mlb_mensual',      40,  'combo_mensual',  false], // vencido: se pisa
    ];
    for (const [tiene, dias, compra, esperado] of casos) {
      const got = coverageBeats({ plan: tiene, active: true, updated_at: hace(dias) }, compra, ahora);
      const txt = `tiene ${tiene} (hace ${dias} d) y compra ${compra} → ${got ? 'se conserva' : 'se pisa'}`;
      if (got === esperado) ok(txt); else fail(txt + ` (esperaba que ${esperado ? 'se conservara' : 'se pisara'})`);
    }
  }

  if (STATIC_ONLY) {
    console.log(`\n${failures ? '✗ ' + failures + ' FALLA(S)' : '✓ Todos los planes pasan (solo estático)'}${warnings ? ' · ' + warnings + ' advertencia(s)' : ''}`);
    process.exit(failures ? 1 : 0);
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
    // limpiar para el siguiente plan (sin filas previas, la regla de cobertura no interviene)
    await admin.from('entitlements').delete().eq('user_id', userId);
  }

  console.log('\n=== 3. Una compra nueva no pisa los pases pagados (BD real, mismo usuario de prueba) ===');
  {
    const filas = async () => {
      const { data } = await admin.from('entitlements')
        .select('plan, product, active, updated_at').eq('user_id', userId).eq('active', true);
      const m = {}; (data || []).forEach(r => { m[r.product] = r; }); return m;
    };
    const espera = (etiqueta, got, exp) => {
      const g = Object.keys(exp).map(p => `${p}=${got[p] ? got[p].plan : '—'}`).join(' ');
      const bien = Object.keys(exp).every(p => got[p] && got[p].plan === exp[p]);
      if (bien) ok(`${etiqueta}: ${g}`);
      else fail(`${etiqueta}: ${g} (esperaba ${Object.entries(exp).map(([p, v]) => p + '=' + v).join(' ')})`);
    };
    try {
      await admin.from('entitlements').delete().eq('user_id', userId);
      await grantEntitlement(userId, 'mlb_temporada');
      await grantEntitlement(userId, 'epl_temporada');
      const r = await grantEntitlement(userId, 'todo_mensual');
      espera('mlb_temporada + epl_temporada, luego todo_mensual', await filas(), {
        mlb: 'mlb_temporada', epl: 'epl_temporada',
        laliga: 'todo_mensual', bundesliga: 'todo_mensual', ucl: 'todo_mensual', mx: 'todo_mensual', nfl: 'todo_mensual',
      });
      const keptStr = (r && r.kept || []).map(k => k.product).sort().join(',');
      // se conservan las dos temporadas pagadas: mlb y epl
      const expKept = ['epl', 'mlb'].sort().join(',');
      if (keptStr === expKept) ok(`grantEntitlement reporta kept=[${keptStr}]`);
      else fail(`grantEntitlement reporta kept=[${keptStr}] (esperaba ${expKept})`);
      /* Renovación: el mismo plan siempre se refresca. */
      const antes = (await filas()).mx.updated_at;
      await new Promise(res => setTimeout(res, 25));
      await grantEntitlement(userId, 'todo_mensual');
      const despues = (await filas()).mx.updated_at;
      if (new Date(despues) > new Date(antes)) ok('renovar todo_mensual refresca updated_at');
      else fail('renovar todo_mensual NO refrescó updated_at');
      /* Upgrade: la temporada sí pisa al mensual. */
      await grantEntitlement(userId, 'mx_apertura');
      espera('todo_mensual, luego mx_apertura (upgrade)', await filas(), { mx: 'mx_apertura', nfl: 'todo_mensual', mlb: 'mlb_temporada' });
    } catch (e) {
      fail('sección 3: ' + e.message);
    }
    await admin.from('entitlements').delete().eq('user_id', userId);
  }

  console.log(`\n${failures ? '✗ ' + failures + ' FALLA(S)' : '✓ Todos los planes pasan'}${warnings ? ' · ' + warnings + ' advertencia(s)' : ''}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
