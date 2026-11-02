# Seguimiento semanal de clientes (1-nov-2026)

Cada semana, a cada cliente con plan vivo: cómo le fue al modelo en **sus**
ligas y qué viene, para que se sienta acompañado. Sale por **WhatsApp**
(desde el 28-oct todos dan teléfono al registrarse) y **nunca menciona
renovaciones ni cobros** (regla del dueño).

## Las cuatro piezas

| Pieza | Qué hace | Código |
|---|---|---|
| **Registro de uso** | Quién entra, qué liga ve, desde qué aparato, cuánto tiempo. Solo con sesión; nada de lo que el usuario escribe. Resumen por día, sin SQL. | `public/huella.js` → `api/huella.js` → `lib/uso.js` (KV `uso-<userId>`, `uso-inicio`) |
| **Libreta de picks** | Foto de cada PICK hasta antes del arranque y calificación sola con el marcador de ESPN (MLB: statsapi). Unidades a una unidad por pick. | `lib/libreta.js`, `api/libreta.js` (cron cada hora, minuto 40). KV `libreta-AAAA-MM`, `libreta-proximos` |
| **Panel de seguimiento** | Lista de clientes vivos con su ficha interna (pagado, ranking, compras, accesos, suscripción, uso, avisos) y su mensaje de WhatsApp listo para revisar, abrir y marcar enviado. | `public/seguimiento.html` (solo admin) → `api/seguimiento.js` → `lib/seguimiento.js`. KV `seguimiento-pagos` (caché 6 h), `seguimiento-envios` |
| **Tu semana** | La página personal que va en el mensaje: balance de sus ligas, acumulado de 4 semanas, picks de la semana pasada y lo que viene. Liga firmada con HMAC, sin login. | `public/semana.html` → `api/semana.js` |

## Cómo se usa cada lunes

1. Abrir **dattip.com/seguimiento.html** (o el botón *Seguimiento* del admin).
2. Pestaña **Por mandar**: tocar un cliente, leer su ficha y la sección *Qué hacer*.
3. Editar el mensaje si hace falta → **Abrir WhatsApp** (wa.me con el texto) → mandar desde el teléfono.
4. **Marcar enviado**. El contador de arriba lleva la semana.

**Ningún mensaje sale sin que el dueño lo vea** (decisión del dueño,
2-nov-2026): el sistema no manda nada por su cuenta; solo prepara el texto y
el dueño lo abre y lo envía. Si algún día se automatiza con la API de
WhatsApp Business, debe seguir pasando por su aprobación antes del envío.

## Reglas de la libreta

- Solo veredictos `bet` (PICK). Se sobreescriben hasta el arranque; si un mercado deja de ser PICK antes de empezar, se borra.
- No se rellena hacia atrás: los veredictos de un partido jugado pueden traer lo que el modelo aprendió de ese resultado. **La libreta arranca el 1-nov-2026; el primer balance real sale el lunes 9 de noviembre.** Mientras tanto el mensaje da la bienvenida y enseña lo que viene.
- Precio para las unidades: momio real del veredicto → momio del total en el mercado (fútbol) → -110 en hándicap/total de NFL/NBA con línea de casas → si no hay precio, el momio justo del modelo (1/prob). Conservador a propósito.
- F5 y NRFI de MLB quedan `sin_calificar`. Pospuestos/cancelados (o sin final a los 4 días) quedan `anulado`. Ninguno cuenta en el balance.
- Semana = lunes a domingo, hora de CDMX, por la fecha de arranque.

## Probar

- `GET /api/libreta` (admin/cron) → foto + calificar. `?action=semana`, `?action=semanas&n=4`, `?action=lista&desde=AAAA-MM-DD&hasta=AAAA-MM-DD`.
- `GET /api/seguimiento` (admin) → todo; `?u=<userId>` → una ficha; `?fresco=1` → rehace pagos.
- `GET /api/semana?u=<userId>&t=<firma>` → lo que ve el cliente (la liga completa sale en su ficha: *Ver su página*).

## Pendientes

- **Envío desde la API** (opcional): WhatsApp Business Cloud API (número de empresa, plantilla aprobada por Meta). Aun así, con aprobación del dueño mensaje por mensaje. Hoy el envío es a mano desde el panel.
- El aviso de privacidad vive en el registro del teléfono (dicho por el dueño, 2-nov-2026).
- **"Jugué este" / liga de afiliado** (ideas del PDF): no se hicieron; la pregunta "¿Qué jugaste?" va al final del mensaje.
