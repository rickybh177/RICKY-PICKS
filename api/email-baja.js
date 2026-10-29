/* ============================================================
   /api/email-baja?u=<userId>&t=<firma> — "ya no quiero estos correos".
   Liga que va al pie del correo del jueves. Guarda la baja en el KV
   y responde una página mínima. Los correos de cobro no se ven
   afectados (son transaccionales).
   ============================================================ */
const email = require('../lib/email');

const pagina = (titulo, texto) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titulo}</title></head>
<body style="margin:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a"><div style="max-width:520px;margin:60px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
<div style="color:#2563eb;font-weight:800;letter-spacing:.5px">DAT•TIP</div><h1 style="font-size:22px;margin:12px 0">${titulo}</h1><p style="font-size:16px;line-height:1.5;color:#475569">${texto}</p><a href="/" style="color:#2563eb">Volver a dattip.com</a></div></body></html>`;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const u = req.query && req.query.u; const t = req.query && req.query.t;
  if (!u || !t || !email.verificaBaja(u, t)) return res.status(400).send(pagina('Esa liga no es válida', 'Abre la liga tal como viene en el correo. Si el problema sigue, responde ese correo y te damos de baja a mano.'));
  await email.marcaBaja(u);
  return res.status(200).send(pagina('Listo, ya no te escribimos', 'Quitamos tu correo de los picks de la semana. Tu cuenta y tu acceso siguen igual; los avisos de cobro, si tienes suscripción, sí te seguirán llegando.'));
};
