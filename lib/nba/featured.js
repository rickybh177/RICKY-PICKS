/* ============================================================
   Elección del juego DESTACADO de NBA (el pick gratis del día).

   Por defecto lo elige lib/free-pick.js: seguridad + intriga (banda
   58-86%), y sin regalar el partidazo (Lakers–Celtics es por lo que la
   gente paga). El dueño puede fijar uno a mano con OVERRIDES.

   Se CLAVA en el KV por día (hora CDMX) para que no baile entre
   corridas: cuando los momios de un juego desaparecen (ya arrancó) el
   destacado saltaría a otro y se regalaría un segundo pick. Máquina de
   estados igual que NFL: por empezar → puede re-elegirse si aparece uno
   mejor; en juego → congelado; terminado → pasa al siguiente por
   empezar del día; si no queda ninguno, se conserva.

   Como el post de Instagram sale un día ANTES del partido, el
   destacado se elige entre los juegos de MAÑANA cuando los hay (hoy
   y mañana viven en la misma cartelera): así el pick que ve el landing
   es el mismo que se publica.
   ============================================================ */
const { elegir, veredictoDeCard } = require('../free-pick');
const { kvGet, kvPut } = require('../odds/theoddsapi');

/* Overrides manuales, mismo formato que NFL / Liga MX / Europa:
     home / away  el matchup (el orden no importa, por nombre visible)
     team         alternativa: el próximo juego de ese equipo
     mercado      OPCIONAL: qué veredicto enseña la card, por texto
                  dentro del label.
   Vacío = manda la regla automática (lib/free-pick.js). */
const OVERRIDES = [];

const norm = s => String(s || '').trim().toLowerCase();
function coincide(g, ov) {
  if (!g || !g.home || !g.away) return false;
  if (ov.team) return norm(g.home.name) === norm(ov.team) || norm(g.away.name) === norm(ov.team);
  return (norm(g.home.name) === norm(ov.home) && norm(g.away.name) === norm(ov.away)) ||
         (norm(g.home.name) === norm(ov.away) && norm(g.away.name) === norm(ov.home));
}
function forzado(pool) {
  for (const ov of OVERRIDES) { const hit = (pool || []).find(g => coincide(g, ov)); if (hit) return hit; }
  return null;
}
function overrideDe(g) { return OVERRIDES.find(ov => coincide(g, ov)) || null; }

function pickDeCard(g) {
  if (!g) return null;
  const ov = overrideDe(g);
  const v = veredictoDeCard(g.verdicts, ov && ov.mercado);
  return v ? { verdict: v.verdict, label: v.label, prob: v.prob, line_txt: v.line_txt } : null;
}

const normaliza = g => ({ liga: 'nba', home: g.home.name, away: g.away.name, verdicts: g.verdicts });
function pickBest(list) {
  if (!list || !list.length) return null;
  const g = forzado(list) || elegir(list, normaliza);
  return g ? g.id : null;
}

/* Destacado de la cartelera (hoy + mañana), con clavado en el KV.
   `days` = los días CDMX de la cartelera; la llave es el ÚLTIMO día
   (el de mañana): es el que se publica. */
async function featuredId(board) {
  const games = (board.games || []).filter(g => !g.error);
  if (!games.length) return null;
  const target = board.days[board.days.length - 1];
  const kvKey = `nba-free-${target}`;
  const saved = await kvGet(kvKey);
  const savedGame = saved && saved.id ? games.find(g => g.id === saved.id) : null;
  const fijado = forzado(games.filter(g => g.state !== 'post'));
  if (fijado) { if (!savedGame || savedGame.id !== fijado.id) await kvPut(kvKey, { id: fijado.id }); return fijado.id; }
  if (savedGame && savedGame.state === 'in') return savedGame.id;
  // preferir los de mañana (lo que se publica); si no hay, los de hoy por empezar
  let pool = games.filter(g => g.state === 'pre' && g.day_mx === target);
  if (!pool.length) pool = games.filter(g => g.state === 'pre');
  if (savedGame && savedGame.state === 'post' && !pool.length) return savedGame.id;
  if (savedGame && savedGame.state === 'pre' && pool.some(g => g.id === savedGame.id)) {
    /* ya hay uno clavado por empezar: se respeta salvo que el pool traiga
       uno claramente mejor (mismo criterio que NFL: no re-elegir sin motivo) */
    const { puntaje } = require('../free-pick');
    const best = pickBest(pool);
    const bestG = pool.find(g => g.id === best);
    if (!bestG || puntaje(normaliza(bestG)) <= puntaje(normaliza(savedGame)) + 0.3) return savedGame.id;
  }
  const id = pickBest(pool.length ? pool : games);
  if (id && (!savedGame || savedGame.id !== id)) await kvPut(kvKey, { id });
  return id || (savedGame ? savedGame.id : null);
}

module.exports = { featuredId, pickBest, forzado, overrideDe, pickDeCard, OVERRIDES };
