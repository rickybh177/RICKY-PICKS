/* POST /api/paypal-create — DESHABILITADO.
   La cuenta de PayPal fue bloqueada permanentemente; esta pasarela
   ya no se ofrece. Se deja el archivo (en vez de borrarlo) por si
   algún día se reactiva con otra cuenta. */
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(410).json({ error: 'Pago con PayPal no disponible. Usa tarjeta o Mercado Pago.' });
};
