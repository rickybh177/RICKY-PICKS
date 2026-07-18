/* ============================================================
   GET /api/mx-free
   PÚBLICO. Devuelve UN solo partido de Liga MX — el pick con más
   convicción de la jornada — con datos mínimos para la card del
   landing. Solo probabilidades; la cartelera completa sigue
   gated en /api/mx-picks.
   ============================================================ */
const { buildBoard } = require('../lib/mx/model');

let _cache = null; // { at, value }
const TTL = 10 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    let value;
    if (_cache && Date.now() - _cache.at < TTL) {
      value = _cache.value;
    } else {
      const board = await buildBoard();
      const games = (board.games || []).filter(g => !g.error);
      const pre = games.filter(g => g.state === 'pre');
      const pool = pre.length ? pre : games;
      if (!pool.length) {
        value = { jornada: board.jornada, game: null };
      } else {
        const best = pool.reduce((a, b) => ((b.strength || 0) > (a.strength || 0) ? b : a));
        const topPick = (best.verdicts || []).filter(v => v.verdict === 'bet')
          .sort((a, b) => (b.prob || 0) - (a.prob || 0))[0] || (best.verdicts || [])[0] || null;
        value = {
          jornada: board.jornada,
          tournament: board.tournament,
          game: {
            id: best.id,
            date: best.date,
            venue: best.venue,
            home: { abbr: best.home.abbr, name: best.home.name, logo: best.home.logo, form: best.home.form },
            away: { abbr: best.away.abbr, name: best.away.name, logo: best.away.logo, form: best.away.form },
            moneyline: best.markets ? best.markets.moneyline : null,
            pick: topPick ? { label: topPick.label, verdict: topPick.verdict, prob: topPick.prob, line_txt: topPick.line_txt } : null,
          },
        };
      }
      _cache = { at: Date.now(), value };
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('mx-free:', e);
    return res.status(500).json({ error: 'Sin datos por ahora.' });
  }
};
