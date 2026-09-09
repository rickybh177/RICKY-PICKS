/* ============================================================
   GET /api/euro-free?liga=epl|laliga|bundesliga
   Devuelve UN solo partido de la liga — el pick con más convicción
   de la jornada — con datos mínimos para la card del landing y de
   producto.html. EXACTAMENTE la forma de /api/mx-free (más
   league_id / league_name), así la card es la misma.

   BETA PRIVADA: mientras la liga no esté en PUBLIC_LEAGUES (mismo
   Set que api/euro-picks.js), contesta 403 { error, beta: true } a
   quien no sea admin; el landing quita la sección entera. Cuando se
   abre al público es PÚBLICO sin sesión, como /api/mx-free.

   Dev local: se sirve completo; `?as=beta` simula el 403 del
   público con la liga privada (`?as=guest` = público con la liga ya
   abierta, igual que en euro-picks).
   ============================================================ */
const { buildBoard } = require('../lib/euro/model');
const { featuredGame, overrideDe } = require('../lib/euro/featured');
const { veredictoDeCard } = require('../lib/free-pick');
const { leagueOf } = require('../lib/euro/leagues');
const { getUserFromToken } = require('../lib/supabaseAdmin');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

/* Ligas abiertas al público. Debe ser el MISMO Set que en
   api/euro-picks.js: si divergen, el landing muestra un pick de una
   liga cuya página sigue cerrada (o al revés). */
/* 8-sep-2026: las cuatro ligas son PÚBLICAS en modo freemium (el pick
   gratis de cada jornada se ve sin cuenta; el resto de la cartelera va
   bloqueado en el servidor). Sus planes siguen con `upcoming` en
   lib/plans.js, así que el candado manda a "próximamente". Para volver
   a beta privada: vaciar el Set (en los DOS endpoints). */
const PUBLIC_LEAGUES = new Set(['epl', 'laliga', 'bundesliga', 'ucl']);

const _cache = new Map(); // leagueId -> { at, value }
const TTL = 10 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const cfg = leagueOf(req.query && req.query.liga);
  if (!cfg || !cfg.enabled) return res.status(400).json({ error: 'Liga no válida.' });
  const leagueId = cfg.id;

  // ---- beta privada: mismo camino de 403 que euro-picks ----
  const simulate = IS_DEV && req.query && (req.query.as === 'guest' || req.query.as === 'beta') ? req.query.as : null;
  let isAdmin = IS_DEV && !simulate;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token && !isAdmin && !simulate) {
    const user = await getUserFromToken(token);
    if (user && ADMIN_EMAILS.includes(user.email)) isAdmin = true;
  }
  const isPublic = PUBLIC_LEAGUES.has(leagueId) || simulate === 'guest';
  if (!isPublic && !isAdmin) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Modelo en beta privada.', beta: true, league_id: leagueId, league_name: cfg.name });
  }

  try {
    const hit = _cache.get(leagueId);
    let value;
    if (hit && Date.now() - hit.at < TTL) {
      value = hit.value;
    } else {
      const board = await buildBoard(leagueId);
      /* MISMA elección que /api/euro-picks (KV + overrides): si
         divergen, el landing muestra un partido gratis y la página
         del modelo otro. */
      const best = await featuredGame(leagueId, board.games || [], board.jornada);
      if (!best) {
        value = { jornada: board.jornada, tournament: board.tournament, league_id: board.league_id, league_name: board.league_name, game: null };
      } else {
        /* Mercado fijado a mano (override) o, si no, el mejor BET. */
        const ov = overrideDe(leagueId, best);
        const topPick = (ov && ov.mercado ? veredictoDeCard(best.verdicts, ov.mercado) : null)
          || (best.verdicts || []).filter(v => v.verdict === 'bet')
            .sort((a, b) => (b.prob || 0) - (a.prob || 0))[0]
          || (best.verdicts || [])[0] || null;
        value = {
          jornada: board.jornada,
          tournament: board.tournament,
          league_id: board.league_id,
          league_name: board.league_name,
          game: {
            id: best.id,
            date: best.date,
            venue: best.venue,
            home: { abbr: best.home.abbr, name: best.home.name, logo: best.home.logo, form: best.home.form },
            away: { abbr: best.away.abbr, name: best.away.name, logo: best.away.logo, form: best.away.form },
            moneyline: best.markets ? best.markets.moneyline : null,
            pick: topPick ? { label: topPick.label, verdict: topPick.verdict, prob: topPick.prob, line_txt: topPick.line_txt } : null,
            /* el partido gratis completo (veredictos y distribución del
               margen), igual que mx-free */
            verdicts: best.verdicts || [],
            margin_dist: (best.markets && best.markets.margin_dist) || [],
          },
        };
      }
      _cache.set(leagueId, { at: Date.now(), value });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(value);
  } catch (e) {
    console.error('euro-free', leagueId + ':', e);
    return res.status(500).json({ error: 'Sin datos por ahora.' });
  }
};
