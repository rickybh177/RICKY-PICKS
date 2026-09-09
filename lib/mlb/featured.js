/* ============================================================
   Elección del juego DESTACADO de MLB (el pick gratis del día).

   Por defecto lo elige lib/free-pick.js: seguridad + intriga, y sin
   regalar el partidazo (ver ahí el porqué). El dueño puede fijar uno a
   mano para una fecha con OVERRIDES.

   Vive aquí y no en cada endpoint porque DOS lo necesitan y tienen que
   coincidir siempre: /api/mlb-picks (la página del modelo) y
   /api/mlb-free (la card del landing). Si se separan, el cliente ve un
   partido gratis en el home y otro distinto adentro.
   ============================================================ */

const { elegir } = require('../free-pick');

/* Overrides manuales: fecha (YYYY-MM-DD, hora del Este) -> matchup.
   Se buscan por NOMBRE de equipo y no por gamePk para que sea legible
   y no dependa de un id que cambia cada día. Si ese día no existe el
   partido (se pospuso, se equivocó el nombre), no pasa nada: cae solo
   a la regla automática. Al pasar la fecha, el override se ignora. */
/* Vacío = manda la regla automática. (Se quitó el Padres–Mets del
   19-ago, ya vencido.) */
const OVERRIDES = {};

/* Elegibles para el pick gratis, por orden de preferencia:
   1) los que NO han empezado (Preview) — el único caso en que el
      pick sirve: todavía se puede tomar la línea;
   2) los que están en curso;
   3) cualquiera, como último recurso.
   Un pick de un partido ya jugado no es un pick: es un resultado. */
function sinEmpezar(games) {
  return (games || []).filter(g => !g.error && g.abstract_state === 'Preview');
}
function elegibles(games) {
  const previos = sinEmpezar(games);
  if (previos.length) return previos;
  const vivos = (games || []).filter(g => !g.error && g.abstract_state !== 'Final');
  return vivos.length ? vivos : (games || []).filter(g => !g.error);
}

/* Antes: el del pick con más `strength` — o sea el juego más cantado
   del día. Ahora manda la regla compartida. */
function porAtractivo(pool) {
  return elegir(pool, g => ({
    liga: 'mlb', home: g.home.name, away: g.away.name, verdicts: g.verdicts,
  }));
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
  return porAtractivo(pool);
}

/* Igual que featuredGame pero devuelve solo el gamePk. */
function featuredPk(games, date) {
  const g = featuredGame(games, date);
  return g ? g.gamePk : null;
}

/* ---- día activo: nunca quedarse en una jornada ya jugada ----
   La cartelera de MLB arranca temprano y termina cerca de
   medianoche ET, pero la fecha ET no cambia hasta las 00:00. En esa
   ventana ya no queda nada por empezar y el pick gratis del landing
   se quedaba horas mostrando un partido ya jugado — y perdido
   (reportado por el dueño el 28-ago-2026).

   Regla: si NINGÚN juego del día está por empezar, se pasa al día
   siguiente. Lo usan /api/mlb-free y /api/mlb-picks para que el
   landing y la página del modelo coincidan siempre; en /mlb.html el
   suscriptor puede regresar con la flecha ‹ del selector de día. */
function nextDate(dateISO) {
  const d = new Date(dateISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function activeDay(buildDay, dateISO) {
  const day = await buildDay(dateISO);
  if (sinEmpezar(day.games).length) return { date: dateISO, day };
  const manana = nextDate(dateISO);
  try {
    const sig = await buildDay(manana);
    if (sinEmpezar(sig.games).length) return { date: manana, day: sig };
  } catch (e) { /* sin cartelera mañana: nos quedamos con hoy */ }
  return { date: dateISO, day };
}

module.exports = { featuredGame, featuredPk, activeDay, nextDate, OVERRIDES };
