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
   `instagram_business_manage_messages`, `instagram_business_manage_comments`.
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

Después de agregarlas: **Redeploy**.

### 5. Registrar el webhook en Meta

En la app de Meta → producto Instagram → **Set up webhooks**:

- **Callback URL:** `https://rickypicks.com.mx/api/ig-webhook`
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
- **El token dura 60 días.** Renovarlo antes de que venza:
  `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=EL_TOKEN`
  y actualizar `IG_ACCESS_TOKEN` en Vercel. (Se puede automatizar con un cron después.)

## Seguridad

- Vercel parsea el JSON de los webhooks (no hay raw body), así que la firma
  `X-Hub-Signature-256` no se puede validar. En su lugar, **cada comentario/mensaje se
  re-consulta a la Graph API** antes de actuar (mismo patrón que `stripe-webhook.js`):
  un payload falsificado no referencia ids reales y se descarta.
  Escape de emergencia: `IG_VERIFY_SOURCE=off` desactiva la re-consulta de mensajes.
- Las tablas `ig_*` tienen RLS activado sin políticas: solo el backend (service role)
  puede tocarlas.
- `/api/ig-admin` exige sesión de Supabase del correo admin.

## Archivos

- `api/ig-webhook.js` — recibe eventos de Meta, corre el motor de reglas.
- `api/ig-admin.js` — API del panel (reglas, inbox, comentarios, envío manual).
- `lib/instagram.js` — helpers de la Graph API + matching de reglas.
- `public/admin-instagram.html` — panel.
- `scripts/ig-schema.sql` — esquema de Supabase.
