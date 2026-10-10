# Automatización de Instagram — RICKY·PICKS

Respuestas automáticas a comentarios y DMs de Instagram (estilo ManyChat), integrado
al stack existente: funciones de Vercel + Supabase + panel admin.

**Panel:** `/admin-instagram.html` (solo `rickybh17@gmail.com`)

- **Automatizaciones** — reglas "si comentan/escriben X → responder Y". Ej.: comenta
  `PICKS` → responde el comentario en público + manda DM con el link. Plantillas con
  `{{username}}` y `{{nombre}}`.
- **Inbox** — todas las conversaciones de DM, con indicador de la ventana de 24 h y
  envío manual.
- **Comentarios** — log de comentarios procesados y qué acción se tomó.

---

## Configuración (una sola vez)

### 1. Cuenta de Instagram

La cuenta debe ser **profesional** (Business o Creator): Instagram → Configuración →
Tipo de cuenta. No hace falta página de Facebook (usamos la "Instagram API with
Instagram Login").

### 2. Crear la app en Meta

1. Entra a [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**.
2. Tipo: **Business**. Nombre: p. ej. "RICKY PICKS Bot".
3. En el dashboard de la app, agrega el producto **Instagram** → "API setup with Instagram login".
4. En **Generate access tokens**: agrega tu cuenta de Instagram y genera el token.
   Autoriza los permisos `instagram_business_basic`,
   `instagram_business_manage_messages`, `instagram_business_manage_comments`
   y **`instagram_business_content_publish`** (este último es el del post diario).
   Copia el **token de larga duración** (dura 60 días).

> En modo desarrollo la app solo funciona con tu propia cuenta — exactamente lo que
> queremos. No hace falta App Review.

### 3. Correr el esquema en Supabase

Supabase → SQL Editor → pegar y correr `scripts/ig-schema.sql`.

### 4. Variables de entorno en Vercel

| Variable | Valor |
|---|---|
| `IG_ACCESS_TOKEN` | El token de larga duración del paso 2 |
| `IG_VERIFY_TOKEN` | Un string inventado por ti (p. ej. `ricky-ig-2026-xyz`) |
| `IG_ID` | (Opcional) id numérico de la cuenta; si falta se resuelve solo |
| `CRON_SECRET` | Cualquier string largo. Vercel lo manda solo al disparar el cron del post diario; sin él, `/api/ig-daily` rechaza al cron |

Después de agregarlas: **Redeploy**.

### 5. Registrar el webhook en Meta

En la app de Meta → producto Instagram → **Set up webhooks**:

- **Callback URL:** `https://dattip.com/api/ig-webhook`
- **Verify token:** el mismo string de `IG_VERIFY_TOKEN`
- Suscribirse a los campos: **`messages`** y **`comments`**

Meta hace un GET de verificación al guardar; si las env vars ya están en Vercel,
pasa a la primera.

### 6. Probar

1. Desde OTRA cuenta de Instagram, comenta la palabra clave en un post tuyo → debe
   llegar la respuesta pública + el DM.
2. Manda un DM con una keyword → debe llegar la respuesta automática.
3. Todo queda registrado en el panel (`/admin-instagram.html`).

---

## Reglas del juego (límites de la API de Meta — aplican igual a ManyChat)

- **Solo puedes iniciar conversación** con quien te escribió o comentó. El DM a un
  comentario es un **private reply**: 1 por comentario, dentro de 7 días.
- **Ventana de 24 h**: tras el último mensaje del usuario tienes 24 h para responder
  libremente. Pasada la ventana, Instagram rechaza el envío (el inbox lo indica).
- **El token dura 60 días.** El post diario lo **refresca solo cada 7 días** y guarda el
  vigente en el KV (`ig-token`, bucket `odds-cache`); `IG_ACCESS_TOKEN` en Vercel es solo
  el de arranque. Si pegas un token nuevo en Vercel, ese vuelve a mandar. Renovación a mano:
  botón "refresh-token" vía `POST /api/ig-daily {action:'refresh-token'}` o
  `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=EL_TOKEN`.

## Seguridad

- Vercel parsea el JSON de los webhooks (no hay raw body), así que la firma
  `X-Hub-Signature-256` no se puede validar. En su lugar, **cada comentario/mensaje se
  re-consulta a la Graph API** antes de actuar (mismo patrón que `stripe-webhook.js`):
  un payload falsificado no referencia ids reales y se descarta.
  Escape de emergencia: `IG_VERIFY_SOURCE=off` desactiva la re-consulta de mensajes.
- Las tablas `ig_*` tienen RLS activado sin políticas: solo el backend (service role)
  puede tocarlas.
- `/api/ig-admin` exige sesión de Supabase del correo admin.

---

## Post diario de free picks (`/api/ig-daily`)

Cada día a las **9:00 CDMX** (cron de Vercel, `0 15 * * *` UTC, en `vercel.json`) se publica
un **carrusel** con el pick gratis de cada liga que juega **mañana** (el post sale siempre un día antes del partido), con el formato del
post manual del 27-sep-2026 (Eagles @ Bears):

1. **Portada** "FREE PICK(S)": escudos sobre los colores de cada equipo + insignia de la liga.
   Con una sola liga es la réplica exacta del post; con varias se apilan las franjas.
2. **PICK PRINCIPAL** por liga: la card oscura del landing (fecha, equipos, probabilidades,
   barra, chip PICK/MAYBE/SKIP, estadio).
3. **PICKS ALTERNATIVOS** por liga: todos los mercados con su veredicto, probabilidad y edge.
4. **PROPS JUGADOR** (solo NFL, si cabe): los dos jugadores con más que decir.
5. **COMENTA MODELO** para analizar todos los partidos (siempre `MODELO`; se puede
   cambiar desde el panel). La regla de respuesta en ig_rules debe reaccionar a esa palabra.

Caption: picks del día siguiente + "Comenta MODELO" + **5 hashtags máximo** (sportsbetting,
picks, uno por liga, relleno con pronosticos/apuestas/deportes).

Reglas:
- Los datos salen de los **mismos endpoints públicos** que pinta el landing (`/api/mx-free`,
  `/api/euro-free`, `/api/mlb-free`, `/api/nfl-picks` como invitado): overrides y clavado
  del KV incluidos. Lo que enseña el post es lo que ve quien entra a dattip.com.
- Entra una liga si su pick gratis **se juega mañana** (fecha de CDMX). Lo de hoy ya no se publica; lo de pasado mañana saldrá mañana.
- **Un partido se publica una sola vez** (registro en el KV `ig-daily-posted`, 45 días).
- Cupo de Instagram: 10 láminas. Orden del landing (NFL, Liga MX, Champions, MLB, Premier,
  LaLiga, Bundesliga); los props NFL se quitan primero si no caben.
- Si no hay nada que publicar, no publica (queda en la bitácora).
- Las láminas se dibujan en la lambda (satori + sharp, fuentes en `lib/ig/fonts/`) y se
  suben al bucket público `ig-media` de Supabase Storage (se crea solo); Instagram las
  descarga de ahí. Carpeta `daily/<fecha>/` lo publicado, `preview/<fecha>/` las vistas previas.
- Candado de 10 min contra corridas dobles (Vercel reintenta crons).

Panel: `/admin-instagram.html` → pestaña **Post diario**: estado (token, cron, pausa, último
post), **Vista previa de hoy** (arma y enseña las láminas y el caption sin publicar),
**Publicar ahora**, pausa, palabra clave y bitácora.

Puesta en marcha (una vez): el token del paso 2 con `instagram_business_content_publish`,
`CRON_SECRET` en Vercel y redeploy. Probar con "Vista previa de hoy" y luego "Publicar ahora".
El cron solo corre en producción (dominio principal), no en previews.

Archivos: `api/ig-daily.js` (cron + acciones del panel), `lib/ig/plan.js` (qué ligas entran,
láminas y caption), `lib/ig/render.js` (dibujo de las láminas), `lib/ig/publish.js`
(Storage + Content Publishing API + registro en KV).

## Archivos

- `api/ig-webhook.js` — recibe eventos de Meta, corre el motor de reglas.
- `api/ig-admin.js` — API del panel (reglas, inbox, comentarios, envío manual).
- `lib/instagram.js` — helpers de la Graph API + matching de reglas.
- `public/admin-instagram.html` — panel.
- `scripts/ig-schema.sql` — esquema de Supabase.
