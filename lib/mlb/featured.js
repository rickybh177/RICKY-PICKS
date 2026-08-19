/* ============================================================
   Elección del juego DESTACADO de MLB (el pick gratis del día).

   Por defecto lo elige el modelo: el juego cuyo mejor pick tiene más
   convicción (`strength`). Pero el dueño puede fijar uno a mano para
   una fecha — p. ej. para destacar un partido taquillero aunque no sea
   el de mayor edge.

   Vive aquí y no en cada endpoint porque DOS lo necesitan y tienen que
   coincidir siempre: /api/mlb-picks (la página del modelo) y
   /api/mlb-free (la card del landing). Si se separan, el cliente ve un
   partido gratis en el home y otro distinto adentro.
   ============================================================ */

/* Overrides manuales: fecha (YYYY-MM-DD, hora del Este) -> matchup.
   Se buscan por NOMBRE de equipo y no por gamePk para que sea legible
   y no dependa de un id que cambia cada día. Si ese día no existe el
   partido (se pospuso, se equivocó el nombre), no pasa nada: cae solo
   a la regla automática. Al pasar la fecha, el override se ignora. */
const OVERRIDES = {
  '2026-08-19': { away: 'Padres', home: 'Mets' },
};

/* Los juegos elegibles: sin error y que no hayan terminado. Si ya
   todos terminaron, se permiten los finalizados como último recurso. */
function elegibles(games) {
  const vivos = (games || []).filter(g => !g.error && g.abstract_state !== 'Final');
  return vivos.length ? vivos : (games || []).filter(g => !g.error);
}

/* El juego que el modelo destacaría por sí solo. */
function porConviccion(pool) {
  return pool.reduce((a, b) => {
    const sa = (a.picks && a.picks[0] && a.picks[0].strength) || 0;
    const sb = (b.picks && b.picks[0] && b.picks[0].strength) || 0;
    return sb > sa ? b : a;
  });
}

/* Devuelve el juego destacado del día (objeto), o null si no hay. */
function featuredGame(games, date) {
  const pool = elegibles(games);
  if (!pool.length) return null;

  const ov = OVERRIDES[date];
  if (ov) {
    const norm = s => String(s || '').toLowerCase();
    const forzado = pool.find(g =>
      (norm(g.away.name) === norm(ov.away) && norm(g.home.name) === norm(ov.home)) ||
      // por si se anotó al revés local/visita
      (norm(g.away.name) === norm(ov.home) && norm(g.home.name) === norm(ov.away))
    );
    if (forzado) return forzado;
    console.warn('featured: override de', date, JSON.stringify(ov), 'no encontrado en la cartelera; se usa la regla automática');
  }
  return porConviccion(pool);
}

/* Igual que featuredGame pero devuelve solo el gamePk. */
function featuredPk(games, date) {
  const g = featuredGame(games, date);
  return g ? g.gamePk : null;
}

module.exports = { featuredGame, featuredPk, OVERRIDES };
