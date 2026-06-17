# RICKY·PICKS

E-commerce de picks del Mundial 2026 con modelo **Dixon-Coles**, pagos con **Mercado Pago** y cuentas/accesos con **Supabase**.

El modelo (los coeficientes entrenados) corre **en el backend** y nunca se envía al navegador: el sitio solo recibe probabilidades y xG ya calculados.

---

## 1. Estructura del proyecto

```
RICKY-PICKS/
├── public/
│   └── index.html          # El sitio (frontend). Copys y esencia originales.
├── api/                    # Funciones serverless (Vercel)
│   ├── config.js           # GET  /api/config  → equipos, calendario, partidos de hoy (público)
│   ├── picks.js            # POST /api/picks   → corre el modelo, gateado por acceso
│   ├── create-payment.js   # POST /api/create-payment → crea el pago en Mercado Pago
│   └── mp-webhook.js       # POST /api/mp-webhook → confirma el pago y otorga el acceso
├── lib/                    # Código compartido del backend (NO se sirve al navegador)
│   ├── model.js            # Coeficientes Dixon-Coles + matemática del modelo
│   ├── plans.js            # Planes y precios (fuente de verdad)
│   └── supabaseAdmin.js    # Cliente Supabase con service role
├── package.json
├── vercel.json
├── .env.example            # Plantilla de variables de entorno
└── .gitignore
```

> **Por qué se protege el modelo:** `lib/model.js` solo lo importan las funciones de `api/`. Como Vercel sirve estáticamente la carpeta `public/`, los archivos de `lib/` y `api/` no se pueden descargar desde el navegador. El frontend recibe únicamente el resultado del cálculo.

---

## 2. Subir a GitHub (reemplazando el proyecto actual)

Ya tienes el repo `github.com/rickybh177/RICKY-PICKS` conectado a Vercel (`ricky-picks.vercel.app`). Esta versión nueva **reemplaza** el contenido de ese repo, así que el dominio, las variables de entorno y el webhook de Mercado Pago siguen funcionando sin reconfigurar nada.

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "RICKY-PICKS v2: rediseño + backend (modelo protegido, Mercado Pago, Supabase)"
git branch -M main
git remote add origin https://github.com/rickybh177/RICKY-PICKS.git
git push -u origin main --force   # reemplaza el contenido anterior del repo
```

> Si prefieres no sobrescribir, crea un repo nuevo y conéctalo a un proyecto nuevo de Vercel (en ese caso tendrás que volver a poner las variables de entorno y el webhook).

---

## 3. Desplegar en Vercel

Como el repo ya está conectado, **cada push despliega solo** a `ricky-picks.vercel.app`. No necesitas crear nada nuevo.

Si fuera un proyecto desde cero: **Add New… → Project** → importa el repo → Framework Preset **Other** (sin build) → agrega las variables de entorno (siguiente sección) → **Deploy**.

---

## 4. Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Qué es | Dónde se obtiene |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta.** Permite al backend verificar sesiones y otorgar accesos | Supabase → Project Settings → API → `service_role` |
| `MP_ACCESS_TOKEN` | **Secreta.** Token de Mercado Pago (producción) | Mercado Pago → Tus integraciones → Credenciales de producción |
| `MP_WEBHOOK_SECRET` | Clave para validar la firma del webhook (opcional, recomendado) | Mercado Pago → Webhooks → Clave secreta |
| `SITE_URL` | URL pública del sitio (sin `/` final) | La que te da Vercel (`https://ricky-picks.vercel.app`) |

> Estas variables (menos `MP_WEBHOOK_SECRET`) **ya las tienes configuradas** en tu proyecto de Vercel. Solo agrega `MP_WEBHOOK_SECRET` si vas a validar la firma del webhook.

> El frontend usa la **anon/publishable key** de Supabase, que es pública y ya está dentro de `public/index.html`. La **service role** va SOLO en Vercel, nunca en el HTML.

---

## 5. Mercado Pago

1. Crea una aplicación en [Mercado Pago Developers](https://www.mercadopago.com.mx/developers).
2. Copia el **Access Token de producción** → variable `MP_ACCESS_TOKEN`.
3. En **Webhooks**, registra la URL (es la misma ruta que ya usabas):
   ```
   https://ricky-picks.vercel.app/api/mp-webhook
   ```
   y suscríbete al evento **Pagos** (`payment`). Copia la **clave secreta** → `MP_WEBHOOK_SECRET`.
4. Flujo: el cliente paga → Mercado Pago llama a `/api/mp-webhook` → el backend confirma el pago y otorga el acceso en Supabase automáticamente.

Para **probar** sin cobrar de verdad, usa las credenciales de prueba y las [tarjetas de prueba](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards).

---

## 6. Supabase

El frontend ya usa tu proyecto. El backend espera una tabla `entitlements` y (para el canje de códigos protegido) una función `pick_access`.

### 6.1 Tabla de accesos `entitlements`

Si aún no existe, créala en **Supabase → SQL Editor**:

```sql
create table if not exists public.entitlements (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null check (plan in ('individual','torneo')),
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.entitlements enable row level security;

-- Cada usuario solo puede LEER su propio acceso.
create policy "lee su propio acceso"
  on public.entitlements for select
  using (auth.uid() = user_id);

-- Nadie escribe desde el cliente: solo el backend (service role) otorga accesos.
```

> El webhook usa la **service role key**, que ignora RLS, así que puede insertar/actualizar accesos sin políticas extra de escritura.

### 6.2 Función para canje de códigos en el backend (opcional)

Solo necesaria si usarás la sección **"Canjea tu código"** con el modelo protegido. Devuelve el plan de un código ya canjeado y activo, **sin consumirlo**. Tu tabla de códigos es `access_codes`; ajusta los nombres de columnas a los reales de esa tabla:

```sql
create or replace function public.pick_access(p_code text)
returns text
language sql
security definer
set search_path = public
as $$
  select plan
  from public.access_codes
  where code = upper(p_code)
    and redeemed = true        -- ya canjeado
  limit 1;
$$;
```

Si no creas esta función, el sitio sigue funcionando: los accesos por **cuenta** (compra → webhook) operan igual, y el canje de código simplemente no autorizará la herramienta protegida.

---

## 7. Mantenimiento diario

- **Partidos de hoy:** actualiza la fecha en `lib/model.js`:
  ```js
  const TODAY_ISO = '2026-06-16'; // ← cámbiala cada día
  ```
  Los 4 partidos del día y el partido gratis se derivan solos del calendario.
- **Historial y récord:** se editan en `public/index.html` (tabla de Historial y tarjeta de récord).

---

## 8. Desarrollo local (opcional)

```bash
npm install
npm i -g vercel
vercel dev            # levanta el sitio + las funciones en http://localhost:3000
```

Crea un archivo `.env` (copia de `.env.example`) con tus credenciales para que `vercel dev` las tome.

---

## 9. Notas

- Sitio solo para mayores de 18 años. Los picks son análisis estadístico, no garantía de resultado.
- Los precios viven en `lib/plans.js` y se validan en el servidor: el navegador no puede alterarlos.
