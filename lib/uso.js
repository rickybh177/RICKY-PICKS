/* ============================================================
   USO del sitio por cliente (1-nov-2026). Lo alimenta /api/huella
   desde public/huella.js.

   Decisión del dueño: sin tabla nueva en Supabase (no hay que correr
   SQL). Se guarda en el KV del sitio un objeto por usuario,
   `uso-<userId>`, con un resumen por día (fecha de CDMX):

     { inicio, ultima, dias: { 'AAAA-MM-DD': {
         v: visitas, s: segundos, l: { liga: visitas },
         m: visitas desde móvil, e: visitas desde escritorio,
         ses: [ids de sesión del día, máx. 30] } } }

   Se conservan 120 días. Escribir es leer-modificar-guardar: si
   llegan dos avisos del mismo usuario a la vez se puede perder uno.
   Para un resumen diario no importa.
   ============================================================ */
const { kvGet, kvPut } = require('./odds/theoddsapi');

const MX_TZ = 'America/Mexico_City';
const DIAS_GUARDA = 120;
const LIGAS = ['nfl', 'mlb', 'mx', 'nba', 'epl', 'laliga', 'bundesliga', 'ucl', 'seriea', 'ligue1', 'uel', 'uecl', 'mls', 'nhl'];

const diaMx = t => new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const clave = uid => 'uso-' + uid;

async function leer(uid) { return (await kvGet(clave(uid))) || null; }

/* `uso-inicio`: desde cuándo existe el registro. Antes de 14 días no
   se puede decir "lleva dos semanas sin entrar". */
let _inicioOk = false;
async function marcaInicio(now) {
  if (_inicioOk) return;
  if (!(await kvGet('uso-inicio'))) await kvPut('uso-inicio', { at: new Date(now).toISOString() });
  _inicioOk = true;
}

async function registra(uid, { evento, liga, sid, movil, segundos }, now = Date.now()) {
  await marcaInicio(now);
  const u =(await leer(uid)) || { inicio: new Date(now).toISOString(), dias: {} };
  const hoy = diaMx(now);
  const d = (u.dias[hoy] = u.dias[hoy] || { v: 0, s: 0, l: {}, m: 0, e: 0, ses: [] });
  if (evento === 'pagina') {
    d.v++;
    if (movil) d.m++; else d.e++;
    if (liga && LIGAS.includes(liga)) d.l[liga] = (d.l[liga] || 0) + 1;
    if (sid && typeof sid === 'string' && !d.ses.includes(sid.slice(0, 40)) && d.ses.length < 30) d.ses.push(sid.slice(0, 40));
    if (!u.ultima || Date.parse(u.ultima) < now) u.ultima = new Date(now).toISOString();
  } else if (evento === 'salida') {
    const s = Math.round(Number(segundos));
    if (Number.isFinite(s) && s > 0) d.s += Math.min(s, 3 * 3600);   // tope: una pestaña olvidada no suma horas
  } else {
    return u;
  }
  const corte = diaMx(now - DIAS_GUARDA * 86400e3);
  for (const k of Object.keys(u.dias)) if (k < corte) delete u.dias[k];
  await kvPut(clave(uid), u);
  return u;
}

/* Resumen de los últimos `dias` días: días con visita, visitas,
   minutos, ligas más vistas, móvil/escritorio, sesiones distintas. */
function resumen(u, dias = 7, now = Date.now()) {
  const out = { dias_activo: 0, visitas: 0, minutos: 0, ligas: {}, movil: 0, escritorio: 0, sesiones: 0, ultima: u ? u.ultima || null : null, desde: u ? u.inicio : null };
  if (!u) return out;
  const corte = diaMx(now - (dias - 1) * 86400e3);
  for (const [k, d] of Object.entries(u.dias || {})) {
    if (k < corte) continue;
    if (d.v) out.dias_activo++;
    out.visitas += d.v; out.minutos += d.s / 60; out.movil += d.m; out.escritorio += d.e; out.sesiones += (d.ses || []).length;
    for (const [l, n] of Object.entries(d.l || {})) out.ligas[l] = (out.ligas[l] || 0) + n;
  }
  out.minutos = Math.round(out.minutos);
  return out;
}

/* Días de CDMX (AAAA-MM-DD) con al menos una visita, más reciente primero. */
const diasConVisita = u => Object.keys((u && u.dias) || {}).filter(k => u.dias[k].v > 0).sort().reverse();

module.exports = { registra, leer, resumen, diasConVisita, diaMx };
