/* ============================================================
   Elección del partido DESTACADO de Liga MX (el pick gratis).

   Por defecto lo elige el modelo: el partido con más convicción
   (`strength`) entre los que no han empezado. El dueño puede fijar uno
   a mano cuando quiere destacar un juego taquillero aunque no sea el
   de mayor edge.

   Vive aquí y no en cada endpoint porque DOS lo necesitan y tienen que
   coincidir siempre: /api/mx-picks (la página del modelo) y
   /api/mx-free (la card del landing). Si se separan, el cliente ve un
   partido gratis en el home y otro distinto adentro.
   ============================================================ */

/* Overrides manuales, en orden de prioridad. Se buscan por NOMBRE de
   equipo (no por id, que cambia cada temporada) y solo entre los
   partidos elegibles de la ventana actual. Si el partido ya se jugó o
   salió de la ventana, no aplica y manda la regla automática — así el
   override se desactiva solo, sin tener que acordarse de quitarlo.
   El orden local/visitante no importa: se acepta en cualquiera. */
const OVERRIDES = [
  { home: 'Pumas', away: 'Necaxa' },
];

/* Elegibles: sin error y que no hayan empezado. Si ya todos empezaron,
   se permite cualquiera (misma regla que tenía featuredId). */
function elegibles(games) {
  const limpios = (games || []).filter(g => !g.error);
  const pre = limpios.filter(g => g.state === 'pre');
  return pre.length ? pre : limpios;
}

function porConviccion(pool) {
  return pool.reduce((a, b) => ((b.strength || 0) > (a.strength || 0) ? b : a));
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
  return porConviccion(pool);
}

/* Igual que featuredGame pero devuelve solo el id. */
function featuredId(games) {
  const g = featuredGame(games);
  return g ? g.id : null;
}

module.exports = { featuredGame, featuredId, OVERRIDES };
