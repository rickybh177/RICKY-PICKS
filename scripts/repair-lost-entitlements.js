#!/usr/bin/env node
/* ============================================================
   REPARACIÓN: restaura los accesos del Mundial que se perdieron
   cuando una compra de MLB sobrescribió la fila de `entitlements`
   (esquema viejo: una sola fila por usuario; bug del 10-17 jul 2026).

   Cómo funciona:
   1. Reconstruye el historial de compras REAL desde Mercado Pago
      y Stripe (external_reference / metadata = userId:plan).
   2. Busca usuarios con compra aprobada del Mundial (mexico/
      individual/torneo) que hoy NO tienen entitlement mundial activo.
   3. Les reinserta su fila de Mundial SIN tocar la de MLB.

   REQUISITO: haber corrido scripts/migrate-entitlements-product.sql
   en Supabase (SQL Editor) — sin la columna `product` no caben dos
   filas por usuario y este script se rehúsa a correr.

   Uso:
     node scripts/repair-lost-entitlements.js          # simulacro (no escribe)
     node scripts/repair-lost-entitlements.js apply    # aplica la reparación
   ============================================================ */

const fs = require('fs');
const path = require('path');

// cargar .env (igual que dev-server)
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

const { getAdmin } = require('../lib/supabaseAdmin');

const MUNDIAL_PLANS = ['mexico', 'individual', 'torneo'];
const APPLY = process.argv[2] === 'apply';

async function paymentHistory() {
  const buys = {}; // userId -> Set(plan mundial)
  const add = (uid, plan, date, src) => {
    if (!uid || !MUNDIAL_PLANS.includes(plan)) return;
    (buys[uid] = buys[uid] || []).push({ plan, date, src });
  };

  for (let off = 0; off < 1000; off += 50) {
    const r = await fetch('https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=50&offset=' + off,
      { headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN } });
    if (!r.ok) break;
    const j = await r.json();
    const rows = j.results || [];
    for (const p of rows) {
      if (p.status !== 'approved') continue;
      const ref = p.external_reference || (p.metadata && p.metadata.user_id && `${p.metadata.user_id}:${p.metadata.plan}`) || '';
      const [uid, plan] = String(ref).split(':');
      add(uid, plan, (p.date_approved || p.date_created || '').slice(0, 10), 'MercadoPago');
    }
    if (rows.length < 50) break;
  }

  let after = '';
  for (let page = 0; page < 20; page++) {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions?limit=100' + (after ? '&starting_after=' + after : ''),
      { headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY } });
    if (!r.ok) break;
    const j = await r.json();
    for (const s of (j.data || [])) {
      if (s.payment_status === 'paid' && s.metadata) {
        add(s.metadata.user_id, s.metadata.plan, new Date(s.created * 1000).toISOString().slice(0, 10), 'Stripe');
      }
      after = s.id;
    }
    if (!j.has_more) break;
  }
  return buys;
}

(async () => {
  const admin = getAdmin();

  // requisito: columna product (migración corrida)
  const probe = await admin.from('entitlements').select('product').limit(1);
  if (probe.error) {
    console.error('✗ La columna `product` NO existe todavía.');
    console.error('  Corre scripts/migrate-entitlements-product.sql en Supabase → SQL Editor y vuelve a intentar.');
    process.exit(1);
  }

  console.log('Leyendo historial de pagos (Mercado Pago + Stripe)…');
  const buys = await paymentHistory();
  const { data: ents, error } = await admin.from('entitlements').select('user_id, plan, product, active');
  if (error) throw error;

  const now = new Date().toISOString();
  let found = 0;
  for (const [uid, purchases] of Object.entries(buys)) {
    const hasMundial = (ents || []).some(e => e.user_id === uid && e.product === 'mundial' && e.active);
    if (hasMundial) continue;
    // el mejor plan comprado (torneo > individual > mexico)
    const plan = MUNDIAL_PLANS.slice().reverse().find(p => purchases.some(b => b.plan === p));
    found++;
    console.log(`→ ${uid}  compró ${JSON.stringify(purchases)}  y hoy no tiene Mundial. Restaurar: ${plan}`);
    if (APPLY) {
      const up = await admin.from('entitlements').upsert(
        { user_id: uid, plan, product: 'mundial', active: true, updated_at: now },
        { onConflict: 'user_id,product' }
      );
      if (up.error) console.error('  ✗ error:', up.error.message);
      else console.log('  ✓ restaurado');
    }
  }
  if (!found) console.log('Nada que reparar: todos los compradores del Mundial tienen su acceso.');
  else if (!APPLY) console.log(`\nSimulacro: ${found} usuario(s) por reparar. Corre con "apply" para aplicar.`);
})().catch(e => { console.error(e); process.exit(1); });
