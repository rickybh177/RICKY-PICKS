/* ============================================================
   La LIBRETA de picks (1-nov-2026).

   Hasta hoy el sitio no guardaba qué recomendó: el récord se
   reconstruía a mano desde las tarjetas de Instagram. Para el
   seguimiento semanal de clientes ("tu semana: +1.3 u, 10 de 17")
   hace falta saber, liga por liga, cada PICK que el modelo dio y
   cómo terminó. Esto lo guarda y lo califica solo:

   - FOTO: cada corrida lee el tablero completo de cada liga (los
     mismos endpoints que ve un suscriptor, con acceso interno) y,
     para los partidos que todavía no empiezan, guarda sus veredictos
     PICK ('bet'). Se sobreescribe en cada corrida hasta el arranque:
     lo que queda es el último PICK antes del partido. Si un mercado
     deja de ser PICK antes de empezar, se borra (ya no se recomendaba
     al arranque). Una vez que el partido empieza, su foto ya no se
     toca. No se rellena hacia atrás: los veredictos de un partido ya
     jugado pueden traer lo que el modelo aprendió de ese resultado.
   - CALIFICACIÓN: con el marcador final de ESPN (MLB: statsapi).
     Gana, pierde, empata (push) o se anula (pospuesto/cancelado).
   - UNIDADES: una unidad por pick. Precio, en este orden: el momio
     real que trae el veredicto; el del total en el mercado (fútbol);
     -110 en hándicap y total de NFL/NBA con línea de casas; y si no
     hay precio (doble oportunidad, ambos anotan, línea del modelo),
     el momio justo del modelo (1/prob). Conservador a propósito.

   Guardado en el KV del sitio, un objeto por mes de arranque:
   `libreta-AAAA-MM` → { 'liga:gameId:market': entrada }.
   ============================================================ */
const { kvGet, kvPut } = require('./odds/theoddsapi');
const { getJson, baseUrl } = require('./ig/plan');

const MX_TZ = 'America/Mexico_City';
const VENTANA_FOTO_H = 30;   // foto de lo que arranca en las próximas 30 h

/* Ligas con tablero. `api` = endpoint del suscriptor; `espn` = ruta
   del marcador (deporte/liga). */
const LIGAS = {
  nfl:        { nombre: 'NFL',        api: '/api/nfl-picks',                 espn: 'football/nfl' },
  mx:         { nombre: 'Liga MX',    api: '/api/mx-picks',                  espn: 'soccer/mex.1' },
  ucl:        { nombre: 'Champions',  api: '/api/euro-picks?liga=ucl',       espn: 'soccer/uefa.champions' },
  epl:        { nombre: 'Premier',    api: '/api/euro-picks?liga=epl',       espn: 'soccer/eng.1' },
  laliga:     { nombre: 'LaLiga',     api: '/api/euro-picks?liga=laliga',    espn: 'soccer/esp.1' },
  bundesliga: { nombre: 'Bundesliga', api: '/api/euro-picks?liga=bundesliga', espn: 'soccer/ger.1' },
  nba:        { nombre: 'NBA',        api: '/api/nba-picks',                 espn: 'basketball/nba' },
  mlb:        { nombre: 'MLB',        api: '/api/mlb-picks',                 mlb: true },
};

const mesDe = iso => new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit' }).format(new Date(iso));
const kvMes = mes => 'libreta-' + mes;

/* ---------- precio de un pick ---------- */
const amToDec = am => (am > 0 ? 1 + am / 100 : 1 + 100 / -am);
function precio(v, g, liga) {
  const txt = v.line_txt || '';
  /* momio real escrito en el veredicto: "(+113)" o "· -232" */
  const m = txt.match(/\(([+-]\d{3,5})\)/) || txt.match(/·\s*([+-]\d{3,5})(?:\s|$)/);
  if (m && !/modelo/.test(txt.slice(Math.max(0, txt.indexOf(m[1]) - 8), txt.indexOf(m[1])))) {
    const am = parseInt(m[1], 10);
    if (Math.abs(am) >= 100) return { dec: amToDec(am), am, fuente: 'casas' };
  }
  /* total de fútbol: el momio del lado elegido en market_odds */
  const mo = g.markets && g.markets.market_odds;
  if (v.market === 'total' && mo && mo.total_line != null && txt.includes(String(mo.total_line))) {
    const am = /^Más/.test(v.label) ? mo.total_over : mo.total_under;
    if (am != null) return { dec: amToDec(am), am, fuente: 'casas' };
  }
  /* NFL/NBA: hándicap y total con línea de casas → -110 estándar */
  if ((liga === 'nfl' || liga === 'nba') && (v.market === 'spread' || v.market === 'total') && !/línea del modelo/.test(txt)) {
    return { dec: amToDec(-110), am: -110, fuente: 'estandar' };
  }
  const p = Number(v.prob);
  return { dec: p > 0 ? 1 / p : 2, am: null, fuente: 'modelo' };
}

/* ---------- forma común de un partido de cualquier tablero ---------- */
function partido(g) {
  return {
    id: String(g.id != null ? g.id : g.gamePk),
    date: g.date || g.game_date,
    state: g.state || (g.status === 'Final' ? 'post' : 'pre'),
    home: (g.home && g.home.name) || '',
    away: (g.away && g.away.name) || '',
    verdicts: g.verdicts || [],
  };
}

/* ---------- 1) la foto ---------- */
async function foto({ ligas = Object.keys(LIGAS), now = Date.now() } = {}) {
  const base = baseUrl();
  const headers = process.env.CRON_SECRET ? { 'x-internal-auth': process.env.CRON_SECRET } : {};
  const meses = {};   // mes → objeto cargado
  const cargar = async mes => (meses[mes] = meses[mes] || (await kvGet(kvMes(mes))) || {});
  const out = { guardados: 0, borrados: 0, ligas: {} };
  const proximos = (await kvGet(KV_PROXIMOS)) || {};
  for (const liga of ligas) {
    const cfg = LIGAS[liga];
    let d;
    try { d = await getJson(base + cfg.api, 240000, headers); }
    catch (e) { out.ligas[liga] = { error: e.message }; continue; }
    if (d.access && d.access !== 'full') { out.ligas[liga] = { error: 'sin acceso completo' }; continue; }
    proximos[liga] = { at: new Date(now).toISOString(), games: proximosDe(d.games || [], now) };
    let n = 0;
    for (const raw of d.games || []) {
      const g = partido(raw);
      const t = Date.parse(g.date);
      if (!Number.isFinite(t) || g.state !== 'pre' || t <= now || t > now + VENTANA_FOTO_H * 3600e3) continue;
      const libro = await cargar(mesDe(g.date));
      const pref = `${liga}:${g.id}:`;
      const vivos = new Set();
      for (const v of g.verdicts) {
        if (v.verdict !== 'bet') continue;
        const key = pref + v.market;
        vivos.add(key);
        const pr = precio(v, raw, liga);
        libro[key] = {
          liga, gameId: g.id, date: g.date, home: g.home, away: g.away,
          market: v.market, label: v.label, prob: v.prob, line_txt: v.line_txt || '',
          dec: +pr.dec.toFixed(3), am: pr.am, precio: pr.fuente, foto: new Date(now).toISOString(),
        };
        n++;
      }
      for (const k of Object.keys(libro)) if (k.startsWith(pref) && !vivos.has(k) && !libro[k].resultado) { delete libro[k]; out.borrados++; }
    }
    out.ligas[liga] = { picks: n };
    out.guardados += n;
  }
  for (const mes of Object.keys(meses)) await kvPut(kvMes(mes), meses[mes]);
  await kvPut(KV_PROXIMOS, proximos);
  return out;
}

/* Los partidos que vienen (8 días) con su mejor veredicto: PICK antes
   que MAYBE antes que SKIP; dentro de cada uno, primero lo que tiene
   precio de casas (por ventaja), luego lo demás por probabilidad, y
   la doble oportunidad al final (un 1X al 93% es cierto pero no le
   dice nada a nadie). Lo usa el seguimiento semanal ("esta semana en
   tus ligas") sin volver a pedir los tableros. */
const KV_PROXIMOS = 'libreta-proximos';
const RANGO = { bet: 0, maybe: 1, skip: 2 };
const peso = v => (v.edge != null ? 2 + v.edge : v.market === 'double_chance' ? v.prob - 1 : v.prob);
function proximosDe(games, now) {
  const out = [];
  for (const raw of games) {
    const g = partido(raw);
    const t = Date.parse(g.date);
    if (!Number.isFinite(t) || g.state !== 'pre' || t <= now || t > now + 8 * 86400e3) continue;
    const vs = g.verdicts.filter(v => v.verdict in RANGO).sort((a, b) => RANGO[a.verdict] - RANGO[b.verdict] || peso(b) - peso(a));
    if (!vs.length) continue;
    const v = vs[0];
    out.push({
      gameId: g.id, date: g.date, home: g.home, away: g.away,
      picks: g.verdicts.filter(x => x.verdict === 'bet').length,
      mejor: { market: v.market, label: v.label, verdict: v.verdict, prob: v.prob, edge: v.edge != null ? v.edge : null, peso: +peso(v).toFixed(3), line_txt: v.line_txt || '' },
    });
  }
  return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
async function proximos() { return (await kvGet(KV_PROXIMOS)) || {}; }

/* ---------- 2) marcadores ---------- */
const ESPN = 'https://site.web.api.espn.com/apis/site/v2/sports/';
const ESPN_FALLBACK = 'https://site.api.espn.com/apis/site/v2/sports/';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Referer': 'https://www.espn.com/',
};
async function fetchEspn(path) {
  let last;
  for (const host of [ESPN, ESPN, ESPN_FALLBACK]) {
    try {
      const r = await fetch(host + path, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; }
  }
  throw last;
}

/* { estado: 'final'|'anulado'|'pendiente', home, away, h1home, h1away } */
async function marcador(liga, gameId) {
  const cfg = LIGAS[liga];
  if (cfg.mlb) {
    const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('statsapi ' + r.status);
    const j = await r.json();
    const st = (j.gameData && j.gameData.status) || {};
    if (/Postponed|Cancelled|Suspended/i.test(st.detailedState || '')) return { estado: 'anulado' };
    if (st.abstractGameState !== 'Final') return { estado: 'pendiente' };
    const t = j.liveData.linescore.teams;
    return { estado: 'final', home: t.home.runs, away: t.away.runs };
  }
  const j = await fetchEspn(`${cfg.espn}/summary?event=${gameId}`);
  const comp = j.header && j.header.competitions && j.header.competitions[0];
  if (!comp) return { estado: 'pendiente' };
  const tipo = (comp.status && comp.status.type) || {};
  if (/POSTPONED|CANCELED|CANCELLED|ABANDONED|FORFEIT/.test(tipo.name || '')) return { estado: 'anulado' };
  if (!tipo.completed) return { estado: 'pendiente' };
  const lado = ha => comp.competitors.find(c => c.homeAway === ha) || {};
  const h = lado('home'), a = lado('away');
  const mitad = c => (c.linescores || []).slice(0, 2).reduce((s, x) => s + Number(x.value != null ? x.value : x.displayValue || 0), 0);
  const conMitad = (h.linescores || []).length >= 2 && (a.linescores || []).length >= 2;
  return {
    estado: 'final', home: Number(h.score), away: Number(a.score),
    h1home: conMitad ? mitad(h) : null, h1away: conMitad ? mitad(a) : null,
  };
}

/* ---------- 3) calificar un pick con el marcador ----------
   Devuelve 'gano' | 'perdio' | 'empate' | null (mercado que no se
   sabe calificar: F5, NRFI…). */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const signo = x => (x > 0 ? 'gano' : x < 0 ? 'perdio' : 'empate');
function califica(e, m) {
  const H = m.home, A = m.away;
  const lado = nombre => (norm(nombre) === norm(e.home) ? 'home' : norm(nombre) === norm(e.away) ? 'away' : null);
  const margen = s => (s === 'home' ? H - A : A - H);
  const L = e.label;
  const tot = L.match(/(Más|Menos) de ([\d.]+)/);
  switch (e.market) {
    case 'moneyline': case 'ML': {
      const s = lado(L.replace(/^Ganador:\s*/, '').replace(/^Ganan los\s*/, ''));
      return s ? signo(margen(s)) : null;
    }
    case '1x2': {
      if (/^Empate/.test(L)) return H === A ? 'gano' : 'perdio';
      const s = lado(L.replace(/^Gana\s*/, ''));
      return s ? (margen(s) > 0 ? 'gano' : 'perdio') : null;
    }
    case 'spread': case 'RL': {
      const mm = L.replace(/^Hándicap:\s*/, '').match(/^(.*)\s([+-]?[\d.]+)$/);
      if (!mm) return null;
      const s = lado(mm[1]);
      return s ? signo(margen(s) + parseFloat(mm[2])) : null;
    }
    case 'total': case 'TOTAL': {
      if (!tot) return null;
      const d = H + A - parseFloat(tot[2]);
      return signo(tot[1] === 'Más' ? d : -d);
    }
    case 'h1_total': {
      if (!tot || m.h1home == null) return null;
      const d = m.h1home + m.h1away - parseFloat(tot[2]);
      return signo(tot[1] === 'Más' ? d : -d);
    }
    case 'double_chance': {
      if (/\(1X\)/.test(L)) return H >= A ? 'gano' : 'perdio';
      if (/\(X2\)/.test(L)) return A >= H ? 'gano' : 'perdio';
      if (/\(12\)/.test(L)) return H !== A ? 'gano' : 'perdio';
      return null;
    }
    case 'btts': {
      const ambos = H > 0 && A > 0;
      return /S[IÍ]$/i.test(L) ? (ambos ? 'gano' : 'perdio') : (ambos ? 'perdio' : 'gano');
    }
    default: return null;
  }
}
const unidades = e => (e.resultado === 'gano' ? +(e.dec - 1).toFixed(3) : e.resultado === 'perdio' ? -1 : 0);

/* Califica todo lo que ya arrancó hace más de 2 h y no tiene
   resultado. Revisa el mes actual y el anterior. */
async function calificar({ now = Date.now() } = {}) {
  const meses = [mesDe(new Date(now).toISOString()), mesDe(new Date(now - 32 * 86400e3).toISOString())];
  const out = { calificados: 0, pendientes: 0, errores: [] };
  for (const mes of [...new Set(meses)]) {
    const libro = await kvGet(kvMes(mes));
    if (!libro) continue;
    const porPartido = {};
    for (const [k, e] of Object.entries(libro)) {
      if (e.resultado || Date.parse(e.date) > now - 2 * 3600e3) continue;
      (porPartido[e.liga + ':' + e.gameId] = porPartido[e.liga + ':' + e.gameId] || []).push(k);
    }
    let cambio = false;
    for (const [pk, keys] of Object.entries(porPartido)) {
      const [liga, gameId] = pk.split(':');
      let m;
      try { m = await marcador(liga, gameId); }
      catch (e) { out.errores.push(pk + ': ' + e.message); continue; }
      if (m.estado === 'pendiente') {
        /* un partido que a los 4 días sigue sin final se anula */
        if (Date.parse(libro[keys[0]].date) < now - 4 * 86400e3) m = { estado: 'anulado' };
        else { out.pendientes += keys.length; continue; }
      }
      for (const k of keys) {
        const e = libro[k];
        e.resultado = m.estado === 'anulado' ? 'anulado' : (califica(e, m) || 'sin_calificar');
        if (m.estado === 'final') e.marcador = `${m.home}-${m.away}`;
        e.unidades = unidades(e);
        e.calificado = new Date(now).toISOString();
        out.calificados++;
        cambio = true;
      }
    }
    if (cambio) await kvPut(kvMes(mes), libro);
  }
  return out;
}

/* ---------- 4) lecturas ---------- */
/* Lunes 00:00 CDMX de la semana que contiene `t` (ms). CDMX no tiene
   horario de verano desde 2022: UTC-6 fijo. */
function lunesDe(t) {
  const off = 6 * 3600e3;
  const local = new Date(t - off);
  const dow = (local.getUTCDay() + 6) % 7;   // 0 = lunes
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow) + off;
}

/* Todas las entradas con arranque en [desde, hasta). */
async function entradas(desde, hasta) {
  const meses = new Set();
  for (let t = desde; t < hasta; t += 86400e3) meses.add(mesDe(new Date(t).toISOString()));
  meses.add(mesDe(new Date(hasta - 1).toISOString()));
  const out = [];
  for (const mes of meses) {
    const libro = (await kvGet(kvMes(mes))) || {};
    for (const e of Object.values(libro)) { const t = Date.parse(e.date); if (t >= desde && t < hasta) out.push(e); }
  }
  return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/* Balance de un conjunto de entradas, total y por liga. Solo cuentan
   las calificadas (gano/perdio/empate). */
function balance(lista, ligas) {
  const filtro = ligas ? lista.filter(e => ligas.includes(e.liga)) : lista;
  const vacio = () => ({ picks: 0, gano: 0, perdio: 0, empate: 0, unidades: 0, pendientes: 0 });
  const total = vacio(); const porLiga = {};
  for (const e of filtro) {
    const b = (porLiga[e.liga] = porLiga[e.liga] || vacio());
    for (const x of [total, b]) {
      if (['gano', 'perdio', 'empate'].includes(e.resultado)) { x.picks++; x[e.resultado]++; x.unidades += e.unidades; }
      else if (!e.resultado) x.pendientes++;
    }
  }
  const r = x => Object.assign(x, { unidades: +x.unidades.toFixed(2) });
  r(total); Object.values(porLiga).forEach(r);
  return { total, porLiga };
}

/* Las últimas `n` semanas cerradas (lunes a domingo) antes de `now`. */
async function semanas(n = 4, now = Date.now(), ligas) {
  const fin = lunesDe(now);
  const ini = fin - n * 7 * 86400e3;
  const todas = await entradas(ini, fin);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = ini + i * 7 * 86400e3, h = d + 7 * 86400e3;
    out.push({ desde: new Date(d).toISOString(), hasta: new Date(h).toISOString(), ...balance(todas.filter(e => { const t = Date.parse(e.date); return t >= d && t < h; }), ligas) });
  }
  return out;
}

module.exports = { LIGAS, foto, proximos, calificar, califica, precio, marcador, entradas, balance, semanas, lunesDe, mesDe };
