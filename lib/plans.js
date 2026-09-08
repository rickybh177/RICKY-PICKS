/* ============================================================
   Planes y precios — fuente de verdad en el servidor.
   El precio JAMÁS se toma del navegador.
   ============================================================ */

/* Arranque de la temporada regular NFL 26-27 (Patriots @ Seahawks).
   Los planes de NFL con `starts_at` NO empiezan a consumir su
   vigencia antes de esta fecha — así "la pretemporada va gratis" es
   real y no una promesa de marketing: quien compra en agosto ve toda
   la pretemporada y su mes (o su temporada) arranca hasta el kickoff. */
const NFL_KICKOFF = '2026-09-10T00:20:00Z';

const PLANS = {
  mexico: {
    id: 'mexico',
    title: 'Partido de México',
    price: 199,       // MXN
    currency: 'MXN',
  },
  torneo: {
    id: 'torneo',
    title: 'Partidos finales del Mundial',
    price: 299,       // MXN
    currency: 'MXN',
  },
  final: {
    id: 'final',
    title: 'La final del Mundial — Argentina vs España',
    price: 99,        // MXN
    currency: 'MXN',
  },

  /* ---- BANDERAS DE VENTA ----
     `retired: true`  — ya NO se vende. El plan se queda en el catálogo
                        para que los entitlements de quienes SÍ lo
                        compraron sigan calculando su vigencia
                        (days) y sus renovaciones por webhook sigan
                        funcionando. Bloquea compras nuevas en
                        stripe-create / create-payment y lo esconde
                        de /api/plans-public.
     `upcoming: true` — TODAVÍA no se vende. Es el espejo de `retired`
                        hacia adelante: el plan ya existe completo
                        (producto, vigencia, checkout, rutas de
                        regreso) pero el dueño aún no lo pone a la
                        venta. Mismo trato que retired en las
                        pasarelas (rechazo con "todavía no está a la
                        venta") y en plans-public (oculto). Ponerlo
                        a la venta = borrar la bandera, nada más.
                        Sirve para dejar cableado un modelo que sigue
                        en beta privada (Europa, sep-2026). */

  /* ---- DOCTOR MLB (preventa fundador) ----
     Vigencias en días (validez del entitlement desde la compra).
     Cuando existan suscripciones reales, el fundador migra a
     cobro recurrente; mientras, es acceso renovable. */
  /* RETIRADO: ya no se puede comprar. Se queda aquí para que los
     entitlements de quienes SÍ lo compraron sigan calculando su
     vigencia (api/mlb-picks.js lee PLANS[ent.plan].days). */
  mlb_pase: {
    id: 'mlb_pase',
    title: 'Doctor MLB — Pase del día',
    price: 99,        // MXN
    currency: 'MXN',
    days: 1,
    retired: true,    // bloquea la compra en stripe-create / create-payment
  },
  /* RETIRADO 28-ago-2026 (pricing por suscripción): el mensual
     cancelable reemplaza a la semana como plan de entrada. */
  mlb_semana: {
    id: 'mlb_semana',
    title: 'Doctor MLB — Semana de prueba',
    price: 199,       // MXN
    currency: 'MXN',
    days: 7,
    retired: true,    // bloquea compras nuevas
  },
  /* RETIRADO 27-jul-2026: se eliminó el modelo de suscripción del
     sitio (decisión del dueño). Los suscriptores existentes conservan
     su plan y sus renovaciones vía webhook; solo se bloquean compras
     nuevas. */
  mlb_fundador: {
    id: 'mlb_fundador',
    title: 'Doctor MLB — Mensual Fundador',
    price: 399,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },
  mlb_temporada: {
    id: 'mlb_temporada',
    title: 'Modelo MLB — Temporada 2026',
    price: 1199,      // MXN — bajó de 1399 el 28-ago (mismo día); antes 599
    anchor: 2094,     // valor real pagando mes a mes: 6 × $349
    currency: 'MXN',
    days: 150,        // hasta el final de la Serie Mundial
    full: true,       // modelo COMPLETO pagado (cuenta para el combo a $799)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },

  /* ---- DOCTOR LIGA MX + COMBO DOCTOR DEPORTES ----
     El combo otorga DOS entitlements (mlb + mx) en filas separadas;
     grantEntitlement lo divide vía `products`. */
  /* RETIRADO 27-jul-2026 (fin de las suscripciones). */
  mx_fundador: {
    id: 'mx_fundador',
    title: 'Modelo Liga MX — Mensual Fundador',
    price: 399,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },
  /* RETIRADO 28-ago-2026 (pricing por suscripción). */
  mx_semana: {
    id: 'mx_semana',
    title: 'Modelo Liga MX — Semana de prueba',
    price: 249,       // MXN
    currency: 'MXN',
    days: 7,
    retired: true,    // bloquea compras nuevas
  },
  /* LEGADO: el combo de 2 modelos ya no se vende. Sigue aquí para que
     quienes lo contrataron conserven exactamente lo que compraron
     (MLB + Liga MX a $499) — NO incluye NFL. A ellos se les ofrece
     el upgrade al Combo Total pagando la diferencia. */
  combo_fundador: {
    id: 'combo_fundador',
    title: 'Combo MLB + Liga MX (legado)',
    price: 499,       // MXN
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },

  /* RETIRADO 27-jul-2026 (fin de las suscripciones): lo reemplaza
     combo_2026 (pago único). Suscriptores existentes conservan todo. */
  combo_total: {
    id: 'combo_total',
    title: 'Combo Total — MLB + Liga MX + NFL (mensual, legado)',
    price: 799,       // MXN
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    retired: true,    // bloquea compras nuevas
  },

  /* Combo 2026: los TRES modelos en pago único — el combo publicado.
     Ancla = suma real de los tres pases completos:
     599 (MLB temporada) + 699 (MX apertura) + 799 (NFL temporada)
     = 2,097. days 365 cubre las tres temporadas completas (la última
     en terminar es la NFL, feb-2027). */
  /* RETIRADO 28-ago-2026 (pricing por suscripción): lo reemplaza
     combo_mensual. OJO: sigue siendo comprable SOLO para quien tiene
     una oferta prometida vigente — el upgrade de $199 de los mensuales
     legado y el precio de $799 con un modelo completo pagado (ambas
     pasarelas lo permiten en ese caso; ver stripe-create /
     create-payment). Para el público general ya no se vende. */
  combo_2026: {
    id: 'combo_2026',
    title: 'Combo Total — MLB + Liga MX + NFL (pago único)',
    price: 1199,      // MXN (por separado: 599+699+799 = 2,097)
    currency: 'MXN',
    days: 365,
    products: ['mlb', 'mx', 'nfl'],
    retired: true,    // solo comprable con oferta legado (upgrade $199 / combo $799)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },
  mx_apertura: {
    id: 'mx_apertura',
    title: 'Doctor Liga MX — Apertura 2026 completo',
    price: 1199,      // MXN — bajó de 1399 el 28-ago (mismo día); antes 699
    anchor: 2094,     // valor real pagando mes a mes: 6 × $349 (days/30 ≈ 6 meses)
    currency: 'MXN',
    days: 170,        // jornada 1 → final de la liguilla (dic 2026)
    full: true,       // modelo COMPLETO pagado (cuenta para el combo a $799)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },

  /* ---- MODELO NFL (temporada 26-27) ----
     Misma estructura que MLB. Ojo: la NFL es SEMANAL (16 juegos por
     jornada, ~5 meses), así que la "semana" cubre una jornada
     completa y la temporada llega hasta el Super Bowl. */
  /* RETIRADO 28-ago-2026 (pricing por suscripción). */
  nfl_semana: {
    id: 'nfl_semana',
    title: 'Modelo NFL — Semana de prueba',
    price: 249,       // MXN
    currency: 'MXN',
    days: 7,
    retired: true,    // bloquea compras nuevas
  },
  /* RETIRADO 27-jul-2026 (fin de las suscripciones). */
  nfl_fundador: {
    id: 'nfl_fundador',
    title: 'Modelo NFL — Mensual Fundador',
    price: 599,       // MXN
    currency: 'MXN',
    days: 30,
    starts_at: NFL_KICKOFF, // la pretemporada NO consume el mes pagado
    recurring: true,  // suscripción mensual
    retired: true,    // bloquea compras nuevas
  },
  nfl_temporada: {
    id: 'nfl_temporada',
    title: 'Modelo NFL — Temporada 26-27 completa',
    price: 1199,      // MXN — bajó de 1399 el 28-ago (mismo día); antes 799
    anchor: 2094,     // valor real pagando mes a mes: 6 × $349 (days/30 = 6 meses)
    currency: 'MXN',
    days: 180,        // arranque + 180 días = 9-mar-2027 (cubre el Super Bowl)
    starts_at: NFL_KICKOFF,
    full: true,       // modelo COMPLETO pagado (cuenta para el combo a $799)
    // PAGO ÚNICO: sin `recurring`.
  },

  /* ---- PRICING POR SUSCRIPCIÓN (28-ago-2026) ----
     La estructura publicada: mensual de un modelo ($349), mensual de
     los tres ($549, el más elegido) y la temporada completa de un
     modelo en pago único ($1,399 ≈ 4 meses de mensual). La semana de
     prueba y el combo de pago único quedan retirados. */
  mlb_mensual: {
    id: 'mlb_mensual',
    title: 'Suscripción mensual — Modelo MLB',
    price: 349,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },
  mx_mensual: {
    id: 'mx_mensual',
    title: 'Suscripción mensual — Modelo Liga MX',
    price: 349,       // MXN
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },
  nfl_mensual: {
    id: 'nfl_mensual',
    title: 'Suscripción mensual — Modelo NFL',
    price: 349,       // MXN
    currency: 'MXN',
    days: 30,
    starts_at: NFL_KICKOFF, // la pretemporada NO consume el mes pagado
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },
  combo_mensual: {
    id: 'combo_mensual',
    title: 'Suscripción mensual — Los 3 modelos',
    price: 549,       // MXN ($183 por modelo)
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
  },

  /* ---- FÚTBOL EUROPEO: Premier League, LaLiga, Bundesliga y Champions ----
     CUATRO modelos independientes, cada uno con su producto (`epl`,
     `laliga`, `bundesliga`, `ucl`) y sus propios planes, exactamente
     como MLB / Liga MX / NFL. NO existe un paquete "Europa": el dueño
     decidió el 8-sep-2026 que cada modelo se comunica y se vende por
     separado (se retiraron europa_mensual / europa_temporada /
     europa_permanente antes de venderse; nadie los tuvo).

     PRECIOS PROVISIONALES: marcadores de posición para dejar el
     cableado completo (checkout, entitlements, rutas de regreso); el
     precio final lo decide el dueño antes de poner a la venta.
     Mientras, TODOS llevan `upcoming: true` y los modelos corren en
     beta privada (api/euro-picks.js). Salir a la venta = quitar
     `upcoming` plan por plan (y reflejar el precio en checkout.html y
     meta-purchase.js, que lo espejan).

     Ninguno lleva `full` ni entra a COMBO_PRODUCTS: las ofertas
     legado ($799 con un modelo completo pagado, upgrade de $199 de
     los mensuales) son exclusivas de MLB / Liga MX / NFL. */
  epl_mensual: {
    id: 'epl_mensual',
    title: 'Suscripción mensual — Modelo Premier League',
    price: 349,       // MXN — PROVISIONAL (mismo precio que los demás modelos)
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    upcoming: true,   // todavía no se vende (beta privada)
  },
  laliga_mensual: {
    id: 'laliga_mensual',
    title: 'Suscripción mensual — Modelo LaLiga',
    price: 349,       // MXN — PROVISIONAL (mismo precio que los demás modelos)
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    upcoming: true,   // todavía no se vende (beta privada)
  },
  bundesliga_mensual: {
    id: 'bundesliga_mensual',
    title: 'Suscripción mensual — Modelo Bundesliga',
    price: 349,       // MXN — PROVISIONAL (mismo precio que los demás modelos)
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    upcoming: true,   // todavía no se vende (beta privada)
  },
  ucl_mensual: {
    id: 'ucl_mensual',
    title: 'Suscripción mensual — Modelo Champions League',
    price: 349,       // MXN — PROVISIONAL (mismo precio que los demás modelos)
    currency: 'MXN',
    days: 30,
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    upcoming: true,   // todavía no se vende (beta privada)
  },
  /* TODO RICKY·PICKS: los siete modelos en una sola mensualidad. */
  todo_mensual: {
    id: 'todo_mensual',
    title: 'Suscripción mensual — Todo RICKY·PICKS (7 modelos)',
    price: 599,       // MXN — PROVISIONAL (recomendación 5-sep-2026; combo_mensual $549 queda como legado congelado)
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl', 'epl', 'laliga', 'bundesliga', 'ucl'],
    recurring: true,  // suscripción mensual (se re-cobra cada mes)
    upcoming: true,   // todavía no se vende (beta privada)
  },
  /* Temporada completa de cada liga en pago único: agosto → mayo. */
  epl_temporada: {
    id: 'epl_temporada',
    title: 'Modelo Premier League — Temporada 2026-27 completa',
    price: 1199,      // MXN — PROVISIONAL: paridad con las demás temporadas
    anchor: 3141,     // valor real pagando mes a mes: 9 × $349 (ago→may)
    currency: 'MXN',
    days: 275,        // 1-ago → ~3-may: alcanza la última jornada (y la final de la Champions)
    upcoming: true,   // todavía no se vende (beta privada)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },
  laliga_temporada: {
    id: 'laliga_temporada',
    title: 'Modelo LaLiga — Temporada 2026-27 completa',
    price: 1199,      // MXN — PROVISIONAL: paridad con las demás temporadas
    anchor: 3141,     // valor real pagando mes a mes: 9 × $349 (ago→may)
    currency: 'MXN',
    days: 275,        // 1-ago → ~3-may: alcanza la última jornada (y la final de la Champions)
    upcoming: true,   // todavía no se vende (beta privada)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },
  bundesliga_temporada: {
    id: 'bundesliga_temporada',
    title: 'Modelo Bundesliga — Temporada 2026-27 completa',
    price: 1199,      // MXN — PROVISIONAL: paridad con las demás temporadas
    anchor: 3141,     // valor real pagando mes a mes: 9 × $349 (ago→may)
    currency: 'MXN',
    days: 275,        // 1-ago → ~3-may: alcanza la última jornada (y la final de la Champions)
    upcoming: true,   // todavía no se vende (beta privada)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },
  ucl_temporada: {
    id: 'ucl_temporada',
    title: 'Modelo Champions League — Temporada 2026-27 completa',
    price: 1199,      // MXN — PROVISIONAL: paridad con las demás temporadas
    anchor: 3141,     // valor real pagando mes a mes: 9 × $349 (ago→may)
    currency: 'MXN',
    days: 275,        // 1-ago → ~3-may: alcanza la última jornada (y la final de la Champions)
    upcoming: true,   // todavía no se vende (beta privada)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra otra vez.
  },
  /* Acceso permanente por modelo: solo por código/soporte (price 0 =
     jamás comprable), igual que mlb/mx/nfl_permanente. */
  epl_permanente: {
    id: 'epl_permanente',
    title: 'Modelo Premier League — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,      // ~100 años
    permanent: true,
  },
  laliga_permanente: {
    id: 'laliga_permanente',
    title: 'Modelo LaLiga — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,      // ~100 años
    permanent: true,
  },
  bundesliga_permanente: {
    id: 'bundesliga_permanente',
    title: 'Modelo Bundesliga — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,      // ~100 años
    permanent: true,
  },
  ucl_permanente: {
    id: 'ucl_permanente',
    title: 'Modelo Champions League — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,      // ~100 años
    permanent: true,
  },

  /* ---- COMBO PERMANENTE (solo por código, no se vende) ----
     Acceso a MLB + Liga MX que no expira: `days` es ~100 años porque
     la vigencia de cualquier entitlement se calcula como
     updated_at + days (ver api/mlb-picks.js / api/mx-picks.js). No
     hay forma de marcar "sin vencimiento" salvo un número enorme. */
  combo_permanente: {
    id: 'combo_permanente',
    title: 'Combo MLB + Liga MX — acceso permanente (código)',
    price: 0,         // no tiene precio: solo se otorga por código
    currency: 'MXN',
    days: 36500,      // ~100 años
    products: ['mlb', 'mx'],
    permanent: true,  // acceso de por vida (cuenta para el precio especial del Combo)
    // PAGO ÚNICO: sin `recurring`. Nunca se cobra.
  },

  /* ---- PERMANENTES INDIVIDUALES (solo soporte/código, no se venden) ----
     Un solo modelo de por vida. price 0 = jamás comprable en las
     pasarelas (ambas exigen price > 0); se otorgan con grantEntitlement
     o un código en api/redeem.js. */
  mlb_permanente: {
    id: 'mlb_permanente',
    title: 'Modelo MLB — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,      // ~100 años
    permanent: true,
  },
  mx_permanente: {
    id: 'mx_permanente',
    title: 'Modelo Liga MX — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,
    permanent: true,
  },
  nfl_permanente: {
    id: 'nfl_permanente',
    title: 'Modelo NFL — acceso permanente',
    price: 0,
    currency: 'MXN',
    days: 36500,
    permanent: true,
  },

  /* ---- CÍRCULO FUNDADOR (ancla premium, Anchor Upsell) ----
     Tier real 5x el Fundador: todos los modelos + línea directa con
     Ricky por Telegram. Se presenta PRIMERO en el pricing para
     anclar el precio; las pocas ventas que haga son utilidad
     desproporcionada. */
  /* RETIRADO: ya no se puede comprar. Se queda aquí para que los
     entitlements de quienes SÍ lo compraron sigan calculando su
     vigencia (ver entitlementGrants más abajo). */
  circulo_fundador: {
    id: 'circulo_fundador',
    title: 'Círculo Fundador — todos los modelos + línea directa',
    price: 1999,      // MXN (5x mlb_fundador)
    currency: 'MXN',
    days: 30,
    products: ['mlb', 'mx', 'nfl'], // "todos los modelos" incluye NFL
    recurring: true,  // suscripción mensual
    retired: true,    // bloquea la compra en stripe-create / create-payment
  },
};

/* ¿Este plan es suscripción (cobro recurrente)? ÚNICA fuente de verdad.
   Solo los planes con `recurring: true` crean suscripción/preapproval en
   las pasarelas. Cualquier plan de temporada / pago único (sin la bandera)
   se cobra UNA sola vez — nunca se re-cobra. */
function isSubscription(planId) {
  return !!(PLANS[planId] && PLANS[planId].recurring);
}

/* ¿Este plan todavía NO está a la venta? (bandera `upcoming`). Las
   pasarelas lo rechazan y /api/plans-public lo esconde, igual que a
   un plan retirado — pero el mensaje al cliente es distinto ("todavía
   no" vs "ya no"). */
function isUpcoming(planId) {
  return !!(PLANS[planId] && PLANS[planId].upcoming);
}

/* ¿Este plan cubre este producto? ÚNICA fuente de verdad del acceso.

   Antes cada endpoint lo resolvía por prefijo del nombre del plan
   (`mlb_`, `combo_`…), lo que dejaba fuera cualquier plan cuyo nombre
   no siguiera esa convención — `circulo_fundador` incluido, que es el
   plan MÁS caro y se quedaba sin acceso a nada. Ahora manda la lista
   `products` del plan cuando existe, y el prefijo solo es el respaldo. */
function planCoversProduct(planId, product) {
  const plan = PLANS[planId];
  if (!plan || !product) return false;
  if (Array.isArray(plan.products)) return plan.products.includes(product);
  return planId.startsWith(product + '_');
}

/* Vencimiento (ms desde época) de un entitlement: updated_at + days.
   El reloj arranca al comprar, salvo que el plan tenga `starts_at`
   (NFL: la pretemporada no consume la vigencia). En una renovación
   updated_at ya es posterior al kickoff, así que manda la compra.
   Con updated_at = ahora dice hasta cuándo duraría un plan que se
   comprara hoy. Regresa 0 si la fecha no se puede leer (= vencido). */
function entitlementExpiry(planId, updatedAt) {
  const plan = PLANS[planId] || {};
  const days = plan.days || 30;
  const bought = updatedAt ? Date.parse(updatedAt) : 0;
  if (!Number.isFinite(bought)) return 0;
  const floor = plan.starts_at ? Date.parse(plan.starts_at) : 0;
  const since = Math.max(bought, Number.isFinite(floor) ? floor : 0);
  return since + days * 86400e3;
}

/* ¿El entitlement da acceso VIGENTE a este producto?
   Combina cobertura del plan + vigencia (days desde updated_at). */
function entitlementGrants(ent, product) {
  if (!ent || !ent.active || !ent.plan) return false;
  if (!planCoversProduct(ent.plan, product)) return false;
  return Date.now() <= entitlementExpiry(ent.plan, ent.updated_at);
}

/* ¿Lo que el cliente YA tiene le gana a un plan que se otorgaría
   ahora? Regla de oro del otorgamiento: nunca se le quita a un
   cliente algo que ya pagó. La fila existente ({ plan, active,
   updated_at }) se CONSERVA (no se pisa) cuando:
     - está activa y sigue vigente,
     - es de OTRO plan (el mismo plan siempre se renueva: así
       extienden su mes las mensualidades), y
     - vence DESPUÉS de lo que vencería el plan nuevo comprado hoy.
   Así el permanente siempre gana, un pase de temporada le gana a
   cualquier mensual mientras le queden más de 30 días, y un mensual
   al que le quedan 10 días sí se pisa por otro de 30 (el cliente
   sale ganando). Lección del 5-sep-2026: sin esta regla un
   todo_mensual pisaba mlb_temporada y epl_temporada (pases
   pagados de $1,199 / $1,999) con 30 días de mensual. */
function coverageBeats(existing, planId, nowMs) {
  if (!existing || !existing.active || !existing.plan) return false;
  if (existing.plan === planId) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cur = entitlementExpiry(existing.plan, existing.updated_at);
  if (cur <= now) return false;
  return cur > entitlementExpiry(planId, new Date(now).toISOString());
}

/* Productos de `planId` que el usuario YA tiene cubiertos por algo
   que dura más (coverageBeats). Recibe la lista de getEntitlements
   (filas ya expandidas por producto). Las pasarelas lo usan para no
   cobrar un plan que no agregaría NADA (todos sus productos ya
   cubiertos); si cubre solo algunos, la compra sigue y
   grantEntitlement conserva esas filas. */
function productsAlreadyCovered(ents, planId, nowMs) {
  const covered = new Set();
  for (const e of ents || []) {
    if (!e || !e.product || !planCoversProduct(planId, e.product)) continue;
    if (coverageBeats(e, planId, nowMs)) covered.add(e.product);
  }
  return [...covered];
}

/* Precio del Combo 2026 para clientes que YA PAGARON un modelo entero.

   Regla del dueño (18-ago-2026, ampliada el mismo día): quien tiene
   EXACTAMENTE UN modelo completo pagado — temporada de pago único
   (`full`, con vigencia) o acceso de por vida (`permanent`) — compra el
   Combo 2026 a $799 en vez de $1,199: ya pagó una de las tres patas.
   Con DOS o más modelos completos no aplica. Las semanas de prueba y
   los mensuales NO cuentan (no son un modelo entero pagado).
   Recibe la lista de getEntitlements (filas ya expandidas por producto)
   y regresa { price, product } o null. */
const COMBO_PERM_PRICE = 799; // MXN (combo_2026 $1,199 menos $400)
const COMBO_PRODUCTS = ['mlb', 'mx', 'nfl'];

function comboPermanentDiscount(ents) {
  const owned = new Set();
  for (const e of ents || []) {
    if (!e || !e.active) continue;
    const plan = PLANS[e.plan];
    if (!plan || !(plan.permanent || plan.full)) continue;
    const prods = Array.isArray(plan.products) ? plan.products
      : [e.product || String(e.plan).split('_')[0]];
    for (const p of prods) {
      if (!COMBO_PRODUCTS.includes(p)) continue;       // el Mundial no es pata del combo
      if (!entitlementGrants(e, p)) continue;          // solo cuenta si sigue vigente
      owned.add(p);
    }
  }
  if (owned.size !== 1) return null;
  return { price: COMBO_PERM_PRICE, product: [...owned][0] };
}

/* Upgrade de los MENSUALES al pase completo por $199 (18-ago-2026).

   Regla del dueño: quien tiene CUALQUIER plan mensual vigente puede
   llevarse el pase completo de su modelo por $199 en un solo pago —
   no importa qué modelo sea, pero SOLO gente con mensualidad activa.
   Al pagar, su suscripción mensual se cancela en ambas pasarelas
   (ver cancelCoveredRecurring) y se queda con el pase completo.

   Mensual individual → su temporada; cualquier combo mensual (o dos
   mensuales distintos) → Combo 2026. */
const MONTHLY_UPGRADE_PRICE = 199; // MXN
const MONTHLY_UPGRADE_TARGET = {
  mlb_fundador: 'mlb_temporada',
  mx_fundador: 'mx_apertura',
  nfl_fundador: 'nfl_temporada',
  combo_fundador: 'combo_2026',
  combo_total: 'combo_2026',
  circulo_fundador: 'combo_2026',
};

function monthlyUpgradeFor(ents) {
  const targets = new Set();
  let from = null;
  for (const e of ents || []) {
    if (!e || !e.active) continue;
    const plan = PLANS[e.plan];
    if (!plan || !plan.recurring) continue;
    const target = MONTHLY_UPGRADE_TARGET[e.plan];
    if (!target) continue;
    const prods = Array.isArray(plan.products) ? plan.products
      : [e.product || String(e.plan).split('_')[0]];
    if (!prods.some(p => entitlementGrants(e, p))) continue; // mensual vencido: sin oferta
    targets.add(target);
    if (!from) from = e.plan;
  }
  if (!targets.size) return null;
  const target = targets.size === 1 ? [...targets][0] : 'combo_2026';
  return { target, price: MONTHLY_UPGRADE_PRICE, from };
}

/* Pases completos de pago único: al otorgarlos, cualquier mensualidad
   que quede CUBIERTA por ellos se cancela (para no cobrar doble).
   las temporadas de Europa entran por lo mismo: quien las compra deja de pagar
   epl/laliga/bundesliga/europa mensual. NO dispara las ofertas legado
   (monthlyUpgradeFor solo apunta a MLB/MX/NFL y comboPermanentDiscount
   solo se consulta para combo_2026). */
const FULL_PASS_PLANS = ['mlb_temporada', 'mx_apertura', 'nfl_temporada', 'combo_2026', 'epl_temporada', 'laliga_temporada', 'bundesliga_temporada', 'ucl_temporada'];

/* Productos del fútbol de Europa (uno por liga). Los combos europeos
   los listan en `products`; aquí viven para que my-access, el panel y
   los scripts no repitan la lista a mano. */
/* Lista interna de los modelos de fútbol europeo. NO es un paquete
   comercial (cada uno se vende por separado): la usan admin, my-access
   y todo_* para recorrer los productos. */
const EURO_PRODUCTS = ['epl', 'laliga', 'bundesliga', 'ucl'];

module.exports = { PLANS, isSubscription, isUpcoming, planCoversProduct, entitlementGrants, entitlementExpiry, coverageBeats, productsAlreadyCovered, comboPermanentDiscount, monthlyUpgradeFor, FULL_PASS_PLANS, EURO_PRODUCTS };
