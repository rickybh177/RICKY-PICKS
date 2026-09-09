/* ============================================================
   Elección del partido DESTACADO de cada liga europea (el pick
   gratis), con la misma regla que Liga MX y la persistencia de NFL.

   Por defecto lo elige lib/free-pick.js: seguridad + intriga, y sin
   regalar el partidazo — un Madrid–Barça es justo por lo que se paga
   (ver el porqué en ese archivo). Solo entre los que no han empezado. Se CLAVA en el bucket de Supabase Storage
   (kvGet/kvPut) para que no baile entre corridas: sin esto, cuando
   los momios de un partido desaparecen (ya arrancó) el destacado
   saltaría a otro y se regalaría un segundo pick.

   Estados (misma máquina que api/nfl-picks.js):
   - por empezar: puede re-elegirse si aparece uno mejor;
   - EN JUEGO: congelado (el usuario está siguiendo ese partido);
   - TERMINADO: pasa al siguiente por empezar de la jornada; si ya
     no queda ninguno, se conserva (la jornada acabó y la página
     avisa "ya se jugó").

   LLAVE DEL KV: una sola por liga + temporada. NFL usa la semana
   en la llave porque la semana es un dato real del API; aquí la
   jornada del tablero se ESTIMA (mediana de juegos por equipo + 1,
   lib/euro/model.js) y cambia a media ronda — con 18 equipos salta
   en cuanto se juegan 5 de 9 partidos. Con la jornada en la llave,
   ese salto dejaba el KV "vacío" justo con el destacado EN JUEGO y
   se elegía otro entre los que faltaban: segundo pick gratis en la
   misma ronda, exactamente lo que el clavado debía evitar. Con una
   llave estable el relevo entre rondas lo hace la máquina de
   estados (terminado + hay uno por empezar → el siguiente), que es
   lo que ya hacía dentro de la ronda.

   Vive aquí y no en cada endpoint porque DOS lo necesitan y tienen
   que coincidir siempre: /api/euro-picks (la página) y
   /api/euro-free (la card del landing y de producto.html).
   ============================================================ */

const { LEAGUES } = require('./leagues');
const { kvGet, kvPut } = require('../odds/theoddsapi');
const { elegir, puntaje } = require('../free-pick');

/* Overrides manuales, en orden de prioridad — misma semántica que
   lib/mx/featured.js: se buscan por NOMBRE de equipo (el que muestra
   la página) y solo entre los elegibles de la ventana actual; si el
   partido ya se jugó o salió de la ventana, no aplica y manda la
   regla automática. Cada entrada lleva la liga.
   Ejemplo: { league: 'epl', home: 'Liverpool', away: 'Man United' } */
const OVERRIDES = [];

/* Elegibles: sin error y que no hayan empezado. Si ya todos
   empezaron, se permite cualquiera. */
function elegibles(games) {
  const limpios = (games || []).filter(g => !g.error);
  const pre = limpios.filter(g => g.state === 'pre');
  return pre.length ? pre : limpios;
}

/* Antes: `strength * 10 + mejor prob`, o sea el partido más obvio.
   Ahora manda la regla compartida (seguridad + intriga, partidazo al
   fondo). `score` se conserva con el mismo nombre porque abajo se
   compara contra el partido ya clavado en el KV. */
function score(g, leagueId) {
  return puntaje({ liga: leagueId, home: g.home.name, away: g.away.name, verdicts: g.verdicts });
}
function porAtractivo(leagueId, pool) {
  return elegir(pool, g => ({
    liga: leagueId, home: g.home.name, away: g.away.name, verdicts: g.verdicts,
  }));
}

function forzado(leagueId, pool) {
  const norm = s => String(s || '').trim().toLowerCase();
  for (const ov of OVERRIDES) {
    if (ov.league && ov.league !== leagueId) continue;
    const hit = pool.find(g =>
      (norm(g.home.name) === norm(ov.home) && norm(g.away.name) === norm(ov.away)) ||
      (norm(g.home.name) === norm(ov.away) && norm(g.away.name) === norm(ov.home))
    );
    if (hit) return hit;
  }
  return null;
}

/* Llave del clavado: liga + temporada, SIN jornada (ver arriba). */
function kvKeyOf(leagueId) {
  const cfg = LEAGUES[leagueId];
  return `euro-free-${leagueId}-${cfg ? cfg.seasonLabel : 'x'}`;
}

/* Devuelve el partido destacado (objeto) o null si no hay.
   jornada = la del tablero (bd.jornada); los endpoints la siguen
   pasando pero NO entra en la llave (cambia a media ronda). Se
   guarda junto al id solo como diagnóstico. */
async function featuredGame(leagueId, games, jornada) {
  const limpios = (games || []).filter(g => !g.error);
  if (!limpios.length) return null;

  const kvKey = kvKeyOf(leagueId);
  const saved = await kvGet(kvKey);
  const savedGame = saved && saved.id ? limpios.find(g => g.id === saved.id) : null;

  // en juego: congelado (aunque sus momios ya hayan desaparecido)
  if (savedGame && savedGame.state === 'in') return savedGame;

  const pool = elegibles(limpios);
  const anyPre = pool.some(g => g.state === 'pre');
  // terminado y sin nada por empezar: la jornada acabó, se conserva
  if (savedGame && savedGame.state === 'post' && !anyPre) return savedGame;

  let best = forzado(leagueId, pool);
  if (!best) {
    best = porAtractivo(leagueId, pool);
    // el clavado sigue vigente y no hay uno estrictamente mejor: se queda
    if (savedGame && pool.includes(savedGame) && score(savedGame, leagueId) >= score(best, leagueId)) best = savedGame;
  }
  if (best && (!savedGame || savedGame.id !== best.id)) {
    await kvPut(kvKey, { id: best.id, date: best.date || null, jornada: jornada || null, at: new Date().toISOString() });
  }
  return best || savedGame || null;
}

/* Igual que featuredGame pero devuelve solo el id. */
async function featuredId(leagueId, games, jornada) {
  const g = await featuredGame(leagueId, games, jornada);
  return g ? g.id : null;
}

module.exports = { featuredGame, featuredId, OVERRIDES };
