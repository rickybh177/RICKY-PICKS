/* ============================================================
   NBA — núcleo del modelo de equipo, SIN dependencias de priors ni
   de red: la misma aritmética la usan el runtime (lib/nba/model.js)
   y el backtest (scripts/nba-backtest.js), así la validación es
   exactamente lo que corre en producción.

   Expectativa de un juego:
     poss  = P + pace[h] + pace[a]
     ortgH = mu + muShift + hfa/2 + off[h] − def[a] + rest_h − c·abs_h/2 + c·abs_a/2
     ortgA = mu + muShift − hfa/2 + off[a] − def[h] + rest_a − c·abs_a/2 + c·abs_h/2
     E_h   = poss · ortgH / 100,  E_a = poss · ortgA / 100
   (abs = valor de los ausentes de cada equipo, mitad en su propio
   ataque y mitad en el del rival: el margen se mueve c·abs, el total
   casi no).

   Aprendizaje en línea (estilo Elo sobre eficiencia): cada resultado
   corrige off/def de los dos equipos con K × sorpresa (capada), el
   ritmo con KP, y una corrección GLOBAL del entorno anotador
   (muShift, encogida con n/(n+MU_SHIFT_N)) — receta validada en MX y
   NFL.
   ============================================================ */

const DEFAULTS = {
  K: 0.06,            // ritmo de aprendizaje de off/def (pts/100 por pts/100 de sorpresa)
  KP: 0.06,           // ritmo de aprendizaje del pace
  CAP: 25,            // sorpresa máxima que se aprende (pts/100)
  CAP_POSS: 12,       // sorpresa máxima de posesiones
  MU_SHIFT_N: 150,    // encogimiento de la corrección de entorno (~10 días de liga)
  MU_SHIFT_CAP: 3,    // pts/100 por equipo
  ABS_C: 0,           // peso del valor de los ausentes (lo fija el backtest)
  REST: { b2b_home: 0, b2b_away: 0, three_in_four: 0, rested: 0, long: 0 }, // pts/100
  ALT_HFA: 0,         // extra de localía en altura (DEN/UTAH), pts/100 de margen
  /* SUERTE EN TRIPLES: parte de la eficiencia de un juego es azar del
     tiro de 3 (sobre todo el del RIVAL: la defensa casi no controla el
     % de triples que le meten). Al aprender, la sorpresa se limpia de
     esa suerte: LUCK.off = fracción de la suerte propia que se
     descuenta, LUCK.def = la del rival. 0 = aprender de los puntos
     tal cual. Lo fija el backtest. */
  LUCK: { off: 0, def: 0 },
  LG_3P: 0.36,        // % de triples de liga (referencia de la suerte)
};

/* ---- descanso: categoría a partir de las fechas de los juegos previos ---- */
function restCategory(prevDates, kickoffISO) {
  if (!prevDates || !prevDates.length) return { cat: 'normal', days: null };
  const t = new Date(kickoffISO).getTime();
  const last = prevDates[prevDates.length - 1];
  const days = (t - last) / 86400000;
  if (days < 1.4) return { cat: 'b2b', days };
  // tercer juego en ~4 noches
  if (prevDates.length >= 2 && (t - prevDates[prevDates.length - 2]) / 86400000 < 3.4) return { cat: 'three_in_four', days };
  if (days >= 5.5) return { cat: 'long', days };
  if (days >= 2.6) return { cat: 'rested', days };
  return { cat: 'normal', days };
}
function restPts(cat, isHome, REST) {
  if (cat === 'b2b') return isHome ? REST.b2b_home : REST.b2b_away;
  return REST[cat] || 0;
}
const REST_NOTE = { b2b: 'segundo juego en dos noches', three_in_four: 'tercer juego en cuatro noches', rested: null, long: 'viene de descanso largo', normal: null };

/* Expectativa de un juego dados ratings vigentes y ajustes. */
function expectation(R, g, L, ctx, params) {
  const rh = R[g.home.abbr], ra = R[g.away.abbr];
  if (!rh || !ra) return null;
  const P = params || DEFAULTS;
  const hfaHalf = g.neutral ? 0 : L.hfa / 2;
  const alt = (!g.neutral && P.ALT_HFA && ctx.altHome) ? P.ALT_HFA / 2 : 0;
  const poss = Math.max(85, Math.min(115, L.poss + rh.pace + ra.pace));
  const c = P.ABS_C || 0;
  const absH = (ctx.absHome || 0) * c, absA = (ctx.absAway || 0) * c;
  const ortgH = L.mu + (ctx.muShift || 0) + hfaHalf + alt + rh.off - ra.def + (ctx.restHome || 0) - absH / 2 + absA / 2;
  const ortgA = L.mu + (ctx.muShift || 0) - hfaHalf - alt + ra.off - rh.def + (ctx.restAway || 0) - absA / 2 + absH / 2;
  return { poss, ortgH, ortgA, expH: poss * ortgH / 100, expA: poss * ortgA / 100 };
}

/* results: juegos TERMINADOS en orden cronológico
   [{id, date, neutral, home:{abbr,score,poss}, away:{…}}]
   opts: { priors, league:{mu,hfa,poss}, params, absences: (g, side) → value,
           altTeams: Set }
   onPredict(g, exp, ctx) se llama ANTES de aprender el resultado
   (walk-forward honesto). Devuelve { R, muShift, gamesLearned, prevDates } */
function learnRatings(results, opts, onPredict) {
  const { priors, league } = opts;
  const P = Object.assign({}, DEFAULTS, opts.params || {});
  if (!P.REST) P.REST = DEFAULTS.REST; // REST: undefined = sin ajuste de descanso
  const R = {};
  for (const ab in priors) R[ab] = { off: priors[ab].off, def: priors[ab].def, pace: priors[ab].pace || 0 };
  const sorted = [...results].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)));
  const prevDates = {}; // abbr -> [ms...] (últimos 3)
  let obs = 0, pred = 0, n = 0, muShift = 0;
  for (const g of sorted) {
    const h = g.home.abbr, a = g.away.abbr;
    if (!R[h] || !R[a]) continue;
    const rcH = restCategory(prevDates[h], g.date), rcA = restCategory(prevDates[a], g.date);
    const ctx = {
      muShift,
      restHome: restPts(rcH.cat, true, P.REST), restAway: restPts(rcA.cat, false, P.REST),
      restCatHome: rcH.cat, restCatAway: rcA.cat,
      absHome: opts.absences ? opts.absences(g, 'home') : 0,
      absAway: opts.absences ? opts.absences(g, 'away') : 0,
      altHome: !!(opts.altTeams && opts.altTeams.has(h)),
    };
    const e = expectation(R, g, league, ctx, P);
    if (onPredict) onPredict(g, e, ctx);
    // ---- aprender ----
    const possObs = (g.home.poss && g.away.poss) ? (g.home.poss + g.away.poss) / 2 : null;
    const possUse = possObs || e.poss;
    const oh = 100 * g.home.score / possUse, oa = 100 * g.away.score / possUse;
    obs += oh + oa; pred += e.ortgH + e.ortgA; n++;
    muShift = Math.max(-P.MU_SHIFT_CAP, Math.min(P.MU_SHIFT_CAP, ((obs - pred) / (2 * n)) * (n / (n + P.MU_SHIFT_N))));
    // suerte en triples de cada equipo (pts/100 por encima de su % esperado)
    const luck = s => (s && s.tpm != null && s.tpa != null) ? 100 * 3 * (s.tpm - P.LG_3P * s.tpa) / possUse : 0;
    const lH = luck(g.home), lA = luck(g.away);
    const dH = Math.max(-P.CAP, Math.min(P.CAP, oh - e.ortgH));
    const dA = Math.max(-P.CAP, Math.min(P.CAP, oa - e.ortgA));
    R[h].off += P.K * (dH - P.LUCK.off * lH); R[a].def -= P.K * (dH - P.LUCK.def * lH);
    R[a].off += P.K * (dA - P.LUCK.off * lA); R[h].def -= P.K * (dA - P.LUCK.def * lA);
    if (possObs) {
      const dP = Math.max(-P.CAP_POSS, Math.min(P.CAP_POSS, possObs - e.poss));
      R[h].pace += P.KP * dP / 2; R[a].pace += P.KP * dP / 2;
    }
    const t = new Date(g.date).getTime();
    for (const ab of [h, a]) { (prevDates[ab] = prevDates[ab] || []).push(t); if (prevDates[ab].length > 3) prevDates[ab].shift(); }
  }
  return { R, muShift: +muShift.toFixed(2), gamesLearned: n, prevDates };
}

module.exports = { DEFAULTS, restCategory, restPts, REST_NOTE, expectation, learnRatings };
