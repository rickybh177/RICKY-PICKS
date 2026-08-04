/* ============================================================
   NFL — ajuste de ratings ofensivos/defensivos por rival.
   Usado SOLO por scripts (build-nfl-priors, nfl-backtest); nunca
   se carga en runtime del API. Mismo patrón que lib/mx/fit.js.

   Modelo por juego (puntos anotados, gaussiano):
     pts_local  = mu + hfa/2 + off[h] − def[a]
     pts_visita = mu − hfa/2 + off[a] − def[h]
   off = puntos que mete vs promedio; def = puntos que QUITA vs
   promedio (positivo = buena defensa). En sede neutral el hfa no
   aplica.

   Lección del fitter MX: mu y hfa NO se mueven por gradiente
   junto con off/def (colinealidad) — dados off/def se resuelven
   en forma cerrada exacta cada iteración. off/def van por
   descenso coordenado con regularización ridge (REG_W
   pseudo-juegos hacia 0).

   Además ajusta los parámetros de PRETEMPORADA contra juegos de
   pretemporada reales: entorno anotador propio (mu), hfa propio
   y beta = cuánto de los ratings de temporada regular se asoma
   en agosto (titulares jugando un cuarto → beta << 1).
   ============================================================ */

const HALF_LIFE_DAYS = 320;  // la temporada anterior pesa ~½ (rosters rotan)
const PLAYOFF_W = 0.9;       // playoffs pesan un poco menos (matchups extremos)
const REG_W = 6;             // pseudo-juegos hacia 0 (regresión a la media)

function gameWeight(g, asOfMs, halfLife) {
  const days = Math.max(0, (asOfMs - new Date(g.date).getTime()) / 86400000);
  let w = Math.pow(0.5, days / (halfLife || HALF_LIFE_DAYS));
  if (g.seasontype === 3) w *= PLAYOFF_W;
  return w;
}

/* games: [{date, seasontype, neutral, home:{abbr,score}, away:{abbr,score}}]
   Devuelve { ratings: {abbr:{off,def}}, mu, hfa, diag } */
function fitRatings(games, { asOf, halfLife, iters = 200 } = {}) {
  const asOfMs = asOf || Date.now();
  const rows = [];
  for (const g of games) {
    if (g.home.score == null || g.away.score == null) continue;
    if (!g.home.abbr || !g.away.abbr) continue;
    rows.push({
      h: g.home.abbr, a: g.away.abbr,
      sh: g.home.score, sa: g.away.score,
      hfaOn: g.neutral ? 0 : 1,
      w: gameWeight(g, asOfMs, halfLife),
    });
  }
  if (!rows.length) throw new Error('fitRatings: sin juegos');

  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))];
  const off = {}, def = {}, wSum = {};
  for (const t of teams) { off[t] = 0; def[t] = 0; wSum[t] = 0; }
  for (const r of rows) { wSum[r.h] += r.w; wSum[r.a] += r.w; }

  let mu = 22, hfa = 1.5;

  /* mu y hfa en forma cerrada, dados off/def (mínimos cuadrados
     ponderados en 2 incógnitas; cada juego aporta 2 renglones). */
  const solveMuHfa = () => {
    let sW = 0, sWh = 0, sWhh = 0, sR = 0, sRh = 0;
    for (const r of rows) {
      const base = { home: off[r.h] - def[r.a], away: off[r.a] - def[r.h] };
      // renglón local: resid = sh - base.home = mu + (hfa/2)·hfaOn
      sW += r.w; sWh += r.w * (r.hfaOn / 2); sWhh += r.w * (r.hfaOn / 2) ** 2;
      sR += r.w * (r.sh - base.home); sRh += r.w * (r.sh - base.home) * (r.hfaOn / 2);
      // renglón visita: resid = sa - base.away = mu − (hfa/2)·hfaOn
      sW += r.w; sWh += r.w * (-r.hfaOn / 2); sWhh += r.w * (r.hfaOn / 2) ** 2;
      sR += r.w * (r.sa - base.away); sRh += r.w * (r.sa - base.away) * (-r.hfaOn / 2);
    }
    const det = sW * sWhh - sWh * sWh;
    if (Math.abs(det) > 1e-9) {
      mu = (sR * sWhh - sRh * sWh) / det;
      hfa = (sW * sRh - sWh * sR) / det;
    }
  };

  for (let it = 0; it < iters; it++) {
    solveMuHfa();
    // off/def por descenso coordenado (cerrado por equipo, ridge REG_W)
    let maxD = 0;
    for (const t of teams) {
      let num = 0, den = REG_W;
      for (const r of rows) {
        if (r.h === t) { num += r.w * (r.sh - mu - (r.hfaOn * hfa) / 2 + def[r.a]); den += r.w; }
        if (r.a === t) { num += r.w * (r.sa - mu + (r.hfaOn * hfa) / 2 + def[r.h]); den += r.w; }
      }
      const nv = num / den;
      maxD = Math.max(maxD, Math.abs(nv - off[t]));
      off[t] = nv;
    }
    for (const t of teams) {
      let num = 0, den = REG_W;
      for (const r of rows) {
        if (r.a === t) { num += r.w * (mu + (r.hfaOn * hfa) / 2 + off[r.h] - r.sh); den += r.w; }
        if (r.h === t) { num += r.w * (mu - (r.hfaOn * hfa) / 2 + off[r.a] - r.sa); den += r.w; }
      }
      const nv = num / den;
      maxD = Math.max(maxD, Math.abs(nv - def[t]));
      def[t] = nv;
    }
    // identificabilidad: off y def centrados en 0 (el nivel vive en mu)
    const mO = teams.reduce((s, t) => s + off[t], 0) / teams.length;
    const mD = teams.reduce((s, t) => s + def[t], 0) / teams.length;
    for (const t of teams) { off[t] -= mO; def[t] -= mD; }
    mu += mO - mD;
    if (it > 10 && maxD < 1e-6) break;
  }
  solveMuHfa();

  // diagnóstico: sd del residuo (varianza real de anotación por equipo)
  let se = 0, sw = 0, sumPts = 0;
  for (const r of rows) {
    const eh = mu + (r.hfaOn * hfa) / 2 + off[r.h] - def[r.a];
    const ea = mu - (r.hfaOn * hfa) / 2 + off[r.a] - def[r.h];
    se += r.w * ((r.sh - eh) ** 2 + (r.sa - ea) ** 2);
    sw += 2 * r.w;
    sumPts += r.sh + r.sa;
  }
  const ratings = {};
  for (const t of teams) ratings[t] = { off: +off[t].toFixed(2), def: +def[t].toFixed(2) };
  return {
    ratings,
    mu: +mu.toFixed(2), hfa: +hfa.toFixed(2),
    diag: {
      games: rows.length,
      resid_sd: +Math.sqrt(se / sw).toFixed(2),
      avg_ppg: +(sumPts / (2 * rows.length)).toFixed(2),
    },
  };
}

/* Parámetros de pretemporada: dados ratings de temporada regular
   (ya con carry aplicado), ajusta contra juegos de pretemporada:
     pts = pre_mu ± pre_hfa/2 + beta·(off_i − def_j)
   pre_mu/pre_hfa en forma cerrada; beta por mínimos cuadrados. */
function fitPreseason(preGames, ratingsByYear) {
  const rows = [];
  for (const g of preGames) {
    const R = ratingsByYear[g.seasonYear];
    if (!R || g.home.score == null || g.away.score == null) continue;
    const rh = R[g.home.abbr], ra = R[g.away.abbr];
    if (!rh || !ra) continue;
    rows.push(
      { s: g.home.score, x: rh.off - ra.def, h: g.neutral ? 0 : 0.5 },
      { s: g.away.score, x: ra.off - rh.def, h: g.neutral ? 0 : -0.5 },
    );
  }
  if (rows.length < 40) throw new Error('fitPreseason: muy pocos juegos (' + rows.length + ' renglones)');
  let mu = 20, hfa = 1, beta = 0.3;
  for (let it = 0; it < 100; it++) {
    // mu, hfa cerrados dados beta
    let sW = 0, sWh = 0, sWhh = 0, sR = 0, sRh = 0;
    for (const r of rows) {
      const resid = r.s - beta * r.x;
      sW += 1; sWh += r.h; sWhh += r.h * r.h;
      sR += resid; sRh += resid * r.h;
    }
    const det = sW * sWhh - sWh * sWh;
    if (Math.abs(det) > 1e-9) { mu = (sR * sWhh - sRh * sWh) / det; hfa = (sW * sRh - sWh * sR) / det; }
    // beta cerrado dados mu/hfa
    let num = 0, den = 1e-9;
    for (const r of rows) { const y = r.s - mu - hfa * r.h; num += y * r.x; den += r.x * r.x; }
    beta = num / den;
  }
  let se = 0;
  for (const r of rows) se += (r.s - mu - hfa * r.h - beta * r.x) ** 2;
  return {
    mu: +mu.toFixed(2),
    hfa: +hfa.toFixed(2),
    beta: +Math.max(0, Math.min(1, beta)).toFixed(3),
    diag: { rows: rows.length, resid_sd: +Math.sqrt(se / rows.length).toFixed(2) },
  };
}

module.exports = { fitRatings, fitPreseason, gameWeight, HALF_LIFE_DAYS, REG_W, PLAYOFF_W };
