/* ============================================================
   GET /api/config
   Configuración pública para el frontend: equipos, calendario y
   los partidos de hoy. NO incluye los coeficientes del modelo.
   ============================================================ */
const { publicConfig } = require('../lib/model');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  // Cacheable: la config pública cambia como mucho una vez al día.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(publicConfig());
};
