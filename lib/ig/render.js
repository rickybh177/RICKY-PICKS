/* ============================================================
   Render de las láminas del post diario de Instagram (1080x1350).

   Reproduce el formato del post manual del dueño (27-sep-2026,
   Eagles @ Bears): portada "FREE PICK" con los escudos sobre los
   colores de cada equipo, "PICK PRINCIPAL" (la misma card oscura
   del landing), "PICKS ALTERNATIVOS" (lista clara de mercados),
   "PROPS JUGADOR" (solo NFL) y el cierre "COMENTA <palabra>".

   Cómo se dibuja: satori convierte un árbol tipo React (solo
   flexbox) a SVG con el texto YA convertido a trazos, y sharp
   rasteriza ese SVG a JPEG. Así no dependemos de que la lambda de
   Vercel tenga fuentes instaladas: las .ttf viven en lib/ig/fonts
   y viajan con el deploy. Instagram solo acepta JPEG por URL.

   Nada de aquí sabe de ligas ni de la API: recibe un "spec" de
   lámina ya armado (lib/ig/plan.js) y devuelve un Buffer JPEG.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const satoriMod = require('satori');
const satori = satoriMod.default || satoriMod;
const sharp = require('sharp');

const W = 1080, H = 1350;

/* ---- paleta: la del post de referencia (blanco + azul) y la card
   oscura "terminal" del sitio ---- */
const C = {
  white: '#ffffff', navy: '#0b1736', blue: '#2f6bff', ink: '#0b1020',
  muted: '#6b7686', line: '#e3e8f0', paper: '#f5f7fb',
  card: '#0b0f1a', cardLine: '#1e2634', txt: '#e9edf4', dim: '#8b96a8', bar: '#2b3547',
  green: '#2fd57b', greenInk: '#06301a', red: '#f2695c', amber: '#d6a03c',
  pickBg: '#0f2a1f', pickLine: '#1f5a3c', maybeBg: '#1a2238', maybeLine: '#2f4a7a', skipBg: '#2a1518', skipLine: '#6a2a2e',
};

/* ---- fuentes (estáticas: satori no interpola fuentes variables) ---- */
let _fonts = null;
function fonts() {
  if (_fonts) return _fonts;
  const dir = path.join(__dirname, 'fonts');
  const f = (file, name, weight) => ({ name, weight, style: 'normal', data: fs.readFileSync(path.join(dir, file)) });
  _fonts = [
    f('Anton-Regular.ttf', 'Anton', 400),
    f('InterTight-500.ttf', 'Inter Tight', 500),
    f('InterTight-600.ttf', 'Inter Tight', 600),
    f('InterTight-700.ttf', 'Inter Tight', 700),
    f('InterTight-800.ttf', 'Inter Tight', 800),
    f('JetBrainsMono-500.ttf', 'JetBrains Mono', 500),
    f('JetBrainsMono-700.ttf', 'JetBrains Mono', 700),
  ];
  return _fonts;
}
const SANS = 'Inter Tight', MONO = 'JetBrains Mono', DISPLAY = 'Anton';

/* ---- árbol de elementos: satori exige display:flex en todo
   contenedor con más de un hijo; aquí se pone solo ---- */
function el(type, style, ...children) {
  const kids = children.flat().filter(k => k != null && k !== false);
  const props = { style: Object.assign(type === 'div' ? { display: 'flex' } : {}, style || {}) };
  if (kids.length) props.children = kids.length === 1 ? kids[0] : kids;
  return { type, props };
}
const div = (style, ...kids) => el('div', style, ...kids);
const txt = (s, style) => el('div', Object.assign({ display: 'flex' }, style), String(s));
const img = (src, size, style) => ({ type: 'img', props: { src, width: size, height: size, style: Object.assign({ width: size, height: size, objectFit: 'contain' }, style || {}) } });

/* ---- imágenes remotas (escudos) → data URI, con caché por URL.
   Si un escudo falla, la lámina sale sin él en vez de no salir. ---- */
const _imgCache = new Map();
async function fetchImage(url) {
  if (!url) return null;
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = (async () => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      /* Normalizamos a PNG (algunos escudos vienen SVG/WebP) y lo
         acotamos a 500 px para no inflar el SVG intermedio. */
      const png = await sharp(buf).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      return { dataUri: 'data:image/png;base64,' + png.toString('base64'), png };
    } catch (e) {
      console.error('ig-render: escudo no disponible', url, e.message);
      return null;
    }
  })();
  _imgCache.set(url, p);
  return p;
}

/* ---- color dominante de un escudo, para el panel de la portada.
   Se buscan los píxeles saturados (ni blanco ni gris ni casi
   transparente) y gana el tono más repetido; se oscurece después
   para que el escudo encima resalte. ---- */
async function dominantColor(png) {
  try {
    const { data, info } = await sharp(png).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bins = new Map();
    let fallback = null, fbCount = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 510, s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)) / 255;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const ok = s >= 0.3 && l >= 0.1 && l <= 0.72;
      const bucket = bins.get(key) || { n: 0, r: 0, g: 0, b: 0, ok };
      bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b; bucket.ok = bucket.ok || ok;
      bins.set(key, bucket);
      if (l < 0.85 && bucket.n > fbCount) { fbCount = bucket.n; fallback = bucket; }
    }
    let best = null;
    for (const v of bins.values()) if (v.ok && (!best || v.n > best.n)) best = v;
    const pick = best || fallback;
    if (!pick) return [20, 32, 60];
    return [pick.r / pick.n, pick.g / pick.n, pick.b / pick.n].map(Math.round);
  } catch { return [20, 32, 60]; }
}
const rgb = (c, k = 1) => `rgb(${c.map(v => Math.round(Math.min(255, v * k))).join(',')})`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ---- piezas ---- */
function brand(size = 1) {
  /* El logotipo: caja "D·T" + DAT en tinta y TIP en azul. */
  const box = Math.round(70 * size), fs = Math.round(44 * size);
  return div({ alignItems: 'center', gap: Math.round(22 * size) },
    div({ width: box, height: box, borderRadius: Math.round(18 * size), border: `${Math.max(3, Math.round(4 * size))}px solid ${C.blue}`, alignItems: 'center', justifyContent: 'center' },
      txt('D·T', { fontFamily: SANS, fontWeight: 700, fontSize: Math.round(26 * size), color: C.navy, letterSpacing: 1 })),
    div({ alignItems: 'center' },
      txt('DAT', { fontFamily: SANS, fontWeight: 700, fontSize: fs, color: C.navy, letterSpacing: -1 }),
      txt('TIP', { fontFamily: SANS, fontWeight: 700, fontSize: fs, color: C.blue, letterSpacing: -1 })));
}

/* Título de dos palabras estilo "PICK PRINCIPAL": la primera en
   tinta y la segunda en azul, con la fuente condensada. */
function display2(a, b, size, colors = [C.navy, C.blue]) {
  /* Anton mide ~0.42 em por letra mayúscula; si el título no cabe en
     960 px, el tamaño baja hasta que quepa (PICKS ALTERNATIVOS). */
  const chars = String(a).length + String(b).length + 0.6;
  size = Math.min(size, Math.floor(960 / (chars * 0.42)));
  return div({ alignItems: 'flex-end', gap: Math.round(size * 0.14), justifyContent: 'center' },
    txt(a, { fontFamily: DISPLAY, fontSize: size, color: colors[0], lineHeight: 1 }),
    txt(b, { fontFamily: DISPLAY, fontSize: size, color: colors[1], lineHeight: 1 }));
}

const chipStyle = {
  bet:   { bg: '#e6f7ed', fg: '#1a8f4e', line: '#bfe8cf', txt: 'PICK' },
  maybe: { bg: '#e9f0ff', fg: '#2f6bff', line: '#c5d6ff', txt: 'MAYBE' },
  skip:  { bg: '#fdecec', fg: '#d93a3a', line: '#f5c6c6', txt: 'SKIP' },
};
function chip(verdict, size = 1) {
  const s = chipStyle[verdict] || chipStyle.skip;
  return div({ background: s.bg, border: `2px solid ${s.line}`, borderRadius: Math.round(12 * size), padding: `${Math.round(12 * size)}px ${Math.round(22 * size)}px`, alignItems: 'center', justifyContent: 'center' },
    txt(s.txt, { fontFamily: MONO, fontWeight: 700, fontSize: Math.round(24 * size), color: s.fg, letterSpacing: 2 }));
}

function page(bg, ...kids) {
  return div({ width: W, height: H, background: bg, flexDirection: 'column', alignItems: 'center', position: 'relative' }, ...kids);
}

/* Escudo oscuro sobre fondo oscuro (White Sox, Raiders): un disco
   claro detrás para que no se funda. */
const halo = size => ({ background: 'rgba(255,255,255,0.92)', borderRadius: size, padding: Math.round(size * 0.1) });

/* ---- franja de equipos: dos mitades con los colores de cada
   equipo, escudos encima y la insignia de la liga al centro ---- */
function teamStrip(s, height) {
  const logoSize = Math.round(Math.min(250, height * 0.52));
  const badge = Math.round(Math.min(170, height * 0.36));
  return div({ width: W, height, position: 'relative' },
    div({ width: W / 2, height, background: s.awayColor, alignItems: 'center', justifyContent: 'center' },
      s.awayLogo && img(s.awayLogo, logoSize, s.awayDark ? halo(logoSize) : null)),
    div({ width: W / 2, height, background: s.homeColor, alignItems: 'center', justifyContent: 'center' },
      s.homeLogo && img(s.homeLogo, logoSize, s.homeDark ? halo(logoSize) : null)),
    div({ position: 'absolute', left: (W - badge) / 2, top: (height - badge) / 2, width: badge, height: badge, borderRadius: Math.round(badge * 0.2), background: '#0f2b58', alignItems: 'center', justifyContent: 'center' },
      s.leagueLogo ? img(s.leagueLogo, Math.round(badge * 0.62)) : txt(s.leagueAbbr || '', { fontFamily: MONO, fontWeight: 700, fontSize: Math.round(badge * 0.26), color: '#fff' })));
}

/* ==================== LÁMINAS ==================== */

/* 1. Portada. Con UN partido es la réplica del post de referencia;
   con varios, las franjas se apilan (una por liga). */
function coverSlide(sp) {
  const strips = sp.strips || [];
  const panelH = strips.length <= 1 ? 560 : 640, stripH = Math.floor(panelH / Math.max(1, strips.length));
  return page(C.white,
    div({ marginTop: 62 }, brand(1)),
    div({ marginTop: 44 }, display2(sp.title[0], sp.title[1], 230)),
    txt(sp.subtitle, { fontFamily: SANS, fontWeight: 700, fontSize: 56, color: C.blue, marginTop: 18, letterSpacing: 1, textTransform: 'uppercase', maxWidth: 980, whiteSpace: 'nowrap' }),
    div({ marginTop: 44, flexDirection: 'column', width: W },
      strips.map(s => teamStrip(s, stripH))),
  );
}

/* 2. Pick principal: la card oscura del landing, tal cual. */
function principalSlide(sp) {
  const g = sp.game;
  const row = (t, strong) => div({ alignItems: 'center', height: 118 },
    t.logo ? img(t.logo, 86) : div({ width: 86, height: 86 }),
    div({ flexDirection: 'column', marginLeft: 30, flexGrow: 1 },
      txt(t.name, { fontFamily: SANS, fontWeight: 700, fontSize: 46, color: C.txt, letterSpacing: -0.5 }),
      t.sub ? txt(t.sub, { fontFamily: SANS, fontWeight: 500, fontSize: 30, color: C.dim, marginTop: 2 }) : null),
    txt(t.prob, { fontFamily: MONO, fontWeight: 700, fontSize: 52, color: strong ? C.blue : C.dim }));
  const pickS = g.pick.verdict === 'bet' ? { bg: C.pickBg, line: C.pickLine, chip: C.green, chipInk: C.greenInk, pct: C.green }
    : g.pick.verdict === 'maybe' ? { bg: C.maybeBg, line: C.maybeLine, chip: C.blue, chipInk: '#fff', pct: C.blue }
    : { bg: C.skipBg, line: C.skipLine, chip: C.red, chipInk: '#fff', pct: C.red };
  return page(C.white,
    sp.eyebrow ? txt(sp.eyebrow, { fontFamily: MONO, fontWeight: 500, fontSize: 28, color: C.blue, marginTop: 58, letterSpacing: 4 }) : null,
    div({ marginTop: sp.eyebrow ? 10 : 90 }, display2(sp.title[0], sp.title[1], 150)),
    div({ marginTop: 40, width: 920, background: C.card, borderRadius: 36, border: `2px solid ${C.cardLine}`, padding: '46px 48px 40px', flexDirection: 'column' },
      txt(g.meta, { fontFamily: MONO, fontWeight: 500, fontSize: 26, color: C.dim, letterSpacing: 3, marginBottom: 26 }),
      row(g.away, g.favAway), row(g.home, !g.favAway),
      div({ marginTop: 26, height: 14, borderRadius: 7, background: C.bar, overflow: 'hidden' },
        div({ width: `${g.barA}%`, height: 14, background: '#5a6478' }),
        div({ width: `${100 - g.barA}%`, height: 14, background: C.blue })),
      div({ marginTop: 34, background: pickS.bg, border: `2px solid ${pickS.line}`, borderRadius: 20, padding: '24px 28px', alignItems: 'center' },
        div({ background: pickS.chip, borderRadius: 10, padding: '12px 22px', alignItems: 'center' },
          txt(g.pick.chip, { fontFamily: MONO, fontWeight: 700, fontSize: 24, color: pickS.chipInk, letterSpacing: 2 })),
        txt(g.pick.label, { fontFamily: SANS, fontWeight: 700, fontSize: 40, color: C.txt, marginLeft: 26, flexGrow: 1, maxWidth: 560, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
        txt(g.pick.prob, { fontFamily: MONO, fontWeight: 500, fontSize: 32, color: pickS.pct, marginLeft: 16 })),
      div({ marginTop: 40, justifyContent: 'space-between' },
        txt('10,000 SIMULACIONES', { fontFamily: MONO, fontWeight: 500, fontSize: 23, color: C.dim, letterSpacing: 3 }),
        txt((g.venue || '').toUpperCase(), { fontFamily: MONO, fontWeight: 500, fontSize: 23, color: C.dim, letterSpacing: 3, maxWidth: 460, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }))),
    div({ position: 'absolute', bottom: 70, left: 0, width: W, justifyContent: 'center' }, brand(1)),
  );
}

/* 3. Picks alternativos: todos los mercados con su veredicto. */
function marketsSlide(sp) {
  const rows = sp.rows.slice(0, 5);
  const dense = rows.length > 4;
  return page(C.white,
    sp.eyebrow ? txt(sp.eyebrow, { fontFamily: MONO, fontWeight: 500, fontSize: 28, color: C.blue, marginTop: 58, letterSpacing: 4 }) : null,
    div({ marginTop: sp.eyebrow ? 10 : 90 }, display2(sp.title[0], sp.title[1], 150)),
    div({ marginTop: 40, width: 920, background: C.paper, borderRadius: 28, padding: 24, flexDirection: 'column', gap: dense ? 14 : 20 },
      rows.map(r => div({ background: C.white, border: `2px solid ${C.line}`, borderRadius: 22, padding: dense ? '22px 28px' : '30px 30px', alignItems: 'center' },
        div({ flexDirection: 'column', flexGrow: 1, maxWidth: 680 },
          txt(r.title, { fontFamily: SANS, fontWeight: 600, fontSize: dense ? 34 : 38, color: r.verdict === 'skip' ? C.muted : C.ink, letterSpacing: -0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 680 }),
          r.meta ? txt(r.meta, { fontFamily: MONO, fontWeight: 500, fontSize: dense ? 22 : 24, color: C.muted, marginTop: 8, lineHeight: 1.4, maxWidth: 680 }) : null),
        div({ marginLeft: 20 }, chip(r.verdict, 1))))),
    div({ position: 'absolute', bottom: 70, left: 0, width: W, justifyContent: 'center' }, brand(1)),
  );
}

/* 4. Props de jugador (NFL): hasta dos jugadores, cuatro renglones. */
function propsSlide(sp) {
  const card = p => div({ background: C.white, border: `2px solid ${C.line}`, borderRadius: 22, padding: '22px 28px', flexDirection: 'column', width: 872 },
    div({ alignItems: 'baseline', gap: 16, paddingBottom: 14, borderBottom: `2px solid ${C.line}` },
      txt(p.name, { fontFamily: SANS, fontWeight: 700, fontSize: 32, color: C.ink }),
      txt(p.sub, { fontFamily: MONO, fontWeight: 500, fontSize: 20, color: C.muted, letterSpacing: 2 })),
    p.rows.slice(0, 4).map((r, i) => div({ alignItems: 'center', padding: '14px 0', borderBottom: i < Math.min(4, p.rows.length) - 1 ? `1px solid ${C.line}` : 'none' },
      div({ flexDirection: 'column', flexGrow: 1 },
        txt(r.title, { fontFamily: SANS, fontWeight: 600, fontSize: 28, color: r.verdict === 'skip' ? C.muted : C.ink }),
        txt(r.meta, { fontFamily: MONO, fontWeight: 500, fontSize: 20, color: C.muted, marginTop: 4 })),
      chip(r.verdict, 0.8))));
  return page(C.white,
    sp.eyebrow ? txt(sp.eyebrow, { fontFamily: MONO, fontWeight: 500, fontSize: 28, color: C.blue, marginTop: 58, letterSpacing: 4 }) : null,
    div({ marginTop: sp.eyebrow ? 10 : 90 }, display2(sp.title[0], sp.title[1], 150)),
    div({ marginTop: 36, width: 920, background: C.paper, borderRadius: 28, padding: 24, flexDirection: 'column', gap: 18 },
      sp.players.slice(0, 2).map(card)),
    div({ position: 'absolute', bottom: 60, left: 0, width: W, justifyContent: 'center' }, brand(0.9)),
  );
}

/* 5. Cierre: "COMENTA <palabra> para analizar todos los partidos". */
function ctaSlide(sp) {
  return page(C.white,
    div({ marginTop: 120, flexDirection: 'column', alignItems: 'center' },
      txt('COMENTA', { fontFamily: DISPLAY, fontSize: 190, color: '#000', lineHeight: 1, letterSpacing: 2 }),
      txt(sp.keyword, { fontFamily: DISPLAY, fontSize: 190, color: C.blue, lineHeight: 1, letterSpacing: 2, marginTop: 10 })),
    txt(sp.line1 || 'PARA ANALIZAR TODOS LOS PARTIDOS', { fontFamily: SANS, fontWeight: 800, fontSize: 50, color: '#000', marginTop: 60, textAlign: 'center', maxWidth: 760, lineHeight: 1.25, letterSpacing: 1 }),
    div({ marginTop: 80, flexDirection: 'column', alignItems: 'center' },
      div({ alignItems: 'flex-end', gap: 18 },
        txt('Si vas a jugar,', { fontFamily: SANS, fontWeight: 600, fontSize: 84, color: C.navy, letterSpacing: -2 }),
        txt('juega', { fontFamily: SANS, fontWeight: 600, fontSize: 84, color: C.blue, letterSpacing: -2 })),
      txt('con cabeza.', { fontFamily: SANS, fontWeight: 600, fontSize: 84, color: C.blue, letterSpacing: -2 })),
    div({ position: 'absolute', bottom: 110, left: 0, width: W, justifyContent: 'center' }, brand(1.15)),
  );
}

const SLIDES = { cover: coverSlide, principal: principalSlide, markets: marketsSlide, props: propsSlide, cta: ctaSlide };

/* ---- render: spec → JPEG ---- */
async function renderSlide(spec) {
  const build = SLIDES[spec.kind];
  if (!build) throw new Error('Lámina desconocida: ' + spec.kind);
  const svg = await satori(build(spec), { width: W, height: H, fonts: fonts() });
  return sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
}

module.exports = { renderSlide, fetchImage, dominantColor, rgb, dist, W, H };
