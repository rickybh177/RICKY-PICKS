/* ============================================================
   GET /api/mlb-free
   PÚBLICO. Devuelve UN solo juego de MLB del día — el que tiene
   el pick con más convicción — con datos mínimos para la card
   del hero del landing. Solo probabilidades; el modelo completo
   sigue gated en /api/mlb-picks.
   ============================================================ */
const { buildDay } = require('../lib/mlb/model');
const { featuredGame } = require('../lib/mlb/featured');

const _cache = new Map(); // date -> { at, value }
const TTL = 10 * 60 * 1000;

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* Prioridad de veredictos para la card del landing. */
const ORDEN = { bet: 3, maybe: 2, skip: 1 };
function mejorVeredicto(verdicts) {
  const list = (verdicts || []).filter(v => v && v.label);
  if (!list.length) return null;
  /* Se ordena en vez de reducir: la versión con reduce tenía un error
     de precedencia (`a || b > 0 ? x : y` agrupa como `(a || (b>0)) ? …`)
     y devolvía el ÚLTIMO veredicto siempre que el orden difería — por
     eso la card mostraba un MAYBE teniendo el juego un BET. */
  const v = list.slice().sort((a, b) => {
    const d = (ORDEN[b.verdict] || 0) - (ORDEN[a.verdict] || 0);
    return d !== 0 ? d : (b.prob || 0) - (a.prob || 0);
  })[0];
  return { verdict: v.verdict, label: v.label, prob: v.prob };
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
      // MISMA elección que /api/mlb-picks (incluye overrides manuales):
      // si divergen, el landing muestra un partido gratis y la página
      // del modelo otro.
      const best = featuredGame(day.games || [], date);
      if (!best) {
        value = { date, game: null };
      } else {
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
            /* El mejor VEREDICTO del juego (bet > maybe > skip) con su
               etiqueta ya escrita. Hace falta porque `picks` solo trae
               los de alta convicción: si el destacado no tiene ninguno
               —pasa cuando el pick gratis se fija a mano— la card se
               quedaba con el texto de relleno y con un chip BET que el
               juego no tiene. */
            verdict: mejorVeredicto(best.verdicts),
            /* La cartelera COMPLETA del pick gratis: todos sus mercados
               con veredicto y la distribución de carreras. No es nada
               nuevo — /api/mlb-picks ya sirve este mismo juego entero a
               invitados; viaja aquí para que la página de compra lo
               enseñe sin pedir la jornada completa. */
            verdicts: best.verdicts || [],
            total_line: m.total ? m.total.line : null,
            total_dist: m.total_dist || [],
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
