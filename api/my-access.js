/* ============================================================
   GET /api/my-access
   Requiere sesión. Regresa qué productos tiene activos el usuario
   (Mundial, MLB, Liga MX, NFL y las tres ligas de Europa) para que
   "Mis modelos" y el checkout pinten el acceso sin adivinar.
   ============================================================ */
const { getUserFromToken, getEntitlements } = require('../lib/supabaseAdmin');
const { PLANS, comboPermanentDiscount, monthlyUpgradeFor, founderPriceFor, EURO_PRODUCTS, entitlementExpiry } = require('../lib/plans');
const { loadSwap } = require('../lib/choices');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

  try {
    const ents = await getEntitlements(user.id, user.email);
    const mundial = ents.find(e => e.product === 'mundial' && e.active);
    const mlb = ents.find(e => e.product === 'mlb' && e.active);
    const mx = ents.find(e => e.product === 'mx' && e.active);
    const nfl = ents.find(e => e.product === 'nfl' && e.active);
    /* Europa: una liga por producto (epl / laliga / bundesliga). Un
       combo europeo o "todo" ya viene expandido en una fila por liga. */
    const euro = {};
    for (const p of EURO_PRODUCTS) euro[p] = ents.find(e => e.product === p && e.active) || null;
    const upgrade = monthlyUpgradeFor(ents);
    const permDisc = comboPermanentDiscount(ents);
    /* Precio de fundador de "Todos los modelos" para clientes antiguos
       (o null). El front solo lo PINTA; el cobro lo vuelve a decidir el
       servidor en stripe-create / create-payment. */
    const founder = founderPriceFor(ents);
    let tres = null;
    const tresRows = ents.filter(e => e.plan === 'tres_mensual' && e.active);
    if (tresRows.length) {
      const renewedAt = Math.max(...tresRows.map(r => Date.parse(r.updated_at) || 0));
      const swappedAt = await loadSwap(user.id, 'tres_mensual');
      tres = {
        products: tresRows.map(r => r.product).sort(),
        renews_at: new Date(entitlementExpiry('tres_mensual', tresRows[0].updated_at)).toISOString(),
        swap_available: !swappedAt || Date.parse(swappedAt) < renewedAt,
        swapped_at: swappedAt,
      };
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      mundial: !!mundial,
      mundial_plan: mundial ? mundial.plan : null,
      mlb: !!mlb,
      mlb_plan: mlb ? mlb.plan : null,
      mx: !!mx,
      mx_plan: mx ? mx.plan : null,
      nfl: !!nfl,
      nfl_plan: nfl ? nfl.plan : null,
      epl: !!euro.epl,
      epl_plan: euro.epl ? euro.epl.plan : null,
      laliga: !!euro.laliga,
      laliga_plan: euro.laliga ? euro.laliga.plan : null,
      bundesliga: !!euro.bundesliga,
      bundesliga_plan: euro.bundesliga ? euro.bundesliga.plan : null,
      ucl: !!euro.ucl,
      ucl_plan: euro.ucl ? euro.ucl.plan : null,
      /* Plan "Tres modelos a elegir": qué eligió y si ya puede hacer su
         cambio del periodo (uno por renovación). null si no lo tiene. */
      tres,
      /* Precio del Combo 2026 para ESTE usuario (el front solo lo
         pinta — el cobro real lo decide el servidor de nuevo):
         $199 si su mensualidad hace upgrade al combo, $799 con un
         modelo completo pagado, el de lista si no. */
      combo_2026_price: (upgrade && upgrade.target === 'combo_2026') ? upgrade.price
        : (permDisc || PLANS.combo_2026).price,
      combo_2026_discount: !!(permDisc || (upgrade && upgrade.target === 'combo_2026')),
      /* Upgrade del plan mensual: { target, price, from } o null. */
      monthly_upgrade: upgrade,
      /* { plan, price, models, count } — precio de fundador o null. */
      founder,
    });
  } catch (e) {
    console.error('my-access:', e);
    return res.status(500).json({ error: 'Error interno.' });
  }
};
