/* ============================================================
   Publicar el carrusel en Instagram (Content Publishing API).

   Instagram no acepta la imagen en el cuerpo: pide una URL pública
   y la descarga él. Las láminas se suben primero a un bucket PÚBLICO
   de Supabase Storage (`ig-media`, se crea solo la primera vez) y
   de ahí se le pasan a Meta.

   Flujo de Meta para un carrusel:
     1. un contenedor por lámina  POST /{ig-id}/media  is_carousel_item
     2. el contenedor carrusel    POST /{ig-id}/media  media_type=CAROUSEL
     3. esperar status_code=FINISHED
     4. publicar                  POST /{ig-id}/media_publish

   Registro (KV sobre el mismo bucket de caché): qué partidos ya se
   publicaron (para no repetir), bitácora de corridas y config
   (pausa, palabra clave).
   ============================================================ */
const ig = require('../instagram');
const { kvGet, kvPut } = require('../odds/theoddsapi');

const BUCKET = 'ig-media';
const KV_POSTED = 'ig-daily-posted';
const KV_LOG = 'ig-daily-log';
const KV_CONFIG = 'ig-daily-config';
const KV_LOCK = 'ig-daily-lock';

/* ---- storage ---- */
let _sb = null;
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  if (!_sb) {
    const { createClient } = require('@supabase/supabase-js');
    _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return _sb;
}
let _bucketOk = false;
async function ensureBucket() {
  if (_bucketOk) return;
  const c = sb();
  const { data } = await c.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await c.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 8 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png'] });
    if (error && !/already exists/i.test(error.message)) throw error;
  } else if (!data.public) {
    await c.storage.updateBucket(BUCKET, { public: true });
  }
  _bucketOk = true;
}
function publicUrl(objPath) {
  return `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${objPath}`;
}

/* Sube las láminas (Buffers JPEG) a `carpeta/` y regresa sus URLs
   públicas. El sufijo ?v= evita que Meta o el navegador reutilicen
   una versión vieja del mismo nombre. */
async function subirLaminas(jpegs, carpeta) {
  await ensureBucket();
  const c = sb();
  const v = Date.now().toString(36);
  const urls = [];
  for (let i = 0; i < jpegs.length; i++) {
    const objPath = `${carpeta}/slide-${String(i + 1).padStart(2, '0')}.jpg`;
    const { error } = await c.storage.from(BUCKET).upload(objPath, jpegs[i], { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
    if (error) throw new Error('Storage: ' + error.message);
    urls.push(publicUrl(objPath) + '?v=' + v);
  }
  return urls;
}

/* ---- Instagram ---- */
const q = obj => Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function esperaContenedor(id, maxMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const st = await ig.igFetch(`/${id}?fields=status_code,status`);
    if (st.status_code === 'FINISHED') return st;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Contenedor ' + st.status_code + ': ' + (st.status || ''));
    if (Date.now() - t0 > maxMs) throw new Error('Meta no terminó de procesar el contenedor a tiempo.');
    await new Promise(r => setTimeout(r, 2500));
  }
}

/* Publica un carrusel (2-10 láminas) o una imagen sola (1 lámina).
   Devuelve { id, permalink }. */
async function publicar(urls, caption) {
  if (!urls || !urls.length) throw new Error('Sin láminas que publicar.');
  const me = await ig.meId();
  let creation;
  if (urls.length === 1) {
    const c = await ig.igFetch(`/${me}/media?${q({ image_url: urls[0], caption })}`, { method: 'POST' });
    creation = c.id;
  } else {
    const hijos = [];
    for (const u of urls) {
      const c = await ig.igFetch(`/${me}/media?${q({ image_url: u, is_carousel_item: 'true' })}`, { method: 'POST' });
      hijos.push(c.id);
    }
    await Promise.all(hijos.map(h => esperaContenedor(h)));
    const c = await ig.igFetch(`/${me}/media?${q({ media_type: 'CAROUSEL', children: hijos.join(','), caption })}`, { method: 'POST' });
    creation = c.id;
  }
  await esperaContenedor(creation);
  const pub = await ig.igFetch(`/${me}/media_publish?${q({ creation_id: creation })}`, { method: 'POST' });
  let permalink = null;
  try { permalink = (await ig.igFetch(`/${pub.id}?fields=permalink`)).permalink || null; } catch {}
  return { id: pub.id, permalink };
}

/* ---- registro en el KV ---- */
async function yaPublicados() {
  const m = (await kvGet(KV_POSTED)) || {};
  return new Set(Object.keys(m));
}
async function marcaPublicados(claves, fecha) {
  const m = (await kvGet(KV_POSTED)) || {};
  for (const k of claves) m[k] = fecha;
  /* se conservan 45 días: un partido no vive más que eso en cartelera */
  const limite = Date.now() - 45 * 86400 * 1000;
  for (const [k, v] of Object.entries(m)) if (new Date(v).getTime() < limite) delete m[k];
  await kvPut(KV_POSTED, m);
}
async function bitacora() { return (await kvGet(KV_LOG)) || []; }
async function anota(entry) {
  const log = await bitacora();
  log.unshift({ at: new Date().toISOString(), ...entry });
  await kvPut(KV_LOG, log.slice(0, 40));
}
async function config() { return Object.assign({ paused: false, keyword: '' }, (await kvGet(KV_CONFIG)) || {}); }
async function guardaConfig(patch) {
  const c = Object.assign(await config(), patch || {});
  await kvPut(KV_CONFIG, c);
  return c;
}

/* Candado de 10 min: Vercel puede reintentar un cron, y dos corridas
   a la vez publicarían el mismo carrusel dos veces. */
async function tomaCandado() {
  const l = await kvGet(KV_LOCK);
  if (l && l.at && Date.now() - new Date(l.at).getTime() < 10 * 60 * 1000) return false;
  await kvPut(KV_LOCK, { at: new Date().toISOString() });
  return true;
}
async function sueltaCandado() { await kvPut(KV_LOCK, { at: null }); }

module.exports = { subirLaminas, publicar, yaPublicados, marcaPublicados, bitacora, anota, config, guardaConfig, tomaCandado, sueltaCandado, BUCKET };
