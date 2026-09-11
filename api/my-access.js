/* ============================================================
   GET /api/my-access
   Requiere sesión. Regresa qué productos tiene activos el usuario
   (Mundial, MLB, Liga MX, NFL y las tres ligas de Europa) para que
   "Mis modelos" y el checkout pinten el acceso sin adivinar.
   ============================================================ */
const { getUserFromToken, getEntitlements } = require('../lib/supabaseAdmin');
const { PLANS, comboPermanentDiscount, monthlyUpgradeFor, founderPriceFor, EURO_PRODUCTS, entitlementExpiry, entitlementGrants, isUpcoming } = require('../lib/plans');
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

    /* VIGENTE, no solo "active": `active` es una bandera de la fila y
       sigue en true cuando el mes ya se acabó. Mirándola sola, a quien
       se le vencía la suscripción "Mis modelos" le seguía diciendo
       "Activo" y al entrar al modelo se topaba con el candado sin
       explicación. entitlementGrants sí compara contra la vigencia. */
    const vigente = prod => {
      const e = ents.find(x => x.product === prod && x.active);
      return e && entitlementGrants(e, prod) ? e : null;
    };
    /* La fila existe pero ya venció: es un cliente que SE FUE, no uno
       que nunca compró. Se reporta aparte para poder decírselo. */
    const vencido = prod => {
      const e = ents.find(x => x.product === prod && x.active);
      if (!e || entitlementGrants(e, prod)) return null;
      return { plan: e.plan, title: (PLANS[e.plan] || {}).title || e.plan,
        expired_at: new Date(entitlementExpiry(e.plan, e.updated_at)).toISOString() };
    };

    const mundial = vigente('mundial');
    const mlb = vigente('mlb');
    const mx = vigente('mx');
    const nfl = vigente('nfl');
    /* Europa: una liga por producto (epl / laliga / bundesliga). Un
       combo europeo o "todo" ya viene expandido en una fila por liga. */
    const euro = {};
    for (const p of EURO_PRODUCTS) euro[p] = vigente(p);

    /* { producto: {plan, title, expired_at} } — solo los vencidos.
       El Mundial NO entra: fue un torneo que ya acabó, no tiene página
       ni forma de reactivarse, y aparecía en el aviso diciéndole a 170
       clientes que "se les acabó el acceso" a algo que terminó solo. */
    const expirados = {};
    for (const p of ['mlb', 'nfl', 'mx', ...EURO_PRODUCTS]) {
      const v = vencido(p);
      if (v) expirados[p] = v;
    }
    const upgrade = monthlyUpgradeFor(ents);
    const permDisc = comboPermanentDiscount(ents);
    /* Precio de fundador de "Todos los modelos" para clientes antiguos
       (o null). El front solo lo PINTA; el cobro lo vuelve a decidir el
       servidor en stripe-create / create-payment. */
    const founder = founderPriceFor(ents);

    /* Lo vencido AGRUPADO POR PLAN, para poder hablarle a cada quien de
       lo que de verdad tenía. Antes el aviso decía "tu suscripción" a
       todo el mundo — también a quien compró un pase de temporada de
       pago único o entró con un código, que nunca tuvieron una.
       `tipo` distingue los tres casos y `precio` es lo que le costaría
       volver HOY (con su precio de fundador si le toca). */
    const expirados_plan = (() => {
      const porPlan = {};
      for (const [prod, v] of Object.entries(expirados)) {
        const g = porPlan[v.plan] || (porPlan[v.plan] = { plan: v.plan, title: v.title, products: [], expired_at: v.expired_at });
        g.products.push(prod);
        /* si el mismo plan cubre varios, se queda la fecha más tardía */
        if (Date.parse(v.expired_at) > Date.parse(g.expired_at)) g.expired_at = v.expired_at;
      }
      return Object.values(porPlan).map(g => {
        const def = PLANS[g.plan] || {};
        const tipo = def.recurring ? 'mensual'
          : !(def.price > 0) ? 'codigo'
          : (def.days || 0) <= 10 ? 'prueba'   // la semana no es una temporada
          : 'temporada';
        /* Precio de volver: el de lista, salvo que tenga precio de
           fundador para ESE plan (hoy solo todo_mensual). */
        const lista = def.price > 0 ? def.price : null;
        const precio = (founder && founder.plan === g.plan) ? founder.price : lista;
        /* A dónde mandarlo: si su plan sigue a la venta, al checkout de
           ese plan; si ya no existe (semanas, combos legado), a la
           página del primer modelo que tenía. */
        const vendible = !!(def.price > 0 && !def.retired && !isUpcoming(g.plan));
        const reactivar = vendible
          ? '/checkout.html?plan=' + encodeURIComponent(g.plan)
          : '/producto.html?m=' + encodeURIComponent(g.products[0] || 'mlb');
        return { ...g, tipo, precio, precio_lista: lista, es_fundador: precio != null && lista != null && precio < lista, reactivar };
      });
    })();
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
      /* Suscripciones/pases que YA VENCIERON, por producto:
         { mlb: { plan, title, expired_at }, … }. Vacío si no hay. */
      expirados,
      /* Lo mismo agrupado por PLAN, con tipo (mensual / temporada /
         codigo), precio para volver y a dónde mandarlo. Es lo que usa
         el aviso para hablarle a cada quien de SU plan. */
      expirados_plan,
    });
  } catch (e) {
    console.error('my-access:', e);
    return res.status(500).json({ error: 'Error interno.' });
  }
};
