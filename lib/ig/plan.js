/* ============================================================
   El PLAN del post diario: qué ligas entran hoy, qué láminas
   lleva el carrusel y qué dice el caption.

   Fuente de los datos: los MISMOS endpoints públicos que pintan
   la card del landing (/api/mx-free, /api/euro-free, /api/mlb-free
   y /api/nfl-picks como invitado). Así el post enseña exactamente
   el pick gratis que ve quien entra a dattip.com — overrides
   manuales y clavado en el KV incluidos — y no hay una segunda
   elección que pueda desincronizarse.

   Reglas del plan:
   - Entra una liga si su pick gratis se juega MAÑANA (fecha de
     CDMX). El post sale siempre un día antes del partido, para
     todas las ligas (regla del dueño, 10-oct-2026): lo de hoy ya
     no se publica, lo de pasado mañana todavía no.
   - Un partido se publica UNA sola vez (lib/ig/publish lleva el
     registro); si ya salió, la liga se salta aunque siga vigente.
   - UN POST POR LIGA (regla del dueño, 12-oct-2026): si mañana
     juegan cuatro ligas, salen cuatro carruseles, cada uno con la
     portada de su partido (réplica exacta del post manual), en el
     orden del landing (NFL, Liga MX, Champions, MLB, Premier,
     LaLiga, Bundesliga). Antes se juntaban todas en un solo carrusel
     y el cupo de 10 láminas obligaba a recortar.
   ============================================================ */
const { fetchImage, dominantColor, rgb, dist } = require('./render');
const { propFrase, propProyeccion, propVeces } = require('../../public/props-frase.js');

const MX_TZ = 'America/Mexico_City';
const DIA_MS = 86400 * 1000;
const MAX_SLIDES = 10;
const KEYWORD = 'MODELO';

const ESPN_LEAGUE = id => `https://a.espncdn.com/i/leaguelogos/soccer/500/${id}.png`;
const LIGAS = [
  { id: 'nfl',        nombre: 'NFL',            keyword: 'NFL',        emoji: '🏈', api: '/api/nfl-picks',                   logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png', tags: ['nfl'] },
  { id: 'mx',         nombre: 'Liga MX',        keyword: 'LIGAMX',     emoji: '⚽', api: '/api/mx-free',                     logo: ESPN_LEAGUE(22), tags: ['ligamx'], badge: 'light' },
  { id: 'ucl',        nombre: 'Champions',      keyword: 'CHAMPIONS',  emoji: '⚽', api: '/api/euro-free?liga=ucl',          logo: ESPN_LEAGUE(2),  tags: ['championsleague'], badge: 'light' },
  { id: 'mlb',        nombre: 'MLB',            keyword: 'MLB',        emoji: '⚾', api: '/api/mlb-free',                    logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png', tags: ['mlb'] },
  { id: 'epl',        nombre: 'Premier League', keyword: 'PREMIER',    emoji: '⚽', api: '/api/euro-free?liga=epl',          logo: ESPN_LEAGUE(23), tags: ['premierleague'], badge: 'light' },
  { id: 'laliga',     nombre: 'LaLiga',         keyword: 'LALIGA',     emoji: '⚽', api: '/api/euro-free?liga=laliga',       logo: ESPN_LEAGUE(15), tags: ['laliga'], badge: 'light' },
  { id: 'bundesliga', nombre: 'Bundesliga',     keyword: 'BUNDESLIGA', emoji: '⚽', api: '/api/euro-free?liga=bundesliga',   logo: ESPN_LEAGUE(10), tags: ['bundesliga'], badge: 'light' },
  /* NBA (26-oct-2026): mientras el modelo esté en beta privada,
     /api/nba-free contesta 403 y la liga se salta sola ("error: HTTP
     403" en saltadas). Al abrirla, entra al post diario sin tocar nada. */
  { id: 'nba',        nombre: 'NBA',            keyword: 'NBA',        emoji: '🏀', api: '/api/nba-free',                    logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', tags: ['nba'] },
];

const pct = p => (p == null ? '—' : Math.round(p * 100) + '%');
const pct1 = p => (p == null ? null : (p * 100).toFixed(1) + '%');
const edgeTxt = e => (e == null ? null : 'edge ' + (e >= 0 ? '+' : '') + (e * 100).toFixed(1) + '%');
const VCHIP = { bet: 'PICK', maybe: 'MAYBE', skip: 'SKIP' };

function fechaCard(iso) {
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: MX_TZ })
    .toUpperCase().replace(/\./g, '');
}
function fechaLarga(d) {
  return new Date(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: MX_TZ }).toUpperCase();
}
function hoyMx(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/* ---- base URL del propio sitio ---- */
function baseUrl() {
  const dev = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
  if (dev) return 'http://localhost:' + (process.env.PORT || 3000);
  if (process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL)) return process.env.SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return 'https://dattip.com';
}

async function getJson(url, ms = 120000, headers = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: Object.assign({ 'x-ig-daily': '1' }, headers) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ---- de la respuesta de cada API a una forma común ---- */
function normaliza(cfg, d) {
  if (!d) return null;
  const m = cfg.id;
  if (m === 'nfl') {
    const g = (d.games || []).find(x => x.id === d.featured_id);
    if (!g || !g.home || !g.away) return null;
    const ml = (g.markets && g.markets.moneyline) || {};
    const v = d.featured_pick || null;
    return {
      gameId: g.id, date: g.date, state: g.state, venue: g.venue || '',
      jornada: (g.preseason ? 'PRETEMPORADA ' : 'SEMANA ') + (d.week || ''),
      home: { name: g.home.name, sub: g.home.city || '', logo: g.home.logo, prob: ml.home },
      away: { name: g.away.name, sub: g.away.city || '', logo: g.away.logo, prob: ml.away },
      pick: v, verdicts: g.verdicts || [],
      props: { week: d.week, st: d.seasontype },
    };
  }
  if (m === 'mlb') {
    const g = d.game;
    if (!g) return null;
    const ml = g.moneyline || {};
    const logo = ab => `https://a.espncdn.com/i/teamlogos/mlb/500/${String(ab).toLowerCase()}.png`;
    return {
      gameId: String(g.gamePk), date: g.game_date, state: 'pre', venue: g.venue || '', jornada: 'HOY',
      home: { name: g.home.name, sub: g.pitchers && g.pitchers.home ? 'Abre ' + g.pitchers.home.name : (g.home.record || ''), logo: logo(g.home.abbr), prob: ml.home },
      away: { name: g.away.name, sub: g.pitchers && g.pitchers.away ? 'Abre ' + g.pitchers.away.name : (g.away.record || ''), logo: logo(g.away.abbr), prob: ml.away },
      pick: g.verdict || null, verdicts: g.verdicts || [],
    };
  }
  if (m === 'nba') {
    const g = d.game;
    if (!g) return null;
    const ml = g.moneyline || {};
    return {
      gameId: String(g.id), date: g.date, state: g.state || 'pre', venue: g.venue || '',
      jornada: new Date(g.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: MX_TZ }).replace(/\./g, '').toUpperCase(),
      home: { name: g.home.name, sub: g.home.city || 'Local', logo: g.home.logo, prob: ml.home },
      away: { name: g.away.name, sub: g.away.city || 'Visitante', logo: g.away.logo, prob: ml.away },
      pick: g.pick || null, verdicts: g.verdicts || [],
      props: { nba: true },
    };
  }
  /* Liga MX y Europa: misma forma */
  const g = d.game;
  if (!g) return null;
  const ml = g.moneyline || {};
  return {
    gameId: String(g.id), date: g.date, state: 'pre', venue: g.venue || '',
    jornada: d.jornada ? 'JORNADA ' + d.jornada : '',
    home: { name: g.home.name, sub: 'Local', logo: g.home.logo, prob: ml.home },
    away: { name: g.away.name, sub: 'Visitante', logo: g.away.logo, prob: ml.away },
    pick: g.pick || null, verdicts: g.verdicts || [],
  };
}

/* ---- ¿entra hoy? Solo si el partido es MAÑANA (día de CDMX). ---- */
function vigente(n, now) {
  if (!n || !n.date) return false;
  const t = new Date(n.date).getTime();
  if (!(t > now)) return false;                       // ya empezó o ya se jugó
  if (n.state && n.state !== 'pre') return false;
  return hoyMx(t) === hoyMx(now + DIA_MS);
}

/* ---- props: los dos jugadores con más que decir ----
   NFL y NBA comparten forma ({ players: [{ name, pos, team, minutes,
   markets: [{ key, label, line, side, p, ev, verdict, model }] }] }).

   NBA, 28-oct-2026: el post sale a las 9:00 del día anterior y a esa
   hora las casas todavía NO publican líneas de props de NBA (salen
   el mismo día), así que la lámina nunca aparecía. Ahora, si un
   mercado no tiene línea, el renglón enseña la PROYECCIÓN del modelo
   ("modelo espera 25.2") con el chip MODELO en vez de PICK/SKIP; en
   cuanto hay línea, vuelve el veredicto. */
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3 };
const KEY_ORDER = { pts: 0, reb: 1, ast: 2, tpm: 3, pra: 4, dd: 5 };
function armaProps(d) {
  if (!d || !Array.isArray(d.players)) return null;
  const players = d.players.map(p => {
    const rows = [];
    for (const mk of (p.markets || [])) {
      const conLinea = mk.line && (mk.line.point != null || mk.key === 'anytime_td' || mk.key === 'dd');
      /* El renglón es la apuesta en palabras ("Agarra 3 pases o más")
         y debajo qué tan seguido pasa — igual que en el sitio
         (public/props-frase.js, 28-oct-2026). */
      if (conLinea && mk.verdict && mk.verdict !== 'lectura') {
        rows.push({ title: propFrase(mk) || mk.label, verdict: mk.verdict, meta: propVeces(mk.p) || '', lined: true, key: mk.key });
      } else if (mk.model && (mk.model.mu != null || mk.model.p != null)) {
        /* sin línea: la proyección del modelo */
        const meta = mk.key === 'dd' ? propVeces(mk.model.p) : 'Lo que espera el modelo';
        rows.push({ title: propProyeccion(mk) || mk.label, verdict: 'lectura', meta, lined: false, key: mk.key });
      }
    }
    rows.sort((a, b) => (b.lined - a.lined) || ((KEY_ORDER[a.key] ?? 9) - (KEY_ORDER[b.key] ?? 9)));
    const bets = rows.filter(r => r.verdict === 'bet').length;
    const lined = rows.filter(r => r.lined).length;
    const ptsMk = (p.markets || []).find(mk => mk.key === 'pts' || mk.key === 'pass_yds' || mk.key === 'rush_yds' || mk.key === 'reception_yds');
    return { name: p.name, sub: `${p.pos || ''} · ${p.team}`, team: p.team, rows, bets, lined, games: p.games || 0,
             peso: ptsMk && ptsMk.model ? (ptsMk.model.mu || 0) : 0,
             pos: POS_ORDER[p.pos] ?? (p.minutes != null ? -p.minutes : 9) };
  }).filter(p => p.rows.length >= 2);
  if (!players.length) return null;
  /* Muestra chica (un suplente con 6 juegos y 37 minutos inflados) no
     va a la lámina si hay jugadores con historial de sobra. */
  const conMuestra = players.filter(p => p.games >= 10);
  const pool = conMuestra.length >= 2 ? conMuestra : players;
  /* Orden: quien tenga PICKs, luego quien tenga líneas, luego el de
     más proyección (la estrella: lo que la gente quiere ver). */
  pool.sort((a, b) => b.bets - a.bets || b.lined - a.lined || b.peso - a.peso || a.pos - b.pos);
  /* Uno por equipo cuando se puede. */
  const primero = pool[0];
  const segundo = pool.find(p => p !== primero && p.team !== primero.team) || pool[1];
  const elegidos = [primero, segundo].filter(Boolean);
  const sinLineas = !elegidos.some(p => p.lined);
  return { players: elegidos, note: sinLineas ? 'PROYECCIÓN DEL MODELO · LAS LÍNEAS ABREN EL DÍA DEL JUEGO' : null };
}

/* ---- escudos + colores de la franja de portada ---- */
async function armaStrip(cfg, n) {
  const [h, a, l] = await Promise.all([fetchImage(n.home.logo), fetchImage(n.away.logo), fetchImage(cfg.logo)]);
  let ch = h ? await dominantColor(h.png) : [20, 32, 60];
  let ca = a ? await dominantColor(a.png) : [40, 52, 80];
  /* Dos colores casi iguales (dos equipos de azul marino) se
     separan aclarando uno, para que la franja siga leyéndose como
     dos mitades. */
  if (dist(ch, ca) < 60) ca = ca.map(v => Math.min(255, v * 1.45 + 30));
  /* Panel casi negro (White Sox): el escudo negro desaparecería; se
     marca para pintarle un halo claro detrás. */
  const oscuro = c => (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) < 45;
  /* El cuadro de la insignia: azul marino para NFL y MLB (como el post
     de referencia, sus logos traen blanco); claro para las ligas de
     futbol, cuyas insignias (Liga MX, Premier) se pierden sobre oscuro. */
  const leagueDark = cfg.badge === 'light';
  return {
    homeLogo: h && h.dataUri, awayLogo: a && a.dataUri, leagueLogo: l && l.dataUri, leagueDark,
    homeColor: rgb(ch, 0.78), awayColor: rgb(ca, 0.78), homeDark: oscuro(ch), awayDark: oscuro(ca),
    leagueAbbr: cfg.nombre.slice(0, 3).toUpperCase(),
  };
}

/* ---- láminas de una liga ---- */
async function laminasDe(cfg, n, base, headers = {}) {
  const favH = (n.home.prob || 0) >= (n.away.prob || 0);
  const barA = Math.round((n.away.prob || (n.home.prob ? 1 - n.home.prob : 0.5)) * 100);
  const [h, a] = await Promise.all([fetchImage(n.home.logo), fetchImage(n.away.logo)]);
  const eyebrow = `${cfg.nombre} · ${n.jornada}`.toUpperCase();
  const pick = n.pick || { verdict: 'bet', label: 'Pick del modelo', prob: null };
  const slides = [
    { kind: 'principal', eyebrow, title: ['PICK', 'PRINCIPAL'], game: {
      meta: fechaCard(n.date), venue: n.venue, favAway: !favH, barA,
      home: { name: n.home.name, sub: n.home.sub, logo: h && h.dataUri, prob: pct(n.home.prob) },
      away: { name: n.away.name, sub: n.away.sub, logo: a && a.dataUri, prob: pct(n.away.prob) },
      pick: { verdict: pick.verdict, chip: VCHIP[pick.verdict] || 'PICK', label: pick.label, prob: pct(pick.prob) },
    } },
  ];
  const rows = (n.verdicts || []).filter(v => v && v.label).map(v => ({
    title: v.label, verdict: v.verdict,
    meta: [v.line_txt, pct1(v.prob), edgeTxt(v.edge)].filter(Boolean).join(' · '),
  }));
  if (rows.length) slides.push({ kind: 'markets', eyebrow, title: ['PICKS', 'ALTERNATIVOS'], rows });
  if (cfg.id === 'nba' && n.props) {
    try {
      const d = await getJson(`${base}/api/nba-props?game=${encodeURIComponent(n.gameId)}`, 170000, headers);
      const pr = armaProps(d);
      if (pr) slides.push({ kind: 'props', eyebrow, title: ['PROPS', 'JUGADOR'], players: pr.players, note: pr.note, optional: true });
    } catch (e) { console.error('ig-plan: props NBA no disponibles', e.message); }
  }
  if (cfg.id === 'nfl' && n.props) {
    try {
      const d = await getJson(`${base}/api/nfl-props?game=${encodeURIComponent(n.gameId)}&st=${n.props.st}&week=${n.props.week}`, 170000, headers);
      const pr = armaProps(d);
      if (pr) slides.push({ kind: 'props', eyebrow, title: ['PROPS', 'JUGADOR'], players: pr.players, note: pr.note, optional: true });
    } catch (e) { console.error('ig-plan: props no disponibles', e.message); }
  }
  return slides;
}

/* ---- caption ---- */
function caption({ cfg, n }, keyword) {
  const head = `${cfg.emoji} FREE PICK DE MAÑANA ‼️`;
  const linea = `${cfg.emoji} ${cfg.nombre} · ${n.away.name} @ ${n.home.name}\n→ ${n.pick ? n.pick.label + (n.pick.prob != null ? ' · ' + pct(n.pick.prob) : '') : 'Pick del modelo'}`;
  /* Instagram solo toma en cuenta 5 hashtags (regla del dueño,
     10-oct-2026): los dos de alcance general, el de la liga, y se
     rellena con los de respaldo hasta llegar a cinco. */
  const tags = ['sportsbetting', 'picks'];
  for (const t of cfg.tags) if (!tags.includes(t)) tags.push(t);
  for (const t of ['pronosticos', 'parlay', 'deportes']) if (tags.length < 5 && !tags.includes(t)) tags.push(t);
  tags.length = Math.min(tags.length, 5);
  return [
    head, '', linea, '',
    'El modelo analiza más de 10,000 resultados antes de cada juego para darte el mejor pick 🧠',
    '', `Comenta ${keyword} para analizar los demás juegos 🤑`, '',
    tags.map(t => '#' + t).join(' '),
  ].join('\n');
}

/* ============================================================
   armaPlan({ now, yaPublicados: Set<'liga:gameId'>, keyword })
   → { vacio, fecha, keyword, posts: [...], saltadas }
   Cada post: { liga, nombre, clave, partido, fecha, pick, slides,
   caption } — un carrusel independiente por liga.
   ============================================================ */
async function armaPlan(opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const yaPublicados = opts.yaPublicados || new Set();
  const base = opts.base || baseUrl();

  /* Las siete ligas en paralelo; la que falle se salta, no tumba el resto. */
  const crudos = await Promise.all(LIGAS.map(async cfg => {
    try { return { cfg, n: normaliza(cfg, await getJson(base + cfg.api)) }; }
    catch (e) { console.error('ig-plan:', cfg.id, e.message); return { cfg, n: null, error: e.message }; }
  }));

  const entradas = [], saltadas = [];
  for (const c of crudos) {
    if (!c.n) { saltadas.push({ liga: c.cfg.id, motivo: c.error ? 'error: ' + c.error : 'sin partido' }); continue; }
    c.clave = `${c.cfg.id}:${c.n.gameId}`;
    if (!vigente(c.n, now)) { saltadas.push({ liga: c.cfg.id, motivo: 'no es mañana (' + c.n.date + ')' }); continue; }
    if (yaPublicados.has(c.clave)) { saltadas.push({ liga: c.cfg.id, motivo: 'ya publicado' }); continue; }
    entradas.push(c);
  }
  const fecha = hoyMx(now);
  if (!entradas.length) return { vacio: true, fecha, posts: [], saltadas };

  /* La palabra para comentar es SIEMPRE "MODELO" (decisión del dueño,
     10-oct-2026): una sola regla de respuesta en ig_rules y una sola
     palabra que la gente se aprende. Desde el panel se puede cambiar. */
  const keyword = opts.keyword || KEYWORD;

  const posts = [];
  for (const c of entradas) {
    const [strip, cuerpo] = await Promise.all([armaStrip(c.cfg, c.n), laminasDe(c.cfg, c.n, base)]);
    const cover = { kind: 'cover', title: ['FREE', 'PICK'], subtitle: `${c.cfg.nombre} · ${c.n.jornada}`, strips: [strip] };
    const cta = { kind: 'cta', keyword };
    posts.push({
      liga: c.cfg.id, nombre: c.cfg.nombre, clave: c.clave,
      partido: `${c.n.away.name} @ ${c.n.home.name}`, fecha: c.n.date, pick: c.n.pick,
      slides: [cover, ...cuerpo, cta].slice(0, MAX_SLIDES),
      caption: caption(c, keyword),
    });
  }

  return { vacio: false, fecha, keyword, posts, saltadas };
}

/* ============================================================
   armaPostDe({ liga, gameId | equipo, auth, keyword })
   Un post SUELTO para un partido concreto, sin tocar el pick gratis
   del sitio (el dueño quiere publicar en Instagram un partido que la
   plataforma no regala, p. ej. un partidazo). Lee el tablero
   COMPLETO de la liga con la sesión del admin (los invitados reciben
   los partidos bloqueados) y arma el mismo carrusel.
   ============================================================ */
const BOARD = {
  nfl: '/api/nfl-picks', mx: '/api/mx-picks', mlb: '/api/mlb-picks', nba: '/api/nba-picks',
  ucl: '/api/euro-picks?liga=ucl', epl: '/api/euro-picks?liga=epl', laliga: '/api/euro-picks?liga=laliga', bundesliga: '/api/euro-picks?liga=bundesliga',
};
async function armaPostDe(opts) {
  const cfg = LIGAS.find(l => l.id === opts.liga);
  if (!cfg || !BOARD[cfg.id]) throw new Error('Liga desconocida.');
  const base = opts.base || baseUrl();
  /* Credenciales para el tablero completo: la sesión del admin (desde
     el panel) o el secreto interno (desde la cola). */
  const headers = opts.headers || (opts.auth ? { Authorization: opts.auth } : {});
  const r = await fetch(base + BOARD[cfg.id], { signal: AbortSignal.timeout(170000), headers });
  if (!r.ok) throw new Error('Tablero HTTP ' + r.status);
  const d = await r.json();
  const games = (d.games || []).filter(g => !g.error);
  const q = normalizaTxt(opts.equipo || '');
  const g = games.find(x => opts.gameId && String(x.id || x.gamePk) === String(opts.gameId))
    || (q ? games.find(x => normalizaTxt(x.home.name).includes(q) || normalizaTxt(x.away.name).includes(q)) : null);
  if (!g) throw new Error('No encontré ese partido en el tablero de ' + cfg.nombre + '.');
  if (g.locked) throw new Error('El tablero llegó bloqueado (sin sesión de admin).');
  const { veredictoDeCard } = require('../free-pick');
  const pick = veredictoDeCard(g.verdicts);
  /* Al shape de /api/*-free, que es lo que entiende normaliza(). */
  let n;
  if (cfg.id === 'nfl') n = normaliza(cfg, { ...d, featured_id: g.id, featured_pick: pick ? { verdict: pick.verdict, label: pick.label, prob: pick.prob } : null });
  else if (cfg.id === 'nba') n = normaliza(cfg, { game: { ...g, moneyline: g.markets ? g.markets.moneyline : g.moneyline, pick } });
  else if (cfg.id === 'mlb') n = normaliza(cfg, { game: { ...g, verdict: pick ? { verdict: pick.verdict, label: pick.label, prob: pick.prob } : null, moneyline: g.markets ? g.markets.moneyline : g.moneyline } });
  else n = normaliza(cfg, { jornada: d.jornada, game: { ...g, moneyline: g.markets ? g.markets.moneyline : g.moneyline, pick } });
  if (!n) throw new Error('No pude leer ese partido.');
  const keyword = opts.keyword || KEYWORD;
  const [strip, cuerpo] = await Promise.all([armaStrip(cfg, n), laminasDe(cfg, n, base, headers)]);
  const cover = { kind: 'cover', title: ['FREE', 'PICK'], subtitle: `${cfg.nombre} · ${n.jornada}`, strips: [strip] };
  return {
    liga: cfg.id, nombre: cfg.nombre, clave: `${cfg.id}:${n.gameId}`, fecha: n.date,
    partido: `${n.away.name} @ ${n.home.name}`, pick: n.pick,
    slides: [cover, ...cuerpo, { kind: 'cta', keyword }].slice(0, MAX_SLIDES),
    caption: caption({ cfg, n }, keyword),
  };
}
const normalizaTxt = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

module.exports = { armaPlan, armaPostDe, LIGAS, baseUrl, MAX_SLIDES, KEYWORD, hoyMx, normaliza, getJson, fechaCard };
