/* ============================================================
   GET /api/mlb-free
   PÚBLICO. Devuelve UN solo juego de MLB del día — el que tiene
   el pick con más convicción — con datos mínimos para la card
   del hero del landing. Solo probabilidades; el modelo completo
   sigue gated en /api/mlb-picks.
   ============================================================ */
const { buildDay } = require('../lib/mlb/model');

const _cache = new Map(); // date -> { at, value }
const TTL = 10 * 60 * 1000;

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  const date = todayET();
  try {
    let value;
    const hit = _cache.get(date);
    if (hit && Date.now() - hit.at < TTL) {
      value = hit.value;
    } else {
      const day = await buildDay(date);
      const games = (day.games || []).filter(g => !g.error && g.abstract_state !== 'Final');
      const pool = games.length ? games : (day.games || []).filter(g => !g.error);
      if (!pool.length) {
        value = { date, game: null };
      } else {
        // el juego con el pick más fuerte del día
        const best = pool.reduce((a, b) => {
          const sa = (a.picks && a.picks[0] && a.picks[0].strength) || 0;
          const sb = (b.picks && b.picks[0] && b.picks[0].strength) || 0;
          return sb > sa ? b : a;
        });
        const m = best.markets;
        value = {
          date,
          game: {
            gamePk: best.gamePk,
            game_date: best.game_date,
            venue: best.venue,
            home: { id: best.home.id, abbr: best.home.abbr, name: best.home.name, record: best.home.record },
            away: { id: best.away.id, abbr: best.away.abbr, name: best.away.name, record: best.away.record },
            pitchers: {
              home: best.pitchers.home ? { name: best.pitchers.home.name, era: best.pitchers.home.era, hand: best.pitchers.home.hand } : null,
              away: best.pitchers.away ? { name: best.pitchers.away.name, era: best.pitchers.away.era, hand: best.pitchers.away.hand } : null,
            },
            moneyline: m.moneyline,
            expected: m.expected,
            pick: (best.picks && best.picks[0]) || null,
            sims: 10000,
          },
        };
      }
      _cache.set(date, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('mlb-free:', e);
    return res.status(500).json({ error: 'Sin datos por ahora.' });
  }
};
