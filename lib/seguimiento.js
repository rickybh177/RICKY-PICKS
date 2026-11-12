/* ============================================================
   SEGUIMIENTO SEMANAL de clientes (1-nov-2026).

   El propósito: cada semana, a cada cliente con plan vivo, decirle
   cómo le fue al modelo en SUS ligas y qué viene, para que se sienta
   acompañado. Decisiones del dueño:
     - Por WhatsApp, no por correo (desde el 28-oct todos dan teléfono).
     - Nunca se menciona que el plan se renueva ni cuándo se cobra.
     - Las primeras semanas el dueño revisa cada mensaje antes de
       mandarlo: el panel (/seguimiento.html) abre WhatsApp con el
       texto listo y él lo manda; "Marcar enviado" lleva la cuenta.

   Este archivo junta, por cliente, la FICHA interna (lo que pagó,
   sus accesos, su uso, su suscripción) y el MENSAJE de la semana
   (balance de sus ligas con la libreta + los picks que vienen + la
   liga personal a /semana.html). La ficha es solo para el admin.
   ============================================================ */
const crypto = require('crypto');
const Stripe = require('stripe');
const { getAdmin, productsForPlan } = require('./supabaseAdmin');
const { PLANS, isSubscription, entitlementGrants, entitlementExpiry } = require('./plans');
const { kvGet, kvPut } = require('./odds/theoddsapi');
const { ADMIN_EMAILS } = require('./auth-cron');
const libreta = require('./libreta');
const uso = require('./uso');

const MX_TZ = 'America/Mexico_City';
const USD_MXN = 18.5;
const NOMBRE_LIGA = { nfl: 'NFL', mx: 'Liga MX', ucl: 'Champions', epl: 'Premier', laliga: 'LaLiga', bundesliga: 'Bundesliga', nba: 'NBA', mlb: 'MLB', mundial: 'Mundial', seriea: 'Serie A', ligue1: 'Ligue 1', uel: 'Europa League', uecl: 'Conference', mls: 'MLS', nhl: 'NHL' };
const ORDEN_LIGA = ['nfl', 'mx', 'ucl', 'epl', 'laliga', 'bundesliga', 'nba', 'nhl', 'seriea', 'ligue1', 'uel', 'uecl', 'mls', 'mlb'];
const CUENTAS_PRUEBA = ['elpapu@gmail.com'];   // cuenta de prueba del dueño

function siteUrl() {
  const dev = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
  if (dev) return 'http://localhost:' + (process.env.PORT || 3000);
  if (process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL)) return process.env.SITE_URL.replace(/\/$/, '');
  return 'https://dattip.com';
}

/* ---------- liga personal firmada a /semana.html ---------- */
function secreto() { return process.env.EMAIL_SECRET || process.env.CRON_SECRET || 'dattip-dev'; }
function tokenSemana(uid) { return crypto.createHmac('sha256', secreto()).update('semana:' + uid).digest('hex').slice(0, 24); }
function verificaSemana(uid, t) {
  const ok = tokenSemana(uid);
  return typeof t === 'string' && t.length === ok.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ok));
}
const urlSemana = uid => `${siteUrl()}/semana.html?u=${encodeURIComponent(uid)}&t=${tokenSemana(uid)}`;

/* ---------- fechas ---------- */
const fCorta = iso => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: MX_TZ }).replace(/\./g, '');
const fDia = iso => new Date(iso).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', timeZone: MX_TZ }).replace(/\./g, '');
const semanaKey = (now = Date.now()) => new Date(libreta.lunesDe(now)).toISOString().slice(0, 10);
function rangoTxt(desdeIso, hastaIso) {
  const d = new Date(desdeIso), h = new Date(Date.parse(hastaIso) - 86400e3);
  return `${fCorta(d)} al ${fCorta(h)}`;
}

/* ---------- pagos de todos los clientes (Stripe + Mercado Pago) ----------
   Se cachea 6 h en el KV: reconstruirlo pide cientos de objetos. */
const KV_PAGOS = 'seguimiento-pagos';
async function pagos({ fresco = false } = {}) {
  const cache = await kvGet(KV_PAGOS);
  if (!fresco && cache && Date.now() - Date.parse(cache.at) < 6 * 3600e3) return cache;
  const lista = [];   // { uid, email, fecha, plan, monto (MXN), moneda, via, tipo }
  const subs = {};    // uid → suscripción de Stripe más reciente
  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const aMxn = (cents, cur) => (cents / 100) * (String(cur).toLowerCase() === 'usd' ? USD_MXN : 1);
    /* pagos únicos: sesiones de checkout en modo payment */
    for await (const s of stripe.checkout.sessions.list({ status: 'complete', limit: 100 })) {
      if (s.mode !== 'payment' || s.payment_status !== 'paid' || !s.amount_total) continue;
      const md = s.metadata || {};
      lista.push({ uid: md.user_id || null, email: (s.customer_details && s.customer_details.email) || s.customer_email || null, fecha: new Date(s.created * 1000).toISOString(), plan: md.plan || null, monto: aMxn(s.amount_total, s.currency), moneda: s.currency.toUpperCase(), via: 'Stripe', tipo: 'Único' });
    }
    /* suscripciones: cada factura pagada (alta y renovaciones) */
    for await (const i of stripe.invoices.list({ status: 'paid', limit: 100 })) {
      if (!i.amount_paid) continue;
      const md = (i.parent && i.parent.subscription_details && i.parent.subscription_details.metadata)
        || (i.subscription_details && i.subscription_details.metadata)
        || (i.lines && i.lines.data[0] && i.lines.data[0].metadata) || {};
      lista.push({ uid: md.user_id || null, email: i.customer_email || null, fecha: new Date(i.created * 1000).toISOString(), plan: md.plan || null, monto: aMxn(i.amount_paid, i.currency), moneda: i.currency.toUpperCase(), via: 'Stripe', tipo: i.billing_reason === 'subscription_cycle' ? 'Renovación' : 'Suscripción' });
    }
    for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
      const uid = s.metadata && s.metadata.user_id;
      if (!uid) continue;
      const vivo = ['active', 'past_due', 'trialing'].includes(s.status);
      const prev = subs[uid];
      if (prev && prev.vivo && !vivo) continue;
      if (prev && prev.vivo === vivo && prev.creada > s.created) continue;
      const it = s.items && s.items.data[0];
      const fin = (it && it.current_period_end) || s.current_period_end;
      subs[uid] = {
        vivo, status: s.status, plan: s.metadata.plan || null, creada: s.created,
        monto: it && it.price ? it.price.unit_amount / 100 : null, moneda: it && it.price ? it.price.currency.toUpperCase() : null,
        fin_periodo: fin ? new Date(fin * 1000).toISOString() : null, cancela_al_final: !!s.cancel_at_period_end,
      };
    }
  }
  if (process.env.MP_ACCESS_TOKEN) {
    /* Mercado Pago trae TODA la cuenta del dueño; las ventas del sitio
       son las que llevan external_reference "uuid:plan". */
    const re = /^([0-9a-f-]{36}):([a-z0-9_]+)$/;
    for (let offset = 0; offset < 5000; offset += 100) {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/search?status=approved&sort=date_created&criteria=desc&range=date_created&begin_date=2026-06-01T00:00:00.000-06:00&end_date=NOW&limit=100&offset=${offset}`,
        { headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) break;
      const j = await r.json();
      for (const p of j.results || []) {
        const m = re.exec(p.external_reference || '');
        if (!m) continue;
        lista.push({ uid: m[1], email: (p.payer && p.payer.email) || null, fecha: p.date_approved || p.date_created, plan: m[2], monto: Number(p.transaction_amount) || 0, moneda: p.currency_id || 'MXN', via: 'Mercado Pago', tipo: PLANS[m[2]] && isSubscription(m[2]) ? 'Suscripción' : 'Único' });
      }
      if (!j.results || j.results.length < 100) break;
    }
  }
  const out = { at: new Date().toISOString(), lista, subs };
  await kvPut(KV_PAGOS, out);
  return out;
}

/* ---------- usuarios y accesos ---------- */
async function usuarios() {
  const sb = getAdmin();
  const users = []; let page = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  const { data: ents, error } = await sb.from('entitlements').select('user_id, plan, product, active, granted_at, updated_at');
  if (error) throw error;
  const porUser = {};
  for (const e of ents || []) (porUser[e.user_id] = porUser[e.user_id] || []).push(e);
  return { users, porUser };
}

/* Cada fila de acceso, expandida por modelo, con su tipo y si sigue
   vigente. tipo: 'suscripción' (mensual que se renueva), 'pase' (pago
   único), 'cortesía' (precio 0: código o regalo). */
function accesos(rows, sub, now = Date.now()) {
  const out = [];
  for (const e of rows || []) {
    const def = PLANS[e.plan] || {};
    const products = e.product ? [e.product] : productsForPlan(e.plan);
    /* modelos que el plan cubre pero aún no tienen fila (NBA desde el
       27-oct): misma regla que getEntitlements */
    if (!def.choose && Array.isArray(def.products)) for (const p of def.products) if (!products.includes(p)) products.push(p);
    const tipo = isSubscription(e.plan) ? 'suscripción' : (def.price > 0 ? 'pase' : 'cortesía');
    for (const product of products) {
      const vence = entitlementExpiry(e.plan, e.updated_at);
      const vigente = entitlementGrants({ ...e, product }, product);
      /* una mensualidad cuya suscripción ya no vive es un remanente:
         se le acaba en su fecha y no se renueva */
      const deSub = tipo === 'suscripción' && sub && sub.vivo && sub.plan === e.plan;
      out.push({
        product, liga: NOMBRE_LIGA[product] || product, plan: e.plan, titulo: def.title || e.plan, tipo,
        desde: e.granted_at || e.updated_at, vence: vence ? new Date(vence).toISOString() : null,
        vigente, permanente: !!def.permanent, renueva: !!deSub,
      });
    }
  }
  /* uno por modelo: el vigente que vence más tarde; los vencidos al final */
  const porProd = {};
  for (const a of out) {
    const c = porProd[a.product];
    if (!c || (a.vigente && !c.vigente) || (a.vigente === c.vigente && Date.parse(a.vence || 0) > Date.parse(c.vence || 0))) porProd[a.product] = a;
  }
  return Object.values(porProd).sort((a, b) => (b.vigente - a.vigente) || ORDEN_LIGA.indexOf(a.product) - ORDEN_LIGA.indexOf(b.product));
}

/* ---------- el mensaje de WhatsApp ---------- */
const u2 = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);
const pct = p => Math.round(Number(p) * 100) + '%';

function partidosQueVienen(ligas, prox, max, now = Date.now()) {
  const lista = [];
  /* la foto es de hasta una hora antes: lo que ya empezó se va */
  for (const l of ligas) for (const g of ((prox[l] && prox[l].games) || [])) if (Date.parse(g.date) > now) lista.push({ ...g, liga: l });
  lista.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const conPick = lista.filter(g => g.mejor.verdict === 'bet');
  /* los más claros: el mejor de cada liga por turnos (que no salgan
     cuatro de la misma), ordenados por el peso de lib/libreta */
  const porLiga = {};
  for (const g of conPick.slice().sort((a, b) => (b.mejor.peso || b.mejor.prob) - (a.mejor.peso || a.mejor.prob))) (porLiga[g.liga] = porLiga[g.liga] || []).push(g);
  const fuertes = [];
  while (fuertes.length < max && Object.values(porLiga).some(l => l.length)) {
    const ronda = Object.values(porLiga).filter(l => l.length).map(l => l.shift())
      .sort((a, b) => (b.mejor.peso || b.mejor.prob) - (a.mejor.peso || a.mejor.prob));
    fuertes.push(...ronda.slice(0, max - fuertes.length));
  }
  fuertes.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return { todos: lista, conPick, fuertes, totalPicks: lista.reduce((s, g) => s + (g.picks || 0), 0) };
}

function mensaje({ nombre, ligas, semana, vienen, url }) {
  const lineas = [];
  lineas.push(`Hola${nombre ? ' ' + nombre : ''}, te escribimos de Dattip 👋`);
  lineas.push('');
  const ligasTxt = ligas.map(l => NOMBRE_LIGA[l]).join(', ').replace(/, ([^,]*)$/, ' y $1');
  const enLigas = ligas.length === 1 ? `en ${ligasTxt}` : 'en tus ligas';
  const t = semana && semana.total;
  if (t && t.picks > 0) {
    lineas.push(`Así le fue al modelo ${enLigas} la semana pasada (${rangoTxt(semana.desde, semana.hasta)}):`);
    lineas.push(`*${u2(t.unidades)} u* · ${t.gano} de ${t.picks} picks`);
    if (ligas.length > 1) for (const l of ligas) {
      const b = semana.porLiga[l];
      if (b && b.picks) lineas.push(`• ${NOMBRE_LIGA[l]}: ${b.gano} de ${b.picks} (${u2(b.unidades)} u)`);
    }
  } else {
    lineas.push(`Desde esta semana te mandamos cada lunes cómo le fue al modelo ${ligas.length === 1 ? enLigas : `en tus ligas (${ligasTxt})`} y lo que viene.`);
  }
  if (vienen.fuertes.length) {
    lineas.push('');
    lineas.push(vienen.totalPicks > vienen.fuertes.length
      ? `Esta semana el modelo ya tiene ${vienen.totalPicks} picks ${enLigas}. Los más claros:`
      : `Los picks del modelo para esta semana ${enLigas}:`);
    for (const g of vienen.fuertes) lineas.push(`• ${g.home} vs ${g.away} (${NOMBRE_LIGA[g.liga]}, ${fDia(g.date)}): ${g.mejor.label} · ${pct(g.mejor.prob)}`);
  }
  lineas.push('');
  lineas.push(`Tu resumen completo: ${url}`);
  lineas.push('');
  lineas.push('¿Qué jugaste la semana pasada? Respóndenos con el pick, aunque sea uno.');
  return lineas.join('\n');
}

/* Número para wa.me: solo dígitos con lada. user_metadata.telefono
   ya viene normalizado con "+" (public/telefono.js). */
function waNumero(tel) {
  if (!tel) return null;
  const d = String(tel).replace(/[^\d]/g, '');
  if (d.length === 10) return '52' + d;   // número mexicano sin lada (cuentas viejas)
  return d.length >= 11 ? d : null;
}

/* ---------- avisos para el dueño (la sección "Qué hacer") ---------- */
function avisos({ c, now }) {
  const out = [];
  if (!c.wa) out.push({ nivel: 'alto', txt: 'Sin teléfono: no se le puede escribir hasta que entre (el sitio se lo pide al entrar).' });
  if (c.sub && c.sub.status === 'past_due') out.push({ nivel: 'alto', txt: 'Su último cobro falló: ya tiene su liga de pago por correo.' });
  if (c.sub && c.sub.cancela_al_final) out.push({ nivel: 'alto', txt: `Canceló: su acceso termina el ${fCorta(c.sub.fin_periodo)}.` });
  if (c.uso.medible && !c.uso.ultima) out.push({ nivel: 'alto', txt: `No ha entrado desde que empezó el registro de uso (${fCorta(c.uso.desde_registro)}).` });
  else if (c.uso.dias_sin_entrar != null && c.uso.dias_sin_entrar >= 14) out.push({ nivel: 'alto', txt: `Lleva ${c.uso.dias_sin_entrar} días sin entrar. El que deja de entrar dos semanas suele cancelar al mes siguiente.` });
  else if (c.uso.dias_sin_entrar != null && c.uso.dias_sin_entrar >= 7) out.push({ nivel: 'medio', txt: `Lleva ${c.uso.dias_sin_entrar} días sin entrar.` });
  for (const a of c.accesos) {
    if (!a.vigente || a.renueva || a.permanente || !a.vence) continue;
    const dias = Math.ceil((Date.parse(a.vence) - now) / 86400e3);
    if (dias <= 10) out.push({ nivel: 'medio', txt: `${a.liga} (${a.tipo}) se le cierra el ${fCorta(a.vence)}, en ${dias} día${dias === 1 ? '' : 's'}.` });
  }
  if (c.uso.aparatos >= 3) out.push({ nivel: 'medio', txt: `Entró desde ${c.uso.aparatos} sesiones distintas en un día: puede ser una cuenta compartida.` });
  const sinPartidos = c.accesos.filter(a => a.vigente && c.ligasSinPartidos.includes(a.product)).map(a => a.liga);
  if (sinPartidos.length) out.push({ nivel: 'bajo', txt: `Sin partidos esta semana en: ${sinPartidos.join(', ')}.` });
  return out;
}

/* ---------- todo junto ---------- */
async function enviosSemana(key = semanaKey()) { const e = (await kvGet('seguimiento-envios')) || {}; return e[key] || {}; }
async function marcaEnviado(uid, { quitar = false } = {}) {
  const key = semanaKey();
  const e = (await kvGet('seguimiento-envios')) || {};
  e[key] = e[key] || {};
  if (quitar) delete e[key][uid]; else e[key][uid] = new Date().toISOString();
  /* solo las últimas 12 semanas */
  for (const k of Object.keys(e).sort().slice(0, -12)) delete e[k];
  await kvPut('seguimiento-envios', e);
  return e[key];
}

async function construir({ soloUid = null, fresco = false, now = Date.now() } = {}) {
  const [{ users, porUser }, pg, semanas4, prox, enviados, inicioUso] = await Promise.all([
    usuarios(), pagos({ fresco }), libreta.semanas(4, now), libreta.proximos(), enviosSemana(), kvGet('uso-inicio'),
  ]);
  /* pagos por usuario (por uid y, de respaldo, por correo) */
  const porEmail = {}; for (const u of users) if (u.email) porEmail[u.email.toLowerCase()] = u.id;
  const pagosDe = {};
  for (const p of pg.lista) {
    const uid = p.uid || (p.email && porEmail[p.email.toLowerCase()]);
    if (uid) (pagosDe[uid] = pagosDe[uid] || []).push(p);
  }
  const totales = Object.entries(pagosDe).map(([uid, l]) => [uid, l.reduce((s, p) => s + p.monto, 0)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const rank = {}; totales.forEach(([uid], i) => { rank[uid] = i + 1; });

  const semana = semanas4[semanas4.length - 1];
  const ligasConPartidos = new Set(Object.entries(prox).filter(([, v]) => v.games && v.games.length).map(([k]) => k));
  for (const s of semanas4) for (const l of Object.keys(s.porLiga)) if (s.porLiga[l].picks) ligasConPartidos.add(l);

  const clientes = []; let cortesias = 0;
  for (const u of users) {
    if (soloUid && u.id !== soloUid) continue;
    if (!u.email || ADMIN_EMAILS.includes(u.email) || (!soloUid && CUENTAS_PRUEBA.includes(u.email))) continue;
    const sub = pg.subs[u.id] || null;
    const acc = accesos(porUser[u.id], sub, now);
    const vivos = acc.filter(a => a.vigente && a.product !== 'mundial');
    if (!vivos.length) continue;
    const compras = (pagosDe[u.id] || []).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
    const pagado = compras.reduce((s, p) => s + p.monto, 0);
    if (!(pagado > 0) && !soloUid) { cortesias++; continue; }

    const raw = await uso.leer(u.id);
    const r7 = uso.resumen(raw, 7, now);
    const dias = uso.diasConVisita(raw);
    const maxSes = Object.values((raw && raw.dias) || {}).reduce((m, d) => Math.max(m, (d.ses || []).length), 0);
    const desdeRegistro = inicioUso && inicioUso.at;
    const medible = !!desdeRegistro && now - Date.parse(desdeRegistro) >= 14 * 86400e3;
    const ultima = r7.ultima || (raw && raw.ultima) || null;
    const meta = u.user_metadata || {};
    const nombre = String(meta.nombre || meta.full_name || meta.name || '').trim().split(/\s+/)[0] || null;

    const ligas = ORDEN_LIGA.filter(l => vivos.some(a => a.product === l));
    const ligasMsg = ligas.filter(l => ligasConPartidos.has(l));
    /* la semana cerrada, solo con sus ligas */
    const semanaCliente = { desde: semana && semana.desde, hasta: semana && semana.hasta, porLiga: {}, total: { picks: 0, gano: 0, perdio: 0, empate: 0, unidades: 0, pendientes: 0 } };
    if (semana) {
      for (const l of ligas) {
        const b = semana.porLiga[l]; if (!b) continue;
        semanaCliente.porLiga[l] = b;
        for (const k of ['picks', 'gano', 'perdio', 'empate', 'pendientes']) semanaCliente.total[k] += b[k];
        semanaCliente.total.unidades = +(semanaCliente.total.unidades + b.unidades).toFixed(2);
      }
    }
    const vienen = partidosQueVienen(ligasMsg.length ? ligasMsg : ligas, prox, 4);
    const url = urlSemana(u.id);
    const wa = waNumero(meta.telefono || u.phone);

    const c = {
      id: u.id, email: u.email, nombre, telefono: meta.telefono || u.phone || null, wa,
      cliente_desde: u.created_at, ultimo_login: u.last_sign_in_at,
      ranking: rank[u.id] || null, de: totales.length,
      pagado: Math.round(pagado), compras: compras.map(p => ({ ...p, monto: Math.round(p.monto), titulo: (PLANS[p.plan] && PLANS[p.plan].title) || p.plan || '—' })),
      sub, accesos: acc, ligas, ligasMsg,
      ligasSinPartidos: ligas.filter(l => !ligasConPartidos.has(l)),
      uso: {
        ultima, medible, desde_registro: desdeRegistro || null,
        dias_sin_entrar: ultima ? Math.floor((now - Date.parse(ultima)) / 86400e3) : null,
        semana: r7, dias_recientes: dias.slice(0, 14), aparatos: maxSes,
      },
      semana: semanaCliente,
      historial: semanas4.map(s => {
        let un = 0, pk = 0;
        for (const l of ligas) if (s.porLiga[l]) { un += s.porLiga[l].unidades; pk += s.porLiga[l].picks; }
        return { desde: s.desde, unidades: +un.toFixed(2), picks: pk };
      }),
      vienen: { totalPicks: vienen.totalPicks, fuertes: vienen.fuertes },
      url_semana: url,
      enviado: enviados[u.id] || null,
    };
    c.mensaje = mensaje({ nombre, ligas: ligasMsg.length ? ligasMsg : ligas, semana: semanaCliente, vienen, url });
    c.wa_url = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(c.mensaje)}` : null;
    c.avisos = avisos({ c, now });
    clientes.push(c);
  }
  clientes.sort((a, b) => (a.ranking || 1e9) - (b.ranking || 1e9));
  return {
    semana: semanaKey(now), rango: semana ? rangoTxt(semana.desde, semana.hasta) : null,
    pagos_al: pg.at, uso_desde: inicioUso ? inicioUso.at : null,
    libreta: semana ? semana.total : null,
    resumen: {
      vivos: clientes.length, cortesias,
      enviados: clientes.filter(c => c.enviado).length,
      sin_telefono: clientes.filter(c => !c.wa).length,
      entraron_7d: clientes.filter(c => c.uso.semana.dias_activo > 0).length,
    },
    clientes,
  };
}

/* ---------- lo que ve el cliente en /semana.html ----------
   Solo lo suyo: balance de sus ligas, acumulado, lo que viene. Nada
   de cobros ni renovaciones (regla del dueño). */
async function paraCliente(uid, now = Date.now()) {
  const sb = getAdmin();
  const { data: { user } = {}, error } = await sb.auth.admin.getUserById(uid);
  if (error || !user) return null;
  const { data: rows } = await sb.from('entitlements').select('user_id, plan, product, active, granted_at, updated_at').eq('user_id', uid);
  const acc = accesos(rows || [], null, now).filter(a => a.vigente && a.product !== 'mundial');
  if (!acc.length) return { activo: false };
  const todas = ORDEN_LIGA.filter(l => acc.some(a => a.product === l));
  const [semanas4, prox] = await Promise.all([libreta.semanas(4, now, todas), libreta.proximos()]);
  const semana = semanas4[semanas4.length - 1];
  /* solo las ligas con partidos (MLB en noviembre no tiene nada que contar) */
  const conActividad = l => (prox[l] && prox[l].games && prox[l].games.length) || semanas4.some(s => s.porLiga[l] && s.porLiga[l].picks);
  const ligas = todas.filter(conActividad).length ? todas.filter(conActividad) : todas;
  const vienen = partidosQueVienen(ligas, prox, 4);
  /* las fallas de la semana: los picks perdidos de la liga peor */
  const entradasSemana = semana ? (await libreta.entradas(Date.parse(semana.desde), Date.parse(semana.hasta))).filter(e => ligas.includes(e.liga)) : [];
  const meta = user.user_metadata || {};
  return {
    activo: true,
    nombre: String(meta.nombre || meta.full_name || meta.name || '').trim().split(/\s+/)[0] || null,
    ligas: ligas.map(l => ({ id: l, nombre: NOMBRE_LIGA[l] })),
    rango: semana ? rangoTxt(semana.desde, semana.hasta) : null,
    semana: semana ? { total: semana.total, porLiga: semana.porLiga } : null,
    historial: semanas4.map(s => ({ desde: s.desde, etiqueta: fCorta(s.desde), unidades: s.total.unidades, picks: s.total.picks })),
    picks_semana: entradasSemana.filter(e => ['gano', 'perdio', 'empate'].includes(e.resultado)).map(e => ({
      liga: NOMBRE_LIGA[e.liga], partido: `${e.home} vs ${e.away}`, dia: fDia(e.date), label: e.label, prob: e.prob,
      resultado: e.resultado, marcador: e.marcador || null, unidades: e.unidades, am: e.am,
    })),
    vienen: vienen.todos.slice(0, 14).map(g => ({
      liga: NOMBRE_LIGA[g.liga], partido: `${g.home} vs ${g.away}`, dia: fDia(g.date), date: g.date,
      label: g.mejor.label, verdict: g.mejor.verdict, prob: g.mejor.prob,
    })),
    total_picks_vienen: vienen.totalPicks,
  };
}

module.exports = { construir, paraCliente, marcaEnviado, pagos, tokenSemana, verificaSemana, urlSemana, mensaje, waNumero, semanaKey, NOMBRE_LIGA };
