/* ============================================================
   POST /api/mp-webhook
   Mercado Pago avisa aquí cuando cambia un pago. Confirmamos el
   estado contra la API de MP y, si está aprobado, otorgamos el
   acceso al usuario (entitlement). Responde 200 siempre que se
   procese (MP reintenta ante errores).
   ============================================================ */
const crypto = require('crypto');
const { PLANS } = require('../lib/plans');
const { grantEntitlement } = require('../lib/supabaseAdmin');

// Validación opcional de firma (recomendada). Si configuras
// MP_WEBHOOK_SECRET, se rechazan las notificaciones sin firma válida.
function signatureValid(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // sin secreto configurado: no se valida.
  const sig = req.headers['x-signature'];
  const reqId = req.headers['x-request-id'];
  if (!sig) return false;
  const parts = Object.fromEntries(
    sig.split(',').map(kv => kv.split('=').map(s => s.trim()))
  );
  const ts = parts.ts, v1 = parts.v1;
  if (!ts || !v1) return false;
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // El id del pago puede venir en query o en el cuerpo.
  const type = (req.query && req.query.type) || body.type || body.topic;
  const dataId =
    (req.query && (req.query['data.id'] || req.query.id)) ||
    (body.data && body.data.id) ||
    body.id;

  // Solo nos interesan los pagos.
  if (type && type !== 'payment') return res.status(200).end();
  if (!dataId) return res.status(200).end();

  if (!signatureValid(req, dataId)) {
    console.error('mp-webhook: firma inválida o ausente para dataId=' + dataId + ' — revisa que MP_WEBHOOK_SECRET coincida con el secreto configurado en el panel de Mercado Pago.');
    return res.status(401).end();
  }

  let ref = '';
  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!mpRes.ok) {
      // 404 = todavía no propaga; pedimos reintento.
      return res.status(mpRes.status === 404 ? 404 : 502).end();
    }
    const payment = await mpRes.json();

    if (payment.status !== 'approved') {
      return res.status(200).end(); // pendiente/rechazado: nada que otorgar.
    }

    ref = payment.external_reference ||
      (payment.metadata && `${payment.metadata.user_id}:${payment.metadata.plan}`) || '';
    const [userId, planId] = ref.split(':');
    if (!userId || !PLANS[planId]) {
      console.error('mp-webhook: external_reference inválido — ref=' + ref + ' payment_id=' + dataId);
      return res.status(200).end();
    }

    await grantEntitlement(userId, planId);
    console.log('mp-webhook: acceso otorgado — user_id=' + userId + ' plan=' + planId + ' payment_id=' + dataId);
    return res.status(200).end();
  } catch (e) {
    console.error('mp-webhook: error al otorgar acceso — ref=' + ref + ' payment_id=' + dataId, e);
    return res.status(502).end();
  }
};
