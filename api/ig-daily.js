/* ============================================================
   /api/ig-daily — el POST DIARIO de free picks en Instagram.

   Lo dispara el cron de Vercel (vercel.json) una vez al día y
   publica un carrusel con el pick gratis de cada liga que juega
   hoy o mañana, en el formato del post manual del dueño
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
   GET  ?action=preview       → arma y renderiza el carrusel de hoy
                                SIN publicar (sube las láminas a
                                preview/ y regresa las URLs)
   POST {action:'publish'}    → publica ahora (respeta "ya publicado"
                                salvo force:true)
   POST {action:'config', paused, keyword}
   POST {action:'refresh-token'}
   ============================================================ */
const { armaPlan } = require('../lib/ig/plan');
const { renderSlide } = require('../lib/ig/render');
const pub = require('../lib/ig/publish');
const ig = require('../lib/instagram');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const REFRESH_DAYS = 7;

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

/* Renderiza todas las láminas del plan (en serie: satori + sharp
   usan CPU; en paralelo no gana nada en una lambda). */
async function renderiza(plan) {
  const jpegs = [];
  for (const s of plan.slides) jpegs.push(await renderSlide(s));
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

/* La corrida completa. `modo`: 'cron' | 'manual'. */
async function corre({ modo, force = false, dry = false }) {
  const cfg = await pub.config();
  if (cfg.paused && modo === 'cron') {
    await pub.anota({ ok: true, skipped: 'pausado', modo });
    return { ok: true, skipped: 'pausado' };
  }
  if (!(await pub.tomaCandado())) return { ok: false, error: 'Ya hay una corrida en curso.' };
  try {
    const token = dry ? null : await refrescaSiToca();
    const ya = force ? new Set() : await pub.yaPublicados();
    const plan = await armaPlan({ yaPublicados: ya, keyword: cfg.keyword || undefined });
    if (plan.vacio) {
      await pub.anota({ ok: true, skipped: 'nada que publicar', modo, saltadas: plan.saltadas });
      return { ok: true, skipped: 'nada que publicar', saltadas: plan.saltadas };
    }
    const jpegs = await renderiza(plan);
    const urls = await pub.subirLaminas(jpegs, `${dry ? 'preview' : 'daily'}/${plan.fecha}`);
    if (dry) return { ok: true, dry: true, plan: sinLaminas(plan), urls };
    const res = await pub.publicar(urls, plan.caption);
    await pub.marcaPublicados(plan.claves, plan.fecha);
    await pub.anota({ ok: true, modo, media_id: res.id, permalink: res.permalink, fecha: plan.fecha,
      entradas: plan.entradas.map(e => `${e.nombre}: ${e.partido}`), slides: urls.length, token });
    return { ok: true, media_id: res.id, permalink: res.permalink, entradas: plan.entradas, slides: urls.length };
  } catch (e) {
    console.error('ig-daily:', e);
    await pub.anota({ ok: false, modo, error: e.message });
    return { ok: false, error: e.message };
  } finally {
    await pub.sueltaCandado();
  }
}

/* El plan sin los data-URI de los escudos (pesan y no sirven en JSON). */
function sinLaminas(plan) {
  return { fecha: plan.fecha, keyword: plan.keyword, entradas: plan.entradas, saltadas: plan.saltadas, caption: plan.caption,
           slides: plan.slides.map(s => s.kind) };
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
      const out = await corre({ modo: rol === 'cron' ? 'cron' : 'manual', dry: !!(req.query && req.query.dry) });
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
      const jpegs = await renderiza(plan);
      const urls = await pub.subirLaminas(jpegs, `preview/${plan.fecha}`);
      return res.status(200).json({ vacio: false, ...sinLaminas(plan), urls });
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
