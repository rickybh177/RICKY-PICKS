/* ============================================================
   Elección del juego DESTACADO de NFL (el pick gratis de la semana).

   Por defecto lo elige lib/free-pick.js: seguridad + intriga, y sin
   regalar el partidazo (ver ahí el porqué). El dueño puede fijar uno
   a mano con OVERRIDES.

   Vive aquí —y no suelto dentro de api/nfl-picks.js— para que los
   overrides de los cuatro modelos estén en el mismo lugar: cuando hay
   que quitarlos, se quitan de un solo jalón. El clavado en el KV (que
   el destacado no brinque a media semana) se queda en el endpoint,
   que es quien tiene la máquina de estados de la semana.
   ============================================================ */

const { elegir, puntaje, veredictoDeCard } = require('../free-pick');

/* Overrides manuales, mismo formato que Liga MX y Europa:
     home / away  el matchup (el orden no importa)
     team         alternativa: el próximo juego de ese equipo
     mercado      OPCIONAL: qué veredicto enseña la card, por texto
                  dentro del label. Si no existe, cae al normal.

   TEMPORAL (9-sep-2026): fijado a mano para una campaña de publicidad
   del dueño. Se salta a propósito la regla de "no regalar el
   partidazo". QUITAR cuando termine la campaña. */
const OVERRIDES = [
  { home: 'Steelers', away: 'Falcons', mercado: 'Más de 42 puntos' },
];

const norm = s => String(s || '').trim().toLowerCase();

function coincide(g, ov) {
  if (!g || !g.home || !g.away) return false;
  if (ov.team) return norm(g.home.name) === norm(ov.team) || norm(g.away.name) === norm(ov.team);
  return (norm(g.home.name) === norm(ov.home) && norm(g.away.name) === norm(ov.away)) ||
         (norm(g.home.name) === norm(ov.away) && norm(g.away.name) === norm(ov.home));
}

/* El juego fijado a mano dentro de esta lista, o null. */
function forzado(pool) {
  for (const ov of OVERRIDES) {
    const hit = (pool || []).find(g => coincide(g, ov));
    if (hit) return hit;
  }
  return null;
}

/* ¿Este juego está fijado a mano? Devuelve el override (con su
   `mercado`) o null. */
function overrideDe(g) {
  return OVERRIDES.find(ov => coincide(g, ov)) || null;
}

/* El veredicto que debe enseñar la card de este juego: el que fija el
   override si existe, o el que manda por rango y probabilidad. */
function pickDeCard(g) {
  if (!g) return null;
  const ov = overrideDe(g);
  const v = veredictoDeCard(g.verdicts, ov && ov.mercado);
  return v ? { verdict: v.verdict, label: v.label, prob: v.prob } : null;
}

/* El destacado de una lista: manda el override; si no, la regla
   compartida (seguridad + intriga). Devuelve el id. */
function pickBest(list) {
  if (!list || !list.length) return null;
  const g = forzado(list) || elegir(list, x => ({
    liga: 'nfl', home: x.home.name, away: x.away.name, verdicts: x.verdicts,
  }));
  return g ? g.id : null;
}

/* Puntaje suelto (lo usa el endpoint para comparar contra el clavado). */
function score(g) {
  return puntaje({ liga: 'nfl', home: g.home.name, away: g.away.name, verdicts: g.verdicts });
}

module.exports = { pickBest, forzado, overrideDe, pickDeCard, score, OVERRIDES };
