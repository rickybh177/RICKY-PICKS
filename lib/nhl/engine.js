/* ============================================================
   NHL — motor analítico de mercados (forma cerrada, determinista:
   los picks no bailan entre recargas, misma filosofía que la matriz
   Dixon-Coles de Liga MX y el motor de NBA).

   El hockey no es fútbol con más goles. Tres cosas lo separan de un
   Poisson simple y el motor las modela una por una, con parámetros
   MEDIDOS fuera de muestra (DISP, los fija scripts/nhl-backtest.js):

   1. EMPATES A 60 MINUTOS. ~22% de los juegos llegan empatados al
      final del tiempo reglamentario; dos Poisson independientes dan
      ~17%. El equipo que va perdiendo aprieta (y saca al portero) y el
      que va ganando se cuida: los marcadores se comprimen. Se corrige
      con un peso por diferencia de goles (MARGIN_W: |dif| = 0, 1, 2,
      3+) sobre la matriz Poisson — la generalización natural del
      ajuste de Dixon-Coles.
   2. PUERTA VACÍA. Con 1-2 goles abajo el rival saca al portero y el
      líder mete un gol a puerta vacía en ~4 de cada 10 de esos juegos:
      eso infla los márgenes (hay MÁS victorias por 3 que por 1) y los
      totales. Los goles esperados λ que entran aquí NO traen puerta
      vacía; se agrega después con su probabilidad medida por
      diferencia (EN[k] = [P(+1), P(+2)] dado que el líder ganaba por k).
   3. TIEMPO EXTRA Y PENALES. El ganador (moneyline) incluye tiempo
      extra y penales; el empate a 60 se reparte casi a volado, con un
      pelo para el mejor equipo (OT_S). Quien gana en tiempo extra o
      penales gana por UN gol y el total sube uno: por eso la línea de
      gol ±1.5 y el total se calculan sobre el marcador FINAL.

   Las líneas enteras pueden empujar (push): la probabilidad se reporta
   SIN el empate (como paga la casa).
   ============================================================ */

const MAXG = 13; // goles máximos por lado en la matriz

function poisVec(lam, n) {
  const v = new Array(n + 1);
  v[0] = Math.exp(-lam);
  for (let k = 1; k <= n; k++) v[k] = v[k - 1] * lam / k;
  return v;
}

/* ---- parámetros de dispersión por defecto (los reales viven en priors.js) ---- */
const DEFAULT_DISP = {
  MARGIN_W: [1.35, 1.03, 0.9, 0.85],            // peso por |dif| sin puerta vacía: 0, 1, 2, 3+
  EN: { 1: [0.39, 0.08], 2: [0.65, 0.015], 3: [0.31, 0], 4: [0.025, 0] }, // P(+1), P(+2) del líder por dif (4 = 4 o más)
  OT_S: 0.3,           // cuánto de la ventaja del mejor equipo sobrevive al tiempo extra
  OT_HOME: 0.0,        // ventaja de local en tiempo extra/penales (sobre 50%)
  P1_SHARE: 0.313,     // fracción de los goles limpios que cae en el 1er periodo
};

/* Matriz del marcador a 60 minutos (con puerta vacía): M[i][j] =
   P(local i, visita j). */
function regMatrix(lh, la, disp = DEFAULT_DISP) {
  const W = disp.MARGIN_W || [1, 1, 1, 1];
  /* 1) Poisson con peso por diferencia. El peso quita masa a las
     goleadas (los marcadores más altos) y bajaría el promedio de goles
     por debajo de λ; se re-escala cada lado (dos vueltas bastan) para
     que la matriz ya pesada conserve EXACTAMENTE los goles esperados
     que entraron. */
  let sh = 1, sa = 1, A = null, tot = 0;
  for (let it = 0; it < 3; it++) {
    const ph = poisVec(lh * sh, MAXG), pa = poisVec(la * sa, MAXG);
    A = []; tot = 0;
    let mh = 0, ma = 0;
    for (let i = 0; i <= MAXG; i++) {
      A.push(new Array(MAXG + 1));
      for (let j = 0; j <= MAXG; j++) {
        const v = ph[i] * pa[j] * W[Math.min(3, Math.abs(i - j))];
        A[i][j] = v; tot += v; mh += v * i; ma += v * j;
      }
    }
    if (it === 2) break;
    sh *= lh / (mh / tot); sa *= la / (ma / tot);
  }
  // 2) puerta vacía: el líder suma 1 o 2 goles
  const M = [];
  for (let i = 0; i <= MAXG + 2; i++) M.push(new Array(MAXG + 3).fill(0));
  const EN = disp.EN || {};
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) {
    const p = A[i][j] / tot;
    const d = i - j;
    if (d === 0) { M[i][j] += p; continue; }
    const e = EN[Math.min(4, Math.abs(d))] || [0, 0];
    const p1 = e[0] || 0, p2 = e[1] || 0;
    M[i][j] += p * (1 - p1 - p2);
    if (d > 0) { M[i + 1][j] += p * p1; M[i + 2][j] += p * p2; }
    else { M[i][j + 1] += p * p1; M[i][j + 2] += p * p2; }
  }
  return M;
}

/* P(over) de una distribución discreta {valor: prob} sin el empuje */
function overFromDist(dist, line) {
  if (line == null) return null;
  let over = 0, push = 0;
  for (let k = 0; k < dist.length; k++) { if (k > line) over += dist[k]; else if (k === line) push += dist[k]; }
  return push < 1 ? over / (1 - push) : 0.5;
}
/* P(local cubre su línea L) sobre la distribución del margen FINAL
   (md[m + OFF]); sin empuje */
function coverFromMargin(md, OFF, homeLine) {
  if (homeLine == null) return null;
  let win = 0, push = 0;
  for (let k = 0; k < md.length; k++) { const v = k - OFF + homeLine; if (v > 1e-9) win += md[k]; else if (Math.abs(v) <= 1e-9) push += md[k]; }
  return push < 1 ? win / (1 - push) : 0.5;
}

const r4 = x => +x.toFixed(4);

/* Todos los mercados de un juego.
   lines: { pl (línea de gol del LOCAL, −1.5 / +1.5), total } del
   mercado, o null → el modelo propone las suyas. */
function markets({ lamHome, lamAway, disp = DEFAULT_DISP, lines }) {
  const M = regMatrix(lamHome, lamAway, disp);
  const N = M.length;
  // 1X2 a 60 minutos
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = M[i][j]; if (i > j) pH += p; else if (i === j) pD += p; else pA += p; }
  // tiempo extra / penales
  const strength = pH + pA > 0 ? pH / (pH + pA) : 0.5;
  const otHome = Math.min(0.75, Math.max(0.25, 0.5 + (disp.OT_HOME || 0) + (disp.OT_S || 0) * (strength - 0.5)));
  const mlHome = pH + pD * otHome;

  // distribuciones del marcador FINAL (tiempo extra/penales = +1 gol al ganador)
  const OFF = N + 1;
  const md = new Array(2 * OFF + 1).fill(0);      // margen final (local − visita)
  const td = new Array(2 * N + 2).fill(0);        // total final
  const hd = new Array(N + 2).fill(0), ad = new Array(N + 2).fill(0); // goles finales de cada equipo
  let eH = 0, eA = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = M[i][j];
    if (!p) continue;
    if (i !== j) { md[i - j + OFF] += p; td[i + j] += p; hd[i] += p; ad[j] += p; eH += p * i; eA += p * j; }
    else {
      md[1 + OFF] += p * otHome; md[-1 + OFF] += p * (1 - otHome); td[i + j + 1] += p;
      hd[i + 1] += p * otHome; hd[i] += p * (1 - otHome); ad[j + 1] += p * (1 - otHome); ad[j] += p * otHome;
      eH += p * (i + otHome); eA += p * (j + 1 - otHome);
    }
  }
  const eT = eH + eA;

  // línea de gol: ±1.5 con el favorito del MODELO si no hay mercado
  const fairPl = mlHome >= 0.5 ? -1.5 : 1.5;
  const pl = lines && lines.pl != null ? lines.pl : fairPl;
  // total: la línea .5 más cercana al esperado si no hay mercado
  const totalLine = lines && lines.total != null ? lines.total : Math.round(eT - 0.5) + 0.5;
  const tt = (dist, mean) => { const line = Math.max(1.5, Math.round(mean - 0.5) + 0.5); return { line, over: r4(overFromDist(dist, line)), mean: +mean.toFixed(2) }; };

  // 1er periodo: Poisson independiente con la fracción medida
  const sh = disp.P1_SHARE || 0.31;
  const l1h = lamHome * sh, l1a = lamAway * sh, l1 = l1h + l1a;
  const p1 = poisVec(l1, 12);
  const p1Line = 1.5;
  const v1h = poisVec(l1h, 8), v1a = poisVec(l1a, 8);
  let p1H = 0, p1D = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const p = v1h[i] * v1a[j]; if (i > j) p1H += p; else if (i === j) p1D += p; }

  // distribución del margen final para la gráfica: −5..+5 (colas agrupadas)
  const margin_dist = [];
  for (let m = -5; m <= 5; m++) {
    let p = 0;
    if (m === -5) { for (let k = 0; k <= -5 + OFF; k++) p += md[k]; }
    else if (m === 5) { for (let k = 5 + OFF; k < md.length; k++) p += md[k]; }
    else p = md[m + OFF];
    margin_dist.push(r4(p));
  }

  return {
    moneyline: { home: r4(mlHome), away: r4(1 - mlHome) },
    regulation: { home: r4(pH), draw: r4(pD), away: r4(pA) },
    overtime: { prob: r4(pD), home_win: r4(otHome) },
    puck_line: {
      line: pl, home_cover: r4(coverFromMargin(md, OFF, pl)),
      home_minus: r4(coverFromMargin(md, OFF, -1.5)), home_plus: r4(coverFromMargin(md, OFF, 1.5)),
      exp_margin: +(eH - eA).toFixed(2),
    },
    total: { line: totalLine, over: r4(overFromDist(td, totalLine)), model_total: +eT.toFixed(2) },
    team_totals: { home: tt(hd, eH), away: tt(ad, eA) },
    first_period: {
      total_line: p1Line, over: r4(overFromDist(p1, p1Line)), model_total: +l1.toFixed(2),
      home: r4(p1H), draw: r4(p1D), away: r4(1 - p1H - p1D),
    },
    margin_dist,
    dist: { exp_home: +eH.toFixed(2), exp_away: +eA.toFixed(2), exp_total: +eT.toFixed(2) },
    _raw: { md, OFF, td, hd, ad },
  };
}

module.exports = { regMatrix, markets, overFromDist, coverFromMargin, poisVec, DEFAULT_DISP, MAXG };
