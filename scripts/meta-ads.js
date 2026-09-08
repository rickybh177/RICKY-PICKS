#!/usr/bin/env node
/* ============================================================
   Meta Ads — administración de campañas, públicos y creativos
   por la Marketing API.

   Uso:
     node scripts/meta-ads.js <comando> [opciones]

   Nada que gaste dinero o cambie la cuenta se ejecuta sin la
   bandera --aplicar: por defecto todo comando de escritura solo
   imprime lo que haría (simulacro). Además, toda campaña y todo
   anuncio nacen en PAUSED — activarlos es un acto aparte.

   Variables de entorno (.env):
     META_ADS_TOKEN     token de usuario con ads_management
     META_AD_ACCOUNT    id de la cuenta publicitaria (act_XXXXXXX)
     META_PAGE_ID       id de la página de Facebook del anuncio
     META_IG_ID         (opcional) id de la cuenta de Instagram
     META_PIXEL_ID      id del Pixel (default: el del sitio)
     META_API_VERSION   (opcional) default v23.0
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

/* --- .env: mismo cargador minúsculo que usan los otros scripts --- */
(function cargarEnv() {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const API = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v23.0'}`;
const TOKEN = process.env.META_ADS_TOKEN;
const CUENTA = process.env.META_AD_ACCOUNT;
const PIXEL = process.env.META_PIXEL_ID || '1031713479672830';
const PAGE = process.env.META_PAGE_ID;
const IG = process.env.META_IG_ID;

/* Bandera global: sin --aplicar, ningún POST sale a la red. */
const APLICAR = process.argv.includes('--aplicar');

/* ============================================================
   Utilidades
   ============================================================ */

function opcion(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i === -1) return porDefecto;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}

function morir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

function exigeToken() {
  if (!TOKEN) morir('Falta META_ADS_TOKEN en .env. Corre: node scripts/meta-ads.js ayuda');
}

function exigeCuenta() {
  exigeToken();
  if (!CUENTA) morir('Falta META_AD_ACCOUNT en .env (formato act_1234567890).');
  if (!/^act_\d+$/.test(CUENTA)) morir(`META_AD_ACCOUNT debe verse como act_1234567890, no "${CUENTA}".`);
}

async function get(ruta, params = {}) {
  const url = new URL(`${API}/${ruta}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  url.searchParams.set('access_token', TOKEN);
  const r = await fetch(url);
  const cuerpo = await r.json();
  if (cuerpo.error) throw new Error(explicaError(cuerpo.error));
  return cuerpo;
}

/* Todo POST pasa por aquí, y aquí es donde muerde el simulacro. */
async function post(ruta, campos, { etiqueta }) {
  if (!APLICAR) {
    console.log(`\n  [simulacro] POST /${ruta}`);
    for (const [k, v] of Object.entries(campos)) {
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      console.log(`      ${k}: ${s.length > 300 ? s.slice(0, 300) + '…' : s}`);
    }
    return { id: `<simulacro:${etiqueta}>`, __simulacro: true };
  }
  const cuerpo = new URLSearchParams();
  for (const [k, v] of Object.entries(campos)) {
    cuerpo.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  cuerpo.set('access_token', TOKEN);
  const r = await fetch(`${API}/${ruta}`, { method: 'POST', body: cuerpo });
  const json = await r.json();
  if (json.error) throw new Error(explicaError(json.error));
  return json;
}

/* Los errores de Meta vienen crípticos; traducimos los frecuentes. */
function explicaError(e) {
  const base = `Meta ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''}: ${e.error_user_msg || e.message}`;
  if (e.code === 190) return `${base}\n  → El token expiró o es inválido. Genera uno nuevo (ver: ayuda).`;
  if (e.code === 200) return `${base}\n  → Al token le falta el permiso ads_management sobre esta cuenta.`;
  if (e.code === 100 && /version/i.test(e.message || '')) {
    return `${base}\n  → Esa versión de la API ya no existe. Prueba META_API_VERSION=v21.0 en .env.`;
  }
  if (e.code === 2635) return `${base}\n  → Meta exige autorización previa para anunciar apuestas/juego. Sin ella la campaña se rechaza.`;
  return base;
}

function pesos(centavos) {
  return `$${(Number(centavos) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function aCentavos(monto) {
  const n = Number(String(monto).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) morir(`Presupuesto inválido: "${monto}"`);
  return Math.round(n * 100);
}

/* ============================================================
   whoami — qué ve este token
   ============================================================ */

async function whoami() {
  exigeToken();
  const yo = await get('me', { fields: 'id,name' });
  console.log(`\nToken de: ${yo.name} (${yo.id})`);

  const cuentas = await get('me/adaccounts', {
    fields: 'name,account_id,account_status,currency,amount_spent,balance',
    limit: 25,
  });
  console.log('\nCuentas publicitarias:');
  if (!cuentas.data.length) console.log('  (ninguna — el token no tiene acceso a cuentas de anuncios)');
  for (const c of cuentas.data) {
    const activa = c.account_status === 1 ? 'activa' : `status ${c.account_status}`;
    const marca = `act_${c.account_id}` === CUENTA ? '  ← META_AD_ACCOUNT' : '';
    console.log(`  act_${c.account_id}  ${c.name}  [${activa}, ${c.currency}]${marca}`);
  }

  const paginas = await get('me/accounts', { fields: 'name,id', limit: 25 });
  console.log('\nPáginas:');
  if (!paginas.data.length) console.log('  (ninguna — al token le falta pages_show_list)');
  for (const p of paginas.data) {
    console.log(`  ${p.id}  ${p.name}${p.id === PAGE ? '  ← META_PAGE_ID' : ''}`);
  }

  if (CUENTA) {
    const pixeles = await get(`${CUENTA}/adspixels`, { fields: 'name,id' });
    console.log('\nPixeles de la cuenta:');
    for (const p of pixeles.data) {
      console.log(`  ${p.id}  ${p.name}${p.id === PIXEL ? '  ← el del sitio' : ''}`);
    }
  }
  console.log('');
}

/* ============================================================
   Lectura: campañas, conjuntos, anuncios, públicos
   ============================================================ */

async function campanas() {
  exigeCuenta();
  const rango = opcion('dias', '30');
  const c = await get(`${CUENTA}/campaigns`, {
    fields: `name,status,objective,daily_budget,lifetime_budget,insights.date_preset(last_${rango}d){spend,impressions,clicks,ctr,cpc,actions,action_values}`,
    limit: 100,
  });
  if (!c.data.length) return console.log('\n(sin campañas en esta cuenta)\n');

  console.log(`\nCampañas — últimos ${rango} días\n`);
  for (const k of c.data) {
    const ins = k.insights && k.insights.data && k.insights.data[0];
    const compras = ins && (ins.actions || []).find((a) => a.action_type === 'purchase');
    const valor = ins && (ins.action_values || []).find((a) => a.action_type === 'purchase');
    const gasto = ins ? Number(ins.spend) : 0;

    console.log(`  ${k.name}`);
    console.log(`    ${k.id} · ${k.status} · ${k.objective}`);
    if (k.daily_budget) console.log(`    presupuesto diario: ${pesos(k.daily_budget)}`);
    if (!ins) { console.log('    (sin datos en el periodo)\n'); continue; }

    const n = compras ? Number(compras.value) : 0;
    const ingreso = valor ? Number(valor.value) : 0;
    console.log(`    gasto $${gasto.toFixed(2)} · ${ins.impressions} impr · ${ins.clicks} clics · CTR ${Number(ins.ctr).toFixed(2)}%`);
    console.log(`    compras ${n}${n ? ` · CPA $${(gasto / n).toFixed(2)}` : ''}${ingreso ? ` · ingreso $${ingreso.toFixed(2)} · ROAS ${(ingreso / gasto).toFixed(2)}x` : ''}`);
    console.log('');
  }
}

async function publicos() {
  exigeCuenta();
  const a = await get(`${CUENTA}/customaudiences`, {
    fields: 'name,id,subtype,approximate_count_lower_bound,delivery_status,time_updated',
    limit: 100,
  });
  if (!a.data.length) return console.log('\n(sin públicos guardados)\n');
  console.log('\nPúblicos personalizados\n');
  for (const p of a.data) {
    const tam = p.approximate_count_lower_bound;
    const estado = p.delivery_status ? p.delivery_status.description : '';
    console.log(`  ${p.id}  ${p.name}`);
    console.log(`    ${p.subtype} · ~${tam >= 0 ? tam.toLocaleString('es-MX') : 'calculando'} personas · ${estado}`);
  }
  console.log('');
}

async function anuncios() {
  exigeCuenta();
  const a = await get(`${CUENTA}/ads`, {
    fields: 'name,status,adset{name},creative{id,name,object_story_spec,image_hash,video_id}',
    limit: 100,
  });
  if (!a.data.length) return console.log('\n(sin anuncios)\n');
  console.log('\nAnuncios y sus creativos\n');
  for (const ad of a.data) {
    const cr = ad.creative || {};
    const spec = (cr.object_story_spec || {}).link_data || (cr.object_story_spec || {}).video_data || {};
    console.log(`  ${ad.id}  ${ad.name}  [${ad.status}]`);
    console.log(`    conjunto: ${ad.adset ? ad.adset.name : '—'}`);
    console.log(`    creativo: ${cr.id || '—'}${cr.image_hash ? ` · imagen ${cr.image_hash.slice(0, 12)}…` : ''}${cr.video_id ? ` · video ${cr.video_id}` : ''}`);
    if (spec.message) console.log(`    texto: ${String(spec.message).replace(/\n/g, ' ').slice(0, 90)}…`);
    if (spec.name) console.log(`    titular: ${spec.name}`);
    console.log('');
  }
}

/* ============================================================
   Públicos: crear
   ============================================================ */

/* Visitantes del sitio (o de una URL que contenga cierto texto). */
async function crearPublicoSitio() {
  exigeCuenta();
  const nombre = opcion('nombre') || morir('Falta --nombre');
  const dias = Number(opcion('dias', '180'));
  const contiene = opcion('url-contiene');

  const filtro = { event_sources: [{ id: PIXEL, type: 'pixel' }], retention_seconds: dias * 86400 };
  filtro.filter = contiene
    ? { operator: 'and', filters: [{ field: 'url', operator: 'i_contains', value: contiene }] }
    : { operator: 'or', filters: [{ field: 'event', operator: 'eq', value: 'PageView' }] };

  console.log(`\nPúblico de sitio: "${nombre}" · ${dias} días${contiene ? ` · URL contiene "${contiene}"` : ''}`);
  const r = await post(`${CUENTA}/customaudiences`, {
    name: nombre,
    subtype: 'WEBSITE',
    rule: { inclusions: { operator: 'or', rules: [filtro] } },
    prefill: 1,
  }, { etiqueta: 'publico' });
  console.log(`\n✓ ${r.id}\n`);
}

/* Quienes ya compraron: base para excluir y para el lookalike. */
async function crearPublicoCompradores() {
  exigeCuenta();
  const nombre = opcion('nombre', 'Compradores — 365 días');
  const dias = Number(opcion('dias', '365'));
  console.log(`\nPúblico de compradores: "${nombre}" · ${dias} días`);
  const r = await post(`${CUENTA}/customaudiences`, {
    name: nombre,
    subtype: 'WEBSITE',
    rule: {
      inclusions: {
        operator: 'or',
        rules: [{
          event_sources: [{ id: PIXEL, type: 'pixel' }],
          retention_seconds: dias * 86400,
          filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'Purchase' }] },
        }],
      },
    },
    prefill: 1,
  }, { etiqueta: 'compradores' });
  console.log(`\n✓ ${r.id}\n`);
}

/* Similar (lookalike) a partir de un público existente. */
async function crearSimilar() {
  exigeCuenta();
  const origen = opcion('origen') || morir('Falta --origen <id del público semilla>');
  const pct = Number(opcion('pct', '1'));
  const pais = opcion('pais', 'MX');
  const nombre = opcion('nombre', `Similar ${pct}% ${pais}`);
  console.log(`\nPúblico similar: "${nombre}" · ${pct}% de ${pais} · semilla ${origen}`);
  const r = await post(`${CUENTA}/customaudiences`, {
    name: nombre,
    subtype: 'LOOKALIKE',
    origin_audience_id: origen,
    lookalike_spec: { type: 'similarity', ratio: pct / 100, country: pais },
  }, { etiqueta: 'similar' });
  console.log(`\n✓ ${r.id}\n`);
}

/* ============================================================
   Creativos: subir archivos
   ============================================================ */

async function subirImagen(archivo) {
  const bytes = fs.readFileSync(archivo).toString('base64');
  const nombre = path.basename(archivo);
  if (!APLICAR) {
    console.log(`  [simulacro] subiría ${nombre} (${(bytes.length / 1365).toFixed(0)} KB)`);
    return `<simulacro:hash:${nombre}>`;
  }
  const cuerpo = new URLSearchParams({ bytes, access_token: TOKEN });
  const r = await fetch(`${API}/${CUENTA}/adimages`, { method: 'POST', body: cuerpo });
  const json = await r.json();
  if (json.error) throw new Error(explicaError(json.error));
  const hash = Object.values(json.images)[0].hash;
  console.log(`  ✓ ${nombre} → ${hash}`);
  return hash;
}

async function subirVideo(archivo) {
  const nombre = path.basename(archivo);
  if (!APLICAR) {
    console.log(`  [simulacro] subiría video ${nombre}`);
    return `<simulacro:video:${nombre}>`;
  }
  const form = new FormData();
  form.set('source', new Blob([fs.readFileSync(archivo)]), nombre);
  form.set('access_token', TOKEN);
  const r = await fetch(`${API}/${CUENTA}/advideos`, { method: 'POST', body: form });
  const json = await r.json();
  if (json.error) throw new Error(explicaError(json.error));
  console.log(`  ✓ ${nombre} → video ${json.id}`);
  return json.id;
}

const ES_VIDEO = /\.(mp4|mov|m4v|avi)$/i;
const ES_IMAGEN = /\.(jpe?g|png|gif|webp)$/i;

async function subirCreativos() {
  exigeCuenta();
  const ruta = opcion('archivos') || opcion('carpeta') || morir('Falta --carpeta <ruta> o --archivos <ruta>');
  const stat = fs.statSync(ruta);
  const lista = stat.isDirectory()
    ? fs.readdirSync(ruta).filter((f) => ES_VIDEO.test(f) || ES_IMAGEN.test(f)).map((f) => path.join(ruta, f))
    : [ruta];
  if (!lista.length) morir(`No hay imágenes ni videos en ${ruta}`);

  console.log(`\nSubiendo ${lista.length} archivo(s) a ${CUENTA}\n`);
  const resultado = { imagenes: {}, videos: {} };
  for (const f of lista) {
    if (ES_VIDEO.test(f)) resultado.videos[path.basename(f)] = await subirVideo(f);
    else resultado.imagenes[path.basename(f)] = await subirImagen(f);
  }
  const salida = path.join(__dirname, '..', '.meta-creativos.json');
  fs.writeFileSync(salida, JSON.stringify(resultado, null, 2));
  console.log(`\n✓ Referencias guardadas en ${path.relative(process.cwd(), salida)}`);
  console.log('  (úsalas como image_hash / video_id en el JSON de campaña)\n');
}

/* ============================================================
   Creativos: cambiar el de un anuncio que ya existe

   Meta no deja editar un creativo en uso: se crea uno nuevo y se
   reapunta el anuncio. El anuncio conserva su id, su historial y
   su aprendizaje.
   ============================================================ */

async function actualizarCreativo() {
  exigeCuenta();
  const adId = opcion('anuncio') || morir('Falta --anuncio <id>');
  if (!PAGE) morir('Falta META_PAGE_ID en .env.');

  const actual = await get(adId, { fields: 'name,creative{object_story_spec,name}' });
  const specActual = ((actual.creative || {}).object_story_spec || {}).link_data || {};

  const imagen = opcion('imagen');
  const video = opcion('video');
  const link = opcion('link') || specActual.link || 'https://rickypicks.com.mx';
  const texto = opcion('texto') || specActual.message;
  const titular = opcion('titular') || specActual.name;
  const descripcion = opcion('descripcion') || specActual.description;
  const cta = opcion('cta') || ((specActual.call_to_action || {}).type) || 'LEARN_MORE';

  console.log(`\nAnuncio: ${actual.name} (${adId})`);
  console.log('  antes → ' + JSON.stringify({ titular: specActual.name, texto: specActual.message }, null, 0));
  console.log('  después → ' + JSON.stringify({ titular, texto }, null, 0));

  let hash = specActual.image_hash;
  let videoId = null;
  if (imagen) hash = await subirImagen(imagen);
  if (video) videoId = await subirVideo(video);

  const storySpec = { page_id: PAGE };
  if (IG) storySpec.instagram_user_id = IG;
  if (videoId) {
    storySpec.video_data = {
      video_id: videoId, message: texto, title: titular, link_description: descripcion,
      call_to_action: { type: cta, value: { link } },
    };
  } else {
    storySpec.link_data = {
      link, message: texto, name: titular, description: descripcion,
      image_hash: hash, call_to_action: { type: cta, value: { link } },
    };
  }

  const creativo = await post(`${CUENTA}/adcreatives`, {
    name: `${actual.name} — creativo ${new Date().toISOString().slice(0, 10)}`,
    object_story_spec: storySpec,
  }, { etiqueta: 'creativo' });

  await post(adId, { creative: { creative_id: creativo.id } }, { etiqueta: 'reapuntar' });
  console.log(`\n✓ Anuncio ${adId} ahora usa el creativo ${creativo.id}\n`);
}

/* ============================================================
   Campaña completa desde un JSON

   Crea campaña → conjunto → creativos → anuncios, todo en PAUSED.
   ============================================================ */

async function crearCampana() {
  exigeCuenta();
  if (!PAGE) morir('Falta META_PAGE_ID en .env.');
  const archivo = opcion('config') || morir('Falta --config <archivo.json>  (ver scripts/meta-campana.ejemplo.json)');
  const cfg = JSON.parse(fs.readFileSync(archivo, 'utf8'));

  console.log(`\n${APLICAR ? '▶ CREANDO' : '◻ SIMULACRO —  agrega --aplicar para crear de verdad'}`);
  console.log(`\nCampaña: ${cfg.nombre}\n`);

  const campana = await post(`${CUENTA}/campaigns`, {
    name: cfg.nombre,
    objective: cfg.objetivo || 'OUTCOME_SALES',
    status: 'PAUSED',
    special_ad_categories: cfg.categorias_especiales || [],
    buying_type: 'AUCTION',
  }, { etiqueta: 'campana' });

  for (const conj of cfg.conjuntos) {
    const targeting = {
      geo_locations: conj.geo || { countries: ['MX'] },
      age_min: conj.edad_min || 21,
      age_max: conj.edad_max || 65,
      targeting_automation: { advantage_audience: conj.advantage === false ? 0 : 1 },
    };
    if (conj.generos) targeting.genders = conj.generos;
    if (conj.publicos_incluidos) targeting.custom_audiences = conj.publicos_incluidos.map((id) => ({ id }));
    if (conj.publicos_excluidos) targeting.excluded_custom_audiences = conj.publicos_excluidos.map((id) => ({ id }));
    if (conj.intereses) targeting.flexible_spec = [{ interests: conj.intereses }];
    if (conj.plataformas) targeting.publisher_platforms = conj.plataformas;

    const campos = {
      name: conj.nombre,
      campaign_id: campana.id,
      billing_event: 'IMPRESSIONS',
      optimization_goal: conj.optimizar_por || 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      promoted_object: { pixel_id: PIXEL, custom_event_type: conj.evento || 'PURCHASE' },
      targeting,
      status: 'PAUSED',
    };
    if (conj.presupuesto_diario) campos.daily_budget = aCentavos(conj.presupuesto_diario);
    else if (conj.presupuesto_total) {
      campos.lifetime_budget = aCentavos(conj.presupuesto_total);
      campos.end_time = conj.termina || morir('Un presupuesto total necesita "termina": "2026-09-30T23:59:00-0600"');
    } else morir(`El conjunto "${conj.nombre}" no tiene presupuesto_diario ni presupuesto_total.`);

    console.log(`\nConjunto: ${conj.nombre}`);
    const conjunto = await post(`${CUENTA}/adsets`, campos, { etiqueta: 'conjunto' });

    for (const anuncio of conj.anuncios) {
      console.log(`\n  Anuncio: ${anuncio.nombre}`);
      const storySpec = { page_id: PAGE };
      if (IG) storySpec.instagram_user_id = IG;

      if (anuncio.video) {
        const videoId = anuncio.video.startsWith('/') || anuncio.video.includes('.')
          ? await subirVideo(anuncio.video) : anuncio.video;
        storySpec.video_data = {
          video_id: videoId, message: anuncio.texto, title: anuncio.titular,
          link_description: anuncio.descripcion,
          call_to_action: { type: anuncio.cta || 'LEARN_MORE', value: { link: anuncio.link || cfg.link } },
          image_url: anuncio.miniatura,
        };
      } else {
        const hash = anuncio.imagen_hash || (anuncio.imagen ? await subirImagen(anuncio.imagen) : morir(`"${anuncio.nombre}" no tiene imagen ni video.`));
        storySpec.link_data = {
          link: anuncio.link || cfg.link, message: anuncio.texto, name: anuncio.titular,
          description: anuncio.descripcion, image_hash: hash,
          call_to_action: { type: anuncio.cta || 'LEARN_MORE', value: { link: anuncio.link || cfg.link } },
        };
      }

      const creativo = await post(`${CUENTA}/adcreatives`, {
        name: `${anuncio.nombre} — creativo`, object_story_spec: storySpec,
      }, { etiqueta: 'creativo' });

      await post(`${CUENTA}/ads`, {
        name: anuncio.nombre, adset_id: conjunto.id,
        creative: { creative_id: creativo.id }, status: 'PAUSED',
      }, { etiqueta: 'anuncio' });
    }
  }

  console.log(`\n${APLICAR
    ? `✓ Campaña ${campana.id} creada — TODO EN PAUSA.\n  Revísala en Ads Manager y actívala tú desde ahí, o con:\n  node scripts/meta-ads.js activar --id ${campana.id} --aplicar`
    : '◻ Nada se creó. Repite con --aplicar cuando el plan te cuadre.'}\n`);
}

/* ============================================================
   Prender y apagar
   ============================================================ */

async function cambiarEstado(estado) {
  exigeCuenta();
  const id = opcion('id') || morir('Falta --id <id de campaña, conjunto o anuncio>');
  const info = await get(id, { fields: 'name,status' });
  console.log(`\n${info.name}: ${info.status} → ${estado}`);
  await post(id, { status: estado }, { etiqueta: 'estado' });
  console.log(APLICAR ? '\n✓ Listo\n' : '\n◻ Simulacro. Agrega --aplicar.\n');
}

/* ============================================================
   Ayuda
   ============================================================ */

function ayuda() {
  console.log(`
Meta Ads — RICKY·PICKS

  PRIMERO, el token (una sola vez):
    1. developers.facebook.com → tu app (la misma del bot de IG sirve)
    2. Agrega el producto "Marketing API"
    3. Herramientas → Graph API Explorer → permisos:
         ads_management, ads_read, business_management, pages_show_list
    4. Genera el token y conviértelo en uno de larga duración en
       Herramientas → Access Token Debug Tool → "Extend Access Token"
    5. Pégalo en .env como META_ADS_TOKEN

  Luego:  node scripts/meta-ads.js whoami
  y copia a .env el act_XXXX y el id de tu página.

  LEER
    whoami                        qué cuentas, páginas y pixeles ve el token
    campanas [--dias 30]          campañas con gasto, CPA y ROAS
    publicos                      públicos personalizados y su tamaño
    anuncios                      anuncios con su creativo y copy actual

  PÚBLICOS
    publico-sitio --nombre "..." [--dias 180] [--url-contiene /nfl]
    publico-compradores [--nombre "..."] [--dias 365]
    publico-similar --origen <id> [--pct 1] [--pais MX]

  CREATIVOS
    subir --carpeta ./creativos           sube todo y guarda los hashes
    actualizar-creativo --anuncio <id> [--imagen f.jpg] [--video f.mp4]
                        [--texto "..."] [--titular "..."] [--cta SHOP_NOW]

  CAMPAÑAS
    crear-campana --config mi-campana.json
    activar --id <id>       pausar --id <id>

  Ningún comando de escritura hace nada sin  --aplicar.
  Todo lo que se crea nace en PAUSA.
`);
}

/* ============================================================ */

const COMANDOS = {
  whoami, campanas, publicos, anuncios,
  'publico-sitio': crearPublicoSitio,
  'publico-compradores': crearPublicoCompradores,
  'publico-similar': crearSimilar,
  subir: subirCreativos,
  'actualizar-creativo': actualizarCreativo,
  'crear-campana': crearCampana,
  activar: () => cambiarEstado('ACTIVE'),
  pausar: () => cambiarEstado('PAUSED'),
  ayuda,
};

const comando = process.argv[2];
if (!comando || !COMANDOS[comando]) {
  ayuda();
  process.exit(comando ? 1 : 0);
}
Promise.resolve(COMANDOS[comando]()).catch((e) => morir(e.message));
