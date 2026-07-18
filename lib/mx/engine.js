/* ============================================================
   LIGA MX — motor Dixon-Coles analítico.

   A diferencia de MLB/NFL (Monte Carlo), aquí el fútbol permite
   algo mejor: calcular la probabilidad EXACTA de cada marcador
   posible. dcMatrix arma la matriz completa de marcadores
   (Poisson bivariado con la corrección Dixon-Coles para 0-0,
   1-0, 0-1 y 1-1) y todos los mercados se derivan de ella.
   Determinista por construcción: cero varianza de simulación y
   los picks no "bailan" entre recargas.

   Las lambdas (goles esperados) llegan de model.js ya con todos
   los ajustes: ratings, localía, altitud, descanso.
   ============================================================ */

const MAX_G = 12; // goles máximos por lado en la matriz (P(>12) ~ 1e-9)

function poissonRow(lambda, n) {
  const row = new Array(n + 1);
  row[0] = Math.exp(-lambda);
  for (let k = 1; k <= n; k++) row[k] = row[k - 1] * lambda / k;
  return row;
}

/* Corrección DC: infla 0-0 y 1-1, desinfla 1-0 y 0-1 con rho<0
   (la Liga MX empata de más; rho se ajustó en los priors). */
function tau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/* Matriz P[i][j] = P(local anota i, visita anota j), normalizada. */
function dcMatrix(lh, la, rho, size = MAX_G) {
  const ph = poissonRow(lh, size), pa = poissonRow(la, size);
  const P = [];
  let sum = 0;
  for (let i = 0; i <= size; i++) {
    P[i] = [];
    for (let j = 0; j <= size; j++) {
      let p = ph[i] * pa[j];
      if (i <= 1 && j <= 1) p *= Math.max(0, tau(i, j, lh, la, rho));
      P[i][j] = p; sum += p;
    }
  }
  for (let i = 0; i <= size; i++) for (let j = 0; j <= size; j++) P[i][j] /= sum;
  return P;
}

/* P(local cubre su hándicap asiático `line`), sin contar push.
   Líneas .25/.75 = promedio de las dos líneas vecinas. */
function ahCover(P, line) {
  if (line == null) return null;
  const q = Math.round(line * 4);
  if (Math.abs(q % 2) === 1) return (ahCover(P, (q - 1) / 4) + ahCover(P, (q + 1) / 4)) / 2;
  let win = 0, push = 0, tot = 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) {
    const v = (i - j) + line;
    tot += P[i][j];
    if (v > 1e-9) win += P[i][j];
    else if (Math.abs(v) <= 1e-9) push += P[i][j];
  }
  const n = tot - push;
  return n > 0 ? win / n : null;
}

/* P(total > line), sin contar push en líneas enteras. */
function overProb(P, line) {
  if (line == null) return null;
  let over = 0, push = 0, tot = 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) {
    const t = i + j;
    tot += P[i][j];
    if (t > line + 1e-9) over += P[i][j];
    else if (Math.abs(t - line) <= 1e-9) push += P[i][j];
  }
  const n = tot - push;
  return n > 0 ? over / n : null;
}

function teamOver(P, side, line) {
  let over = 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) {
    const g = side === 'home' ? i : j;
    if (g > line) over += P[i][j];
  }
  return over;
}

/* Todos los mercados de goles a partir de la matriz. */
function marketsFromMatrix(P, lh, la) {
  let pH = 0, pD = 0, pA = 0, btts = 0, csH = 0, csA = 0;
  let meanH = 0, meanA = 0;
  const exact = [];
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) {
    const p = P[i][j];
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (i > 0 && j > 0) btts += p;
    if (j === 0) csH += p;   // portería en cero del LOCAL
    if (i === 0) csA += p;
    meanH += i * p; meanA += j * p;
    if (i <= 5 && j <= 5) exact.push({ score: `${i}-${j}`, p });
  }
  exact.sort((a, b) => b.p - a.p);

  // margen local agrupado -4..+4 (para la gráfica)
  const marginDist = [];
  for (let m = -4; m <= 4; m++) {
    let c = 0;
    for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) {
      const d = i - j;
      if (d === m || (m === -4 && d < -4) || (m === 4 && d > 4)) c += P[i][j];
    }
    marginDist.push(+c.toFixed(4));
  }

  return {
    moneyline: { home: pH, draw: pD, away: pA },
    double_chance: { home_draw: pH + pD, away_draw: pA + pD, home_away: pH + pA },
    dnb: { home: pH / Math.max(1e-9, pH + pA), away: pA / Math.max(1e-9, pH + pA) },
    totals: [1.5, 2.5, 3.5].map(line => ({ line, over: overProb(P, line) })),
    model_total: +(meanH + meanA).toFixed(2),
    btts: { yes: btts, no: 1 - btts },
    team_totals: {
      home: { mean: +meanH.toFixed(2), over_05: teamOver(P, 'home', 0.5), over_15: teamOver(P, 'home', 1.5) },
      away: { mean: +meanA.toFixed(2), over_05: teamOver(P, 'away', 0.5), over_15: teamOver(P, 'away', 1.5) },
    },
    clean_sheet: { home: csH, away: csA },
    exact_scores: exact.slice(0, 6).map(e => ({ score: e.score, p: +e.p.toFixed(4) })),
    margin_dist: marginDist,
  };
}

/* 1ª mitad: ~44% de los goles caen antes del descanso (el fútbol
   anota más en la 2ª parte); misma estructura DC a escala. */
const H1_SHARE = 0.44;
function firstHalfMarkets(lh, la, rho) {
  const P = dcMatrix(lh * H1_SHARE, la * H1_SHARE, rho, 7);
  let pH = 0, pD = 0, pA = 0, mean = 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) {
    const p = P[i][j];
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    mean += (i + j) * p;
  }
  return {
    home: pH, draw: pD, away: pA,
    over_05: overProb(P, 0.5), over_15: overProb(P, 1.5),
    model_total: +mean.toFixed(2),
  };
}

/* Córneres: total del partido como Poisson (suma de ambos). */
function cornersMarkets(muH, muA, line) {
  const mu = muH + muA;
  const l = line != null ? line : (Math.round(mu) - 0.5); // línea .5 propia si no hay mercado
  const n = 30;
  const row = poissonRow(mu, n);
  let over = 0, push = 0;
  for (let k = 0; k <= n; k++) {
    if (k > l + 1e-9) over += row[k];
    else if (Math.abs(k - l) <= 1e-9) push += row[k];
  }
  const denom = 1 - push;
  return {
    line: l,
    over: denom > 0 ? over / denom : null,
    model_total: +mu.toFixed(1),
    home_mean: +muH.toFixed(1),
    away_mean: +muA.toFixed(1),
  };
}

/* ---- utilidades de momios ---- */
function amToProb(am) {
  const n = Number(am);
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
function probToAm(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p > 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}
/* quitar el vig a N probabilidades implícitas (3 vías del 1X2) */
function devig(probs) {
  const clean = probs.map(p => (p != null && isFinite(p) ? p : null));
  if (clean.some(p => p == null)) return probs;
  const s = clean.reduce((a, b) => a + b, 0);
  return s > 0 ? clean.map(p => p / s) : probs;
}

module.exports = {
  dcMatrix, marketsFromMatrix, firstHalfMarkets, cornersMarkets,
  ahCover, overProb, amToProb, probToAm, devig, MAX_G, H1_SHARE,
};
