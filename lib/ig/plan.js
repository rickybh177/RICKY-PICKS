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
   - Entra una liga si su pick gratis es un partido que NO ha
     empezado y arranca dentro de VENTANA_H horas (hoy o mañana).
   - Un partido se publica UNA sola vez (lib/ig/publish lleva el
     registro); si ya salió, la liga se salta aunque siga vigente.
   - Instagram admite 10 láminas por carrusel: portada + cierre
     fijas, y 2 por liga (3 en NFL, por los props), en el orden del
     landing (NFL, Liga MX, Champions, MLB, Premier, LaLiga,
     Bundesliga) hasta llenar el cupo.
   ============================================================ */
const { fetchImage, dominantColor, rgb, dist } = require('./render');

const MX_TZ = 'America/Mexico_City';
const VENTANA_H = 40;
const MAX_SLIDES = 10;
const KEYWORD = 'MODELO';

const ESPN_LEAGUE = id => `https://a.espncdn.com/i/leaguelogos/soccer/500/${id}.png`;
const LIGAS = [
  { id: 'nfl',        nombre: 'NFL',            keyword: 'NFL',        emoji: '🏈', api: '/api/nfl-picks',                   logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png', tags: ['nfl', 'nflmx'] },
  { id: 'mx',         nombre: 'Liga MX',        keyword: 'LIGAMX',     emoji: '⚽', api: '/api/mx-free',                     logo: ESPN_LEAGUE(22), tags: ['ligamx', 'futbolmexicano'] },
  { id: 'ucl',        nombre: 'Champions',      keyword: 'CHAMPIONS',  emoji: '⚽', api: '/api/euro-free?liga=ucl',          logo: ESPN_LEAGUE(2),  tags: ['championsleague', 'ucl'] },
  { id: 'mlb',        nombre: 'MLB',            keyword: 'MLB',        emoji: '⚾', api: '/api/mlb-free',                    logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png', tags: ['mlb', 'beisbol'] },
  { id: 'epl',        nombre: 'Premier League', keyword: 'PREMIER',    emoji: '⚽', api: '/api/euro-free?liga=epl',          logo: ESPN_LEAGUE(23), tags: ['premierleague', 'epl'] },
  { id: 'laliga',     nombre: 'LaLiga',         keyword: 'LALIGA',     emoji: '⚽', api: '/api/euro-free?liga=laliga',       logo: ESPN_LEAGUE(15), tags: ['laliga', 'futbol'] },
  { id: 'bundesliga', nombre: 'Bundesliga',     keyword: 'BUNDESLIGA', emoji: '⚽', api: '/api/euro-free?liga=bundesliga',   logo: ESPN_LEAGUE(10), tags: ['bundesliga', 'futbol'] },
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

async function getJson(url, ms = 120000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'x-ig-daily': '1' } });
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

/* ---- ¿entra hoy? ---- */
function vigente(n, now) {
  if (!n || !n.date) return false;
  const t = new Date(n.date).getTime();
  if (!(t > now)) return false;                       // ya empezó o ya se jugó
  if (n.state && n.state !== 'pre') return false;
  return t - now <= VENTANA_H * 3600 * 1000;          // hoy o mañana
}

/* ---- props NFL: los dos jugadores con más que decir ---- */
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3 };
function armaProps(d) {
  if (!d || !Array.isArray(d.players)) return null;
  const players = d.players.map(p => {
    const rows = (p.markets || []).filter(mk => mk.line && (mk.line.point != null || mk.key === 'anytime_td')).map(mk => {
      const lado = mk.key === 'anytime_td' ? 'Sí anota TD' : (mk.side === 'under' ? 'Menos de ' : 'Más de ') + mk.line.point;
      return { title: mk.label, verdict: mk.verdict, meta: [lado, pct1(mk.p), edgeTxt(mk.ev)].filter(Boolean).join(' · ') };
    });
    const bets = rows.filter(r => r.verdict === 'bet').length;
    return { name: p.name, sub: `${p.pos} · ${p.team}`, rows, bets, pos: POS_ORDER[p.pos] ?? 9 };
  }).filter(p => p.rows.length >= 2);
  players.sort((a, b) => b.bets - a.bets || a.pos - b.pos || b.rows.length - a.rows.length);
  return players.length ? players.slice(0, 2) : null;
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
  return {
    homeLogo: h && h.dataUri, awayLogo: a && a.dataUri, leagueLogo: l && l.dataUri,
    homeColor: rgb(ch, 0.78), awayColor: rgb(ca, 0.78), homeDark: oscuro(ch), awayDark: oscuro(ca),
    leagueAbbr: cfg.nombre.slice(0, 3).toUpperCase(),
  };
}

/* ---- láminas de una liga ---- */
async function laminasDe(cfg, n, base) {
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
  if (cfg.id === 'nfl' && n.props) {
    try {
      const d = await getJson(`${base}/api/nfl-props?game=${encodeURIComponent(n.gameId)}&st=${n.props.st}&week=${n.props.week}`);
      const players = armaProps(d);
      if (players) slides.push({ kind: 'props', eyebrow, title: ['PROPS', 'JUGADOR'], players, optional: true });
    } catch (e) { console.error('ig-plan: props no disponibles', e.message); }
  }
  return slides;
}

/* ---- caption ---- */
function caption(entradas, keyword) {
  const uno = entradas.length === 1;
  const head = `${uno ? entradas[0].cfg.emoji : '🔥'} FREE PICK${uno ? '' : 'S'} DE HOY ‼️`;
  const lineas = entradas.map(({ cfg, n }) =>
    `${cfg.emoji} ${cfg.nombre} · ${n.away.name} @ ${n.home.name}\n→ ${n.pick ? n.pick.label + (n.pick.prob != null ? ' · ' + pct(n.pick.prob) : '') : 'Pick del modelo'}`);
  const tags = ['picks', 'apuestasdeportivas', 'pronosticos', 'sportsbetting'];
  for (const { cfg } of entradas) for (const t of cfg.tags) if (!tags.includes(t)) tags.push(t);
  return [
    head, '', lineas.join('\n\n'), '',
    'El modelo analiza más de 10,000 resultados antes de cada juego para darte el mejor pick 🧠',
    '', `Comenta ${keyword} para analizar los demás juegos 🤑`, '',
    tags.map(t => '#' + t).join(' '),
  ].join('\n');
}

/* ============================================================
   armaPlan({ now, yaPublicados: Set<'liga:gameId'>, keyword })
   → { vacio, entradas, slides, caption, keyword, claves, fecha }
   ============================================================ */
async function armaPlan(opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const yaPublicados = opts.yaPublicados || new Set();
  const base = opts.base || baseUrl();

  /* Las siete ligas en paralelo; la que falle se salta, no tumba el post. */
  const crudos = await Promise.all(LIGAS.map(async cfg => {
    try { return { cfg, n: normaliza(cfg, await getJson(base + cfg.api)) }; }
    catch (e) { console.error('ig-plan:', cfg.id, e.message); return { cfg, n: null, error: e.message }; }
  }));

  const candidatas = [], saltadas = [];
  for (const c of crudos) {
    if (!c.n) { saltadas.push({ liga: c.cfg.id, motivo: c.error ? 'error: ' + c.error : 'sin partido' }); continue; }
    c.clave = `${c.cfg.id}:${c.n.gameId}`;
    if (!vigente(c.n, now)) { saltadas.push({ liga: c.cfg.id, motivo: 'fuera de ventana (' + c.n.date + ')' }); continue; }
    if (yaPublicados.has(c.clave)) { saltadas.push({ liga: c.cfg.id, motivo: 'ya publicado' }); continue; }
    candidatas.push(c);
  }
  if (!candidatas.length) return { vacio: true, entradas: [], slides: [], saltadas, fecha: hoyMx(now) };

  /* Cupo de 10 láminas: portada + cierre + lo que quepa, en orden. */
  const entradas = [];
  let usadas = 2;
  for (const c of candidatas) {
    const necesita = c.cfg.id === 'nfl' ? 2 : 2; // los props son opcionales: se cuentan aparte
    if (usadas + necesita > MAX_SLIDES) continue;
    entradas.push(c); usadas += necesita;
  }
  for (const c of candidatas) if (!entradas.includes(c)) saltadas.push({ liga: c.cfg.id, motivo: 'sin cupo de láminas' });

  const uno = entradas.length === 1;
  /* La palabra para comentar es SIEMPRE "MODELO" (decisión del dueño,
     10-oct-2026): una sola regla de respuesta en ig_rules y una sola
     palabra que la gente se aprende. Desde el panel se puede cambiar. */
  const keyword = opts.keyword || KEYWORD;

  const strips = await Promise.all(entradas.map(c => armaStrip(c.cfg, c.n)));
  const porLiga = await Promise.all(entradas.map(c => laminasDe(c.cfg, c.n, base)));

  const cover = {
    kind: 'cover', title: ['FREE', uno ? 'PICK' : 'PICKS'],
    subtitle: uno ? `${entradas[0].cfg.nombre} · ${entradas[0].n.jornada}` : fechaLarga(now),
    strips,
  };
  const cta = { kind: 'cta', keyword };

  let cuerpo = porLiga.flat();
  /* Si con los props (opcionales) se pasa del cupo, se quitan props
     de atrás hacia adelante hasta caber. */
  while (cuerpo.length + 2 > MAX_SLIDES) {
    const i = cuerpo.map(s => s.optional).lastIndexOf(true);
    if (i < 0) break;
    cuerpo.splice(i, 1);
  }
  const slides = [cover, ...cuerpo, cta].slice(0, MAX_SLIDES);

  return {
    vacio: false, fecha: hoyMx(now), keyword,
    entradas: entradas.map(c => ({ liga: c.cfg.id, nombre: c.cfg.nombre, clave: c.clave, partido: `${c.n.away.name} @ ${c.n.home.name}`, fecha: c.n.date, pick: c.n.pick })),
    claves: entradas.map(c => c.clave),
    slides, saltadas,
    caption: caption(entradas, keyword),
  };
}

module.exports = { armaPlan, LIGAS, baseUrl, VENTANA_H, MAX_SLIDES, KEYWORD, hoyMx };
