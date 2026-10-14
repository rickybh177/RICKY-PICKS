/* ============================================================
   /api/ig-daily — el POST DIARIO de free picks en Instagram.

   Lo dispara el cron de Vercel (vercel.json) una vez al día y
   publica UN carrusel POR LIGA con el pick gratis de cada liga que
   juega mañana, en el formato del post manual del dueño
   (portada FREE PICK → pick principal → picks alternativos →
   props NFL → "comenta PICKS"). Lo que no hace el dueño a mano
   un día, lo hace esto; lo que sí hace, no estorba: un partido ya
   publicado no se repite.

   Quién puede llamarlo:
   - El cron de Vercel: manda `Authorization: Bearer $CRON_SECRET`.
   - El admin desde /admin-instagram.html (sesión de Supabase).
   - Dev local: libre.

   GET  (sin action)          → corre el post del día (cron)
   GET  ?action=status        → config, token, bitácora
   GET  ?action=preview       → arma y renderiza los carruseles de
                                hoy (uno por liga) SIN publicar
                                (sube las láminas a preview/)
   POST {action:'publish'}    → publica ahora (respeta "ya publicado"
                                salvo force:true)
   POST {action:'publish-game', liga, equipo|game}
                              → publica UN partido concreto (el que
                                sea, aunque no sea el pick gratis),
                                sin tocar la plataforma; GET
                                ?action=preview-game&liga=&equipo=
                                lo arma sin publicar
   GET  ?action=queue           → la cola de programados
   POST {action:'schedule-game', liga, equipo|game, at}
                                → programa un partido para esa hora
                                  (api/ig-queue.js lo publica)
   POST {action:'unschedule', id}
   POST {action:'config', paused, keyword}
   POST {action:'refresh-token'}
   ============================================================ */
const { armaPlan, armaPostDe } = require('../lib/ig/plan');
const { renderSlide } = require('../lib/ig/render');
const pub = require('../lib/ig/publish');
const ig = require('../lib/instagram');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const REFRESH_DAYS = 7;
const { hoyMx } = require('../lib/ig/plan');
const hoy = () => hoyMx(Date.now());

async function quien(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return 'cron';
  if (token) {
    const user = await getUserFromToken(token).catch(() => null);
    if (user && ADMIN_EMAILS.includes(user.email)) return 'admin';
  }
  if (IS_DEV) return 'dev';
  return null;
}

/* Renderiza las láminas de un post (en serie: satori + sharp usan
   CPU; en paralelo no gana nada en una lambda). */
async function renderiza(post) {
  const jpegs = [];
  for (const s of post.slides) jpegs.push(await renderSlide(s));
  return jpegs;
}

/* Refresca el token si no se sabe su edad o ya pasó una semana.
   Nunca es fatal: si falla, el post sale con el token actual y se
   deja constancia. */
async function refrescaSiToca() {
  try {
    const st = await ig.tokenState();
    const edad = st.refreshed_at ? (Date.now() - new Date(st.refreshed_at).getTime()) / 86400000 : Infinity;
    if (edad < REFRESH_DAYS) return { refreshed: false };
    const nuevo = await ig.refreshToken();
    return { refreshed: true, expires_at: nuevo.expires_at };
  } catch (e) {
    return { refreshed: false, error: e.message };
  }
}

/* La corrida completa: UN carrusel por liga, uno tras otro. Si uno
   falla, los demás salen igual; cada uno queda en la bitácora. */
async function corre({ modo, force = false }) {
  const cfg = await pub.config();
  if (cfg.paused && modo === 'cron') {
    await pub.anota({ ok: true, skipped: 'pausado', modo });
    return { ok: true, skipped: 'pausado' };
  }
  if (!(await pub.tomaCandado())) return { ok: false, error: 'Ya hay una corrida en curso.' };
  try {
    const token = await refrescaSiToca();
    const ya = force ? new Set() : await pub.yaPublicados();
    const plan = await armaPlan({ yaPublicados: ya, keyword: cfg.keyword || undefined });
    if (plan.vacio) {
      await pub.anota({ ok: true, skipped: 'nada que publicar', modo, saltadas: plan.saltadas });
      return { ok: true, skipped: 'nada que publicar', saltadas: plan.saltadas };
    }
    const resultados = [];
    for (const post of plan.posts) {
      try {
        const jpegs = await renderiza(post);
        const urls = await pub.subirLaminas(jpegs, `daily/${plan.fecha}/${post.liga}`);
        const res = await pub.publicar(urls, post.caption);
        await pub.marcaPublicados([post.clave], plan.fecha);
        await pub.anota({ ok: true, modo, media_id: res.id, permalink: res.permalink, fecha: plan.fecha,
          entradas: [`${post.nombre}: ${post.partido}`], slides: urls.length, token });
        resultados.push({ ok: true, liga: post.liga, partido: post.partido, media_id: res.id, permalink: res.permalink, slides: urls.length });
      } catch (e) {
        console.error('ig-daily:', post.liga, e);
        await pub.anota({ ok: false, modo, entradas: [`${post.nombre}: ${post.partido}`], error: e.message });
        resultados.push({ ok: false, liga: post.liga, partido: post.partido, error: e.message });
      }
    }
    const ok = resultados.every(r => r.ok);
    return { ok, posts: resultados, saltadas: plan.saltadas, error: ok ? undefined : 'Falló al menos un post.' };
  } catch (e) {
    console.error('ig-daily:', e);
    await pub.anota({ ok: false, modo, error: e.message });
    return { ok: false, error: e.message };
  } finally {
    await pub.sueltaCandado();
  }
}

/* Publica UN partido concreto (lo usan el botón del panel y la cola).
   `headers`: Authorization del admin o x-internal-auth del cron. */
async function publicaPartido(sel, headers, modo) {
  const cfg = await pub.config();
  const post = await armaPostDe({ ...sel, headers, keyword: cfg.keyword || undefined });
  const jpegs = await renderiza(post);
  const urls = await pub.subirLaminas(jpegs, `daily/${hoy()}/${post.liga}-${post.clave.split(':')[1]}`);
  const out = await pub.publicar(urls, post.caption);
  await pub.marcaPublicados([post.clave], hoy());
  await pub.anota({ ok: true, modo, media_id: out.id, permalink: out.permalink, fecha: hoy(),
    entradas: [`${post.nombre}: ${post.partido}`], slides: urls.length });
  return { ok: true, liga: post.liga, partido: post.partido, media_id: out.id, permalink: out.permalink };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const rol = await quien(req);
  if (!rol) return res.status(403).json({ error: 'Acceso no autorizado.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = (req.query && req.query.action) || body.action || null;

  try {
    if (req.method === 'GET' && !action) {
      /* el cron */
      const out = await corre({ modo: rol === 'cron' ? 'cron' : 'manual' });
      return res.status(out.ok ? 200 : 500).json(out);
    }

    if (rol === 'cron') return res.status(403).json({ error: 'El cron solo corre el post del día.' });

    if (action === 'status') {
      const [cfg, log] = await Promise.all([pub.config(), pub.bitacora()]);
      let token = { ok: false };
      try {
        const st = await ig.tokenState();
        token = { ok: true, refreshed_at: st.refreshed_at, expires_at: st.expires_at, source: st.refreshed_at ? 'kv' : 'env' };
      } catch (e) { token = { ok: false, error: e.message }; }
      return res.status(200).json({ config: cfg, token, log, cron: process.env.CRON_SECRET ? 'configurado' : 'SIN CRON_SECRET', dev: IS_DEV });
    }

    if (action === 'preview') {
      const cfg = await pub.config();
      const ya = req.query && req.query.all ? new Set() : await pub.yaPublicados();
      const plan = await armaPlan({ yaPublicados: ya, keyword: cfg.keyword || undefined });
      if (plan.vacio) return res.status(200).json({ vacio: true, saltadas: plan.saltadas, fecha: plan.fecha });
      const posts = [];
      for (const post of plan.posts) {
        const jpegs = await renderiza(post);
        const urls = await pub.subirLaminas(jpegs, `preview/${plan.fecha}/${post.liga}`);
        posts.push({ liga: post.liga, nombre: post.nombre, partido: post.partido, fecha: post.fecha, pick: post.pick,
                     caption: post.caption, slides: post.slides.map(s => s.kind), urls });
      }
      return res.status(200).json({ vacio: false, fecha: plan.fecha, keyword: plan.keyword, posts, saltadas: plan.saltadas });
    }

    /* Un partido concreto, sin tocar el pick gratis del sitio. */
    if (action === 'publish-game' || action === 'preview-game') {
      const sel = { liga: body.liga || (req.query && req.query.liga), gameId: body.game || (req.query && req.query.game),
                    equipo: body.equipo || (req.query && req.query.equipo) };
      if (action === 'preview-game' || req.method !== 'POST') {
        const cfg = await pub.config();
        const post = await armaPostDe({ ...sel, auth: req.headers.authorization, keyword: cfg.keyword || undefined });
        const jpegs = await renderiza(post);
        const urls = await pub.subirLaminas(jpegs, `preview/${hoy()}/${post.liga}-${post.clave.split(':')[1]}`);
        return res.status(200).json({ ok: true, liga: post.liga, partido: post.partido, fecha: post.fecha, caption: post.caption, urls });
      }
      const out = await publicaPartido(sel, { Authorization: req.headers.authorization }, 'manual (partido elegido)');
      return res.status(200).json(out);
    }

    /* Cola: programar un partido para una hora concreta. */
    if (action === 'queue') {
      return res.status(200).json({ queue: await pub.cola() });
    }
    if (action === 'schedule-game' && req.method === 'POST') {
      const at = new Date(body.at || '');
      if (isNaN(at.getTime())) return res.status(400).json({ error: 'Hora no válida.' });
      if (!body.liga) return res.status(400).json({ error: 'Falta la liga.' });
      const item = await pub.encola({ liga: body.liga, equipo: body.equipo || null, game: body.game || null, at: at.toISOString() });
      return res.status(200).json({ ok: true, item });
    }
    if (action === 'unschedule' && req.method === 'POST') {
      await pub.quitaDeCola(body.id);
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    if (action === 'publish') {
      const out = await corre({ modo: 'manual', force: !!body.force });
      return res.status(out.ok ? 200 : 500).json(out);
    }
    if (action === 'config') {
      const patch = {};
      if (typeof body.paused === 'boolean') patch.paused = body.paused;
      if (typeof body.keyword === 'string') patch.keyword = body.keyword.trim().toUpperCase().slice(0, 20);
      return res.status(200).json({ config: await pub.guardaConfig(patch) });
    }
    if (action === 'refresh-token') {
      const st = await ig.refreshToken();
      return res.status(200).json({ ok: true, refreshed_at: st.refreshed_at, expires_at: st.expires_at });
    }
    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (e) {
    console.error('ig-daily handler:', e);
    return res.status(500).json({ error: e.message || 'Error interno.' });
  }
};

module.exports.publicaPartido = publicaPartido;
