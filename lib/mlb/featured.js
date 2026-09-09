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

/* Overrides manuales, en el mismo formato que Liga MX y Europa.
   Se buscan por NOMBRE de equipo (no por gamePk, que cambia cada día).
   Campos:
     home / away  el matchup (el orden no importa)
     date         OPCIONAL (YYYY-MM-DD, hora del Este). Sin fecha aplica
                  el día que se juegue — útil para una serie de varios
                  juegos seguidos.
     mercado      OPCIONAL: qué veredicto enseña la card, por texto
                  dentro del label. Si no existe, cae al normal.
   Si el partido no está en la cartelera, no pasa nada: manda la regla
   automática.

   Vacío = manda la regla automática (lib/free-pick.js). */
const OVERRIDES = [];

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

/* ¿El juego es el del override? El orden local/visita no importa. */
function coincide(g, ov) {
  const norm = s => String(s || '').trim().toLowerCase();
  return (norm(g.away.name) === norm(ov.away) && norm(g.home.name) === norm(ov.home)) ||
         (norm(g.away.name) === norm(ov.home) && norm(g.home.name) === norm(ov.away));
}

/* ¿Este juego está fijado a mano? Devuelve el override (con su
   `mercado`) o null — lo usa /api/mlb-free para la card. */
function overrideDe(g, date) {
  if (!g || !g.home || !g.away) return null;
  return OVERRIDES.find(ov => (!ov.date || ov.date === date) && coincide(g, ov)) || null;
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

  for (const ov of OVERRIDES) {
    if (ov.date && ov.date !== date) continue;
    const forzado = pool.find(g => coincide(g, ov));
    if (forzado) return forzado;
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

module.exports = { featuredGame, featuredPk, activeDay, nextDate, overrideDe, OVERRIDES };
