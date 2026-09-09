/* ============================================================
   Elección del partido DESTACADO de Liga MX (el pick gratis).

   Por defecto lo elige lib/free-pick.js: seguridad + intriga, y sin
   regalar el partidazo (ver ahí el porqué). El dueño puede fijar uno a
   mano con OVERRIDES cuando quiera saltarse la regla.

   Vive aquí y no en cada endpoint porque DOS lo necesitan y tienen que
   coincidir siempre: /api/mx-picks (la página del modelo) y
   /api/mx-free (la card del landing). Si se separan, el cliente ve un
   partido gratis en el home y otro distinto adentro.
   ============================================================ */

const { elegir } = require('../free-pick');

/* Overrides manuales, en orden de prioridad. Se buscan por NOMBRE de
   equipo (no por id, que cambia cada temporada) y solo entre los
   partidos elegibles de la ventana actual. Si el partido ya se jugó o
   salió de la ventana, no aplica y manda la regla automática — así el
   override se desactiva solo, sin tener que acordarse de quitarlo.
   El orden local/visitante no importa: se acepta en cualquiera. */
/* Vacío = manda la regla automática. (Se quitó el Pumas–Necaxa del
   28-ago: era un override para destacar un taquillero, justo lo
   contrario de la regla nueva.) */
const OVERRIDES = [];

/* Elegibles: sin error y que no hayan empezado. Si ya todos empezaron,
   se permite cualquiera (misma regla que tenía featuredId). */
function elegibles(games) {
  const limpios = (games || []).filter(g => !g.error);
  const pre = limpios.filter(g => g.state === 'pre');
  return pre.length ? pre : limpios;
}

/* Antes: el de mayor `strength`, o sea el BET más probable — el
   partido MÁS OBVIO de la jornada. Ahora manda la regla compartida. */
function porAtractivo(pool) {
  return elegir(pool, g => ({
    liga: 'mx', home: g.home.name, away: g.away.name, verdicts: g.verdicts,
  }));
}

/* Devuelve el partido destacado (objeto), o null si no hay. */
function featuredGame(games) {
  const pool = elegibles(games);
  if (!pool.length) return null;

  const norm = s => String(s || '').trim().toLowerCase();
  for (const ov of OVERRIDES) {
    const forzado = pool.find(g =>
      (norm(g.home.name) === norm(ov.home) && norm(g.away.name) === norm(ov.away)) ||
      (norm(g.home.name) === norm(ov.away) && norm(g.away.name) === norm(ov.home))
    );
    if (forzado) return forzado;
  }
  return porAtractivo(pool);
}

/* Igual que featuredGame pero devuelve solo el id. */
function featuredId(games) {
  const g = featuredGame(games);
  return g ? g.id : null;
}

module.exports = { featuredGame, featuredId, OVERRIDES };
