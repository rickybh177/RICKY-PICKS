# Correo propio de Dattip (28-oct-2026)

El sitio ya manda correos a nombre de Dattip con **Resend** (HTTP, sin SDK).
Nació con la prioridad 1 del plan de cobros: la liga de pago el mismo día que
falla un cobro. Tres correos:

| Correo | Cuándo | A quién | Código |
|---|---|---|---|
| **Pago fallido** | el mismo día que Stripe rechaza una renovación (`invoice.payment_failed`) y un recordatorio al día 3 | el cliente | `lib/cobros.js` desde `api/stripe-webhook.js`; barrido diario `api/email-cobros.js` (cron 10:00 CDMX) |
| **Picks de la semana** | jueves 16:00 CDMX | todas las cuentas de Supabase que no se hayan dado de baja | `api/email-jueves.js` (cron) |
| **Marcador del lunes** | lunes 9:00 CDMX | solo el dueño | `api/email-lunes.js` (cron) |

Plantillas y envío: `lib/email.js`. Bajas: `api/email-baja.js` (liga firmada
con HMAC al pie del correo del jueves; se guarda en el KV `email-bajas`). Los
correos de cobro son transaccionales y no respetan la baja. Bitácora de envíos
en el KV `email-log` (`GET /api/email-cobros?action=status`).

## Encender (una sola vez, el dueño)

1. Cuenta en [resend.com](https://resend.com) (gratis hasta 3,000 correos/mes).
2. **Domains → Add domain → `dattip.com`**. Resend muestra registros DNS
   (un TXT de verificación, los de DKIM y un MX/TXT para el "return path").
   Agregarlos donde vive el DNS de dattip.com y esperar a que Resend marque
   *Verified*. Sin esto, Resend solo manda al correo de la propia cuenta.
3. **API Keys → Create** → pegar en Vercel como `RESEND_API_KEY`
   (Production). Opcional: `EMAIL_FROM` (default `Dattip <picks@dattip.com>`)
   y `EMAIL_REPLY_TO`. Redeploy (las funciones leen env al desplegar).
4. En Stripe, el webhook `https://dattip.com/api/stripe-webhook` debe estar
   suscrito a `invoice.payment_failed` además de `invoice.paid` y
   `checkout.session.completed` (se agregó el 28-oct-2026).

## Probar sin molestar a nadie (sesión admin o CRON_SECRET)

- `GET /api/email-jueves?action=preview` → el HTML del correo del jueves.
- `GET /api/email-jueves?action=test` → lo manda solo al admin.
- `GET /api/email-lunes?action=preview` · `?action=datos` → el marcador.
- `GET /api/email-cobros?action=status` → registro de avisos y bitácora.

El envío real del jueves tiene candado por fecha (`email-jueves` en el KV);
`?force=1` lo repite.

## Decisiones

- **Sin aviso previo al cobro.** El dueño lo pidió explícitamente (28-oct).
  Solo se avisa cuando algo falla.
- Resend permite 100 correos por llamada; el jueves se manda en lotes.
- El correo del jueves toma los picks de los MISMOS endpoints públicos del
  landing (igual que el post de Instagram), vigentes en los próximos 7 días.
- Lenguaje: análisis y datos, nunca promesa de ganancia ("Si vas a jugar,
  juega con cabeza" en el pie de todos).
