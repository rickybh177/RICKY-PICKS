/* ============================================================
   GET /api/euro-picks?liga=epl|laliga|bundesliga[&refresh=1][&as=guest]
   Modelos de Europa — corre el modelo de UNA liga en el servidor y
   devuelve SOLO probabilidades/veredictos. Mismo esquema freemium
   con paywall server-side que /api/mx-picks, con dos diferencias:

   - El producto es la liga (`epl`, `laliga`, `bundesliga`): cada
     una tiene su entitlement propio (o llega vía todo_*,
     que otorgan las tres).
   - BETA PRIVADA: mientras una liga no esté en PUBLIC_LEAGUES,
     cualquier caller que no sea admin (con o sin sesión) recibe
     403 { error, beta: true } y la página muestra "Beta privada".
     Al abrirla al público se agrega la liga al Set y queda en
     freemium como Liga MX: el partido DESTACADO va completo (es el
     pick gratis) y el resto llega SIN veredictos, sin mercados y sin
     análisis (locked: true). El candado es real: los datos nunca
     salen del servidor, el blur del frontend es solo cosmético.

   Dev local (sin VERCEL): acceso completo. `?as=guest` simula al
   invitado con la liga ya pública (para probar el candado por
   partido); `?as=beta` simula al público con la liga privada (403).
   ============================================================ */
const { buildBoard } = require('../lib/euro/model');
const { featuredId } = require('../lib/euro/featured');
const { leagueOf } = require('../lib/euro/leagues');
const { getUserFromToken, getEntitlement } = require('../lib/supabaseAdmin');
const { entitlementGrants } = require('../lib/plans');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

/* Ligas abiertas al público (freemium). Vacío = todas en beta privada. */
const PUBLIC_LEAGUES = new Set([]);

const _cache = new Map(); // leagueId -> { at, value }
const TTL = 5 * 60 * 1000;

/* Versión censurada de un partido para invitados: se queda lo que ya
   es público (equipos, hora, sede, marcador) y se va TODO lo que
   produce el modelo. */
function lockGame(g) {
  return {
    id: g.id,
    date: g.date,
    venue: g.venue,
    venue_city: g.venue_city,
    home: g.home,
    away: g.away,
    state: g.state,
    detail: g.detail,
    score: g.score,
    locked: true,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const cfg = leagueOf(req.query && req.query.liga);
  if (!cfg || !cfg.enabled) return res.status(400).json({ error: 'Liga no válida.' });
  const leagueId = cfg.id;

  // ---- nivel de acceso ----
  const simulate = IS_DEV && req.query && (req.query.as === 'guest' || req.query.as === 'beta') ? req.query.as : null;
  let isAdmin = false;
  let access = 'guest';
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token && !simulate) {
    const user = await getUserFromToken(token);
    if (user) {
      if (ADMIN_EMAILS.includes(user.email)) { isAdmin = true; access = 'full'; }
      else {
        const ent = await getEntitlement(user.id, user.email, leagueId);
        if (entitlementGrants(ent, leagueId)) access = 'full';
      }
    }
  }
  // dev local: admin (acceso completo), salvo que se pida simular
  if (IS_DEV && !simulate) { isAdmin = true; access = 'full'; }

  // ---- beta privada: solo admin mientras la liga no sea pública ----
  const isPublic = PUBLIC_LEAGUES.has(leagueId) || simulate === 'guest';
  if (!isPublic && !isAdmin) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Modelo en beta privada.', beta: true, league_id: leagueId, league_name: cfg.name });
  }

  const refresh = req.query && req.query.refresh === '1' && access === 'full';

  try {
    const hit = _cache.get(leagueId);
    let value;
    if (!refresh && hit && Date.now() - hit.at < TTL) {
      value = hit.value;
    } else {
      value = await buildBoard(leagueId);
      value.featured_id = await featuredId(leagueId, value.games || [], value.jornada);
      _cache.set(leagueId, { at: Date.now(), value });
    }

    res.setHeader('Cache-Control', 'no-store');
    if (access === 'full') {
      return res.status(200).json({ ...value, access: 'full' });
    }
    // invitado: destacado completo, el resto bloqueado
    const games = (value.games || []).map(g =>
      (g.error || g.id === value.featured_id) ? g : lockGame(g));
    return res.status(200).json({
      tournament: value.tournament,
      league_id: value.league_id,
      league_name: value.league_name,
      league_flag: value.league_flag,
      season_label: value.season_label,
      rounds: value.rounds,
      jornada: value.jornada,
      method: value.method,
      games_learned: value.games_learned,
      odds_source: value.odds_source,
      league: value.league,
      ev_params: value.ev_params,
      featured_id: value.featured_id,
      access: 'guest',
      locked_count: games.filter(g => g.locked).length,
      games,
    });
  } catch (e) {
    console.error('euro-picks', leagueId + ':', e);
    return res.status(500).json({ error: `Error al correr el modelo ${cfg.name}.` });
  }
};
