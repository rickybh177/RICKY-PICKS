/* ============================================================
   GET /api/my-access
   Requiere sesión. Regresa qué productos tiene activos el usuario
   (Mundial y/o MLB) para poder mostrar el switcher entre "Mis
   modelos" (Mundial) y "Modelo MLB" cuando tiene ambos.
   ============================================================ */
const { getUserFromToken, getEntitlements } = require('../lib/supabaseAdmin');
const { PLANS, comboPermanentDiscount, monthlyUpgradeFor } = require('../lib/plans');

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
    const upgrade = monthlyUpgradeFor(ents);
    const permDisc = comboPermanentDiscount(ents);
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
      /* Precio del Combo 2026 para ESTE usuario (el front solo lo
         pinta — el cobro real lo decide el servidor de nuevo):
         $199 si su mensualidad hace upgrade al combo, $799 con un
         modelo completo pagado, el de lista si no. */
      combo_2026_price: (upgrade && upgrade.target === 'combo_2026') ? upgrade.price
        : (permDisc || PLANS.combo_2026).price,
      combo_2026_discount: !!(permDisc || (upgrade && upgrade.target === 'combo_2026')),
      /* Upgrade del plan mensual: { target, price, from } o null. */
      monthly_upgrade: upgrade,
    });
  } catch (e) {
    console.error('my-access:', e);
    return res.status(500).json({ error: 'Error interno.' });
  }
};
