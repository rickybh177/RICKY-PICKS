/* ============================================================
   NHL — núcleo del modelo de equipo, SIN dependencias de priors ni
   de red: la misma aritmética la usan el runtime (lib/nhl/model.js)
   y el backtest (scripts/nhl-backtest.js), así la validación es
   exactamente lo que corre en producción (receta de lib/nba/core.js
   y lib/euro/core.js).

   Expectativa de un juego: goles en TIEMPO REGLAMENTARIO y SIN contar
   los goles a puerta vacía (esos los agrega el motor, lib/nhl/engine.js,
   porque dependen del marcador y no de la calidad del equipo):
     λ_local  = exp(mu + muShift + hfa/2 + att[h] − def[a] + adj_h)
     λ_visita = exp(mu + muShift − hfa/2 + att[a] − def[h] + adj_a)
   att = ataque (log, vs promedio); def = defensa (positivo = concede
   menos). adj = ajustes conocidos antes del juego: segundo juego en
   dos noches y el PORTERO que sale (su nivel contra la mezcla de
   porteros con la que el equipo ganó su rating defensivo).

   Aprendizaje en línea (estilo Elo sobre goles, gradiente Poisson):
   cada resultado corrige att/def de los dos equipos con K × sorpresa
   (capada). La "sorpresa" no usa solo los goles: el porcentaje de
   tiro de un partido es casi puro ruido, así que el objetivo mezcla
   los goles reales con los goles "merecidos" por volumen de tiro
   (tiros × conversión de liga), con peso SHOTS_W fijado en el
   backtest. Más una corrección GLOBAL del entorno goleador (muShift,
   encogida con n/(n+MU_SHIFT_N)).
   ============================================================ */

const DEFAULTS = {
  K: 0.02,            // ritmo de aprendizaje de att/def (log por gol de sorpresa)
  CAP: 3,             // sorpresa máxima que se aprende por lado (goles)
  SHOTS_W: 0,         // peso de los goles "merecidos" por tiros en el objetivo (0 = goles puros)
  SHOT_KIND: 'sog',   // sog = tiros a puerta | fen = + fallados | cor = + bloqueados
  EN_OUT: 1,          // fracción de los goles a puerta vacía que se quita del objetivo
  MU_SHIFT_N: 150,    // encogimiento de la corrección de entorno (juegos)
  MU_SHIFT_CAP: 0.08, // tope (log)
  CONV_N0: 3000,      // tiros de anclaje de la conversión vigente (~50 juegos)
  REST: { b2b_att: 0, b2b_def: 0 }, // log: ataque propio / goles que concede, en segundo juego en dos noches
  G_C: 0,             // peso del ajuste por portero (0 = apagado)
  G_N0: 2000,         // tiros de encogimiento del nivel del portero (el % de atajadas es ruidosísimo)
  G_ALPHA: 0.08,      // memoria de la mezcla de porteros del equipo (EWMA por juego)
  G_CAP: 0.012,       // tope del diferencial de portero (goles evitados por tiro)
};
const MU_PSEUDO = 20;                 // pseudo-goles: los primeros juegos no mueven la liga entera
const LAM_MIN = 1.2, LAM_MAX = 5.5;   // tope de goles esperados por lado

/* ---- descanso ---- */
function restCategory(prevDates, kickoffISO) {
  if (!prevDates || !prevDates.length) return { cat: 'normal', days: null };
  const days = (new Date(kickoffISO).getTime() - prevDates[prevDates.length - 1]) / 86400000;
  if (days < 1.4) return { cat: 'b2b', days };
  return { cat: 'normal', days };
}
const REST_NOTE = { b2b: 'segundo juego en dos noches', normal: null };

/* ---- tiros de un lado según la definición elegida ---- */
function shotsOf(side, opp, kind) {
  if (!side || side.sog == null) return null;
  if (kind === 'fen') return side.miss != null ? side.sog + side.miss : null;
  if (kind === 'cor') return side.miss != null && opp && opp.blk != null ? side.sog + side.miss + opp.blk : null;
  return side.sog;
}
/* goles reglamentarios sin puerta vacía */
function cleanGoals(side, enOut) {
  const reg = side.reg != null ? side.reg : side.score;
  return reg - (enOut || 0) * (side.en || 0);
}
/* objetivo de aprendizaje de UN lado (misma fórmula en el fit) */
function targetOf(side, opp, L, P, convNow) {
  const goals = cleanGoals(side, P.EN_OUT);
  if (!P.SHOTS_W) return goals;
  const sh = shotsOf(side, opp, P.SHOT_KIND);
  const conv = convNow || (L.conv && L.conv[P.SHOT_KIND]);
  if (sh == null || !conv) return goals;
  return (1 - P.SHOTS_W) * goals + P.SHOTS_W * sh * conv;
}

/* ---- porteros ----
   G: { id: { sa, gsa } } tiros recibidos y goles evitados sobre el
   promedio de liga acumulados; nivel q = gsa / (sa + N0) (goles
   evitados por tiro, encogido). teamRef[abbr] = promedio móvil del q
   de quien ha salido por ese equipo: el rating defensivo del equipo
   ya trae a "su portero de siempre", así que solo cuenta la DIFERENCIA. */
function goalieQ(G, id, P) {
  const g = id != null ? G[String(id)] : null;
  return g ? g.gsa / (g.sa + P.G_N0) : 0;
}
function goalieDelta(G, teamRef, team, id, P) {
  if (!P.G_C || id == null) return 0;
  const d = goalieQ(G, id, P) - (teamRef[team] || 0);
  return Math.max(-P.G_CAP, Math.min(P.G_CAP, d));
}
function goalieLearn(G, teamRef, team, gl, L, P) {
  if (!gl || gl.id == null || !gl.sa) return;
  const id = String(gl.id);
  const q = goalieQ(G, id, P); // nivel ANTES de este juego
  teamRef[team] = (teamRef[team] || 0) * (1 - P.G_ALPHA) + q * P.G_ALPHA;
  const g = (G[id] = G[id] || { sa: 0, gsa: 0 });
  g.sa += gl.sa; g.gsa += L.conv.sog * gl.sa - gl.ga;
}

/* Expectativa de un juego dados ratings vigentes y ajustes.
   ctx: { muShift, b2bHome, b2bAway, gdHome, gdAway } (gd = diferencial
   del portero de ese equipo: positivo = mejor que lo habitual). */
function expectation(R, g, L, ctx, params) {
  const rh = R[g.home.abbr], ra = R[g.away.abbr];
  if (!rh || !ra) return null;
  const P = params || DEFAULTS;
  const REST = P.REST || DEFAULTS.REST;
  const hfaHalf = g.neutral ? 0 : L.hfa / 2;
  const conv = (L.conv && L.conv.sog) || 0.1;
  const gc = P.G_C || 0;
  const adjH = (ctx.b2bHome ? REST.b2b_att : 0) + (ctx.b2bAway ? REST.b2b_def : 0) - gc * (ctx.gdAway || 0) / conv;
  const adjA = (ctx.b2bAway ? REST.b2b_att : 0) + (ctx.b2bHome ? REST.b2b_def : 0) - gc * (ctx.gdHome || 0) / conv;
  const base = L.mu + (ctx.muShift || 0);
  const lh = Math.min(LAM_MAX, Math.max(LAM_MIN, Math.exp(base + hfaHalf + rh.att - ra.def + adjH)));
  const la = Math.min(LAM_MAX, Math.max(LAM_MIN, Math.exp(base - hfaHalf + ra.att - rh.def + adjA)));
  return { lh, la };
}

/* results: juegos TERMINADOS [{id, date, neutral, home:{abbr, reg, en,
   sog, miss, blk, goalie:{id, sa, ga}}, away:{…}}]
   opts: { priors, league:{mu, hfa, conv}, params, goalies (tabla
   inicial), teamRef (inicial) }
   onPredict(g, exp, ctx) se llama ANTES de aprender el resultado
   (walk-forward honesto). En el recorrido el portero es el que jugó
   (del boxscore); en vivo el modelo usa el probable de ESPN.
   Devuelve { R, muShift, gamesLearned, prevDates, G, teamRef } */
function learnRatings(results, opts, onPredict) {
  const { priors, league } = opts;
  const P = Object.assign({}, DEFAULTS, opts.params || {});
  if (!P.REST) P.REST = DEFAULTS.REST;
  const R = {};
  for (const ab in priors) R[ab] = { att: priors[ab].att, def: priors[ab].def };
  const G = {};
  for (const id in (opts.goalies || {})) G[id] = { sa: opts.goalies[id].sa, gsa: opts.goalies[id].gsa };
  const teamRef = Object.assign({}, opts.teamRef || {});
  const sorted = [...results].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)));
  const prevDates = {};
  let obs = 0, pred = 0, n = 0, muShift = 0;
  /* conversión de liga VIGENTE: los tiros por juego cambian de una
     temporada a otra (31 → 28 en tres años) mientras los goles no, así
     que la conversión histórica deja los goles "merecidos" sesgados; se
     re-estima con lo que va de la temporada, anclada a la histórica con
     CONV_N0 tiros. */
  const conv0 = (league.conv && league.conv[P.SHOT_KIND]) || null;
  let cG = 0, cS = 0, convNow = conv0;
  for (const g of sorted) {
    const h = g.home.abbr, a = g.away.abbr;
    if (!R[h] || !R[a]) continue;
    const rcH = restCategory(prevDates[h], g.date), rcA = restCategory(prevDates[a], g.date);
    const ctx = {
      muShift,
      b2bHome: rcH.cat === 'b2b', b2bAway: rcA.cat === 'b2b',
      gdHome: goalieDelta(G, teamRef, h, g.home.goalie && g.home.goalie.id, P),
      gdAway: goalieDelta(G, teamRef, a, g.away.goalie && g.away.goalie.id, P),
    };
    const e = expectation(R, g, league, ctx, P);
    if (onPredict) onPredict(g, e, ctx);
    // ---- aprender ----
    obs += cleanGoals(g.home, P.EN_OUT) + cleanGoals(g.away, P.EN_OUT); pred += e.lh + e.la; n++;
    muShift = Math.max(-P.MU_SHIFT_CAP, Math.min(P.MU_SHIFT_CAP, Math.log((obs + MU_PSEUDO) / (pred + MU_PSEUDO)) * (n / (n + P.MU_SHIFT_N))));
    const dH = Math.max(-P.CAP, Math.min(P.CAP, targetOf(g.home, g.away, league, P, convNow) - e.lh));
    const dA = Math.max(-P.CAP, Math.min(P.CAP, targetOf(g.away, g.home, league, P, convNow) - e.la));
    if (conv0) {
      const sh = shotsOf(g.home, g.away, P.SHOT_KIND), sa = shotsOf(g.away, g.home, P.SHOT_KIND);
      if (sh != null && sa != null) { cS += sh + sa; cG += cleanGoals(g.home, 1) + cleanGoals(g.away, 1); convNow = (cG + conv0 * P.CONV_N0) / (cS + P.CONV_N0); }
    }
    R[h].att += P.K * dH; R[a].def -= P.K * dH;
    R[a].att += P.K * dA; R[h].def -= P.K * dA;
    goalieLearn(G, teamRef, h, g.home.goalie, league, P);
    goalieLearn(G, teamRef, a, g.away.goalie, league, P);
    const t = new Date(g.date).getTime();
    for (const ab of [h, a]) { (prevDates[ab] = prevDates[ab] || []).push(t); if (prevDates[ab].length > 3) prevDates[ab].shift(); }
  }
  return { R, muShift: +muShift.toFixed(4), gamesLearned: n, prevDates, G, teamRef, conv: convNow };
}

/* Tabla de porteros al arranque de una temporada: acumulado de las
   temporadas previas con decaimiento entre temporadas (un portero de
   hace dos años cuenta menos). Solo scripts. */
function goalieTable(games, L, { seasonDecay = 0.6, params } = {}) {
  const P = Object.assign({}, DEFAULTS, params || {});
  const G = {}, teamRef = {};
  let lastSeason = null;
  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const g of sorted) {
    if (lastSeason != null && g.season !== lastSeason) for (const id in G) { G[id].sa *= seasonDecay; G[id].gsa *= seasonDecay; }
    lastSeason = g.season;
    goalieLearn(G, teamRef, g.home.abbr, g.home.goalie, L, P);
    goalieLearn(G, teamRef, g.away.abbr, g.away.goalie, L, P);
  }
  for (const id in G) { G[id].sa *= seasonDecay; G[id].gsa *= seasonDecay; }
  return { G, teamRef };
}

module.exports = { DEFAULTS, LAM_MIN, LAM_MAX, restCategory, REST_NOTE, shotsOf, cleanGoals, targetOf, goalieQ, goalieDelta, goalieLearn, expectation, learnRatings, goalieTable };
