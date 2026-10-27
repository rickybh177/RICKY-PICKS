/* ============================================================
   NBA — motor analítico de mercados.

   En la NBA el margen y el total de un juego se comportan casi como
   normales (muchas posesiones, cada una de pocos puntos), así que no
   hace falta simular: dados los puntos esperados de cada equipo y
   las desviaciones medidas en el backtest, cada mercado sale en
   forma cerrada y los picks son DETERMINISTAS entre recargas (misma
   filosofía que la matriz Dixon-Coles de Liga MX).

   Margen  M ~ N(E_local − E_visita, SD_MARGIN)  (entero: continuidad)
   Total   T ~ N(E_local + E_visita, SD_TOTAL)   (entero)
   Puntos de un equipo: (T ± M)/2.
   1ª mitad / 1er cuarto: fracción del total y del margen con su propia
   desviación (parámetros medidos sobre los parciales reales).

   Las líneas enteras pueden empujar (push): la probabilidad de cubrir
   se reporta SIN el empate (como paga la casa).
   ============================================================ */

function normCdf(z) {
  if (z < -8) return 0; if (z > 8) return 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/* P(X ≥ k) para X entero ~ N(mu, sd) con corrección de continuidad */
function pAtLeast(k, mu, sd) { return 1 - normCdf((k - 0.5 - mu) / sd); }
/* P(X = k) */
function pEq(k, mu, sd) { return normCdf((k + 0.5 - mu) / sd) - normCdf((k - 0.5 - mu) / sd); }

/* P(X > line) sin empate. line puede ser entera (push) o .5 */
function overProb(line, mu, sd) {
  if (line == null) return null;
  if (Number.isInteger(line)) {
    const push = pEq(line, mu, sd);
    const over = pAtLeast(line + 1, mu, sd);
    return push < 1 ? over / (1 - push) : 0.5;
  }
  return pAtLeast(Math.ceil(line), mu, sd);
}
/* P(local cubre su línea L): M + L > 0 */
function coverProb(homeLine, em, sdM) {
  if (homeLine == null) return null;
  return overProb(-homeLine, em, sdM);
}

/* ---- parámetros de dispersión (los fija scripts/nba-backtest.js) ---- */
const DEFAULT_DISP = {
  SD_MARGIN: 13.2,
  SD_ML: 12.5,
  SD_TOTAL: 19.0,
  H1_SHARE_TOTAL: 0.495, SD_H1_TOTAL: 11.3, H1_SHARE_MARGIN: 0.50, SD_H1_MARGIN: 9.0,
  Q1_SHARE_TOTAL: 0.247, SD_Q1_TOTAL: 7.0,  Q1_SHARE_MARGIN: 0.25, SD_Q1_MARGIN: 6.3,
};

/* Todos los mercados de un juego.
   lines: { spread (línea del LOCAL), total } del mercado, o null → el
   modelo propone sus propias líneas. */
function markets({ expHome, expAway, disp = DEFAULT_DISP, lines }) {
  const em = expHome - expAway, et = expHome + expAway;
  const sdM = disp.SD_MARGIN, sdT = disp.SD_TOTAL;
  /* el ganador se calcula con una sd más angosta que la del margen:
     la distribución real del margen tiene colas pesadas (palizas y
     garbage time) que inflan la sd pero no cambian quién gana. El grid
     del backtest da el mejor Brier del ML con sd≈12.5 y el mejor del
     "cubre" con la sd completa. */
  const mlHome = pAtLeast(1, em, disp.SD_ML || sdM);
  const fairSpread = -Math.round(em * 2) / 2;
  const spreadLine = lines && lines.spread != null ? lines.spread : fairSpread;
  const totalLine = lines && lines.total != null ? lines.total : Math.round(et * 2) / 2;
  const sdTeam = Math.sqrt((sdT * sdT + sdM * sdM) / 4);
  const tt = (mean) => { const line = Math.floor(mean) + 0.5; return { line, over: overProb(line, mean, sdTeam), mean: +mean.toFixed(1) }; };
  const h1 = { em: em * disp.H1_SHARE_MARGIN, et: et * disp.H1_SHARE_TOTAL };
  const q1 = { em: em * disp.Q1_SHARE_MARGIN, et: et * disp.Q1_SHARE_TOTAL };
  const h1Line = Math.floor(h1.et) + 0.5, q1Line = Math.floor(q1.et) + 0.5;

  // distribución del margen para la gráfica: −30..+30 (colas agrupadas)
  const margin_dist = [];
  for (let m = -30; m <= 30; m++) {
    let p = pEq(m, em, sdM);
    if (m === -30) p = normCdf((m + 0.5 - em) / sdM);
    if (m === 30) p = 1 - normCdf((m - 0.5 - em) / sdM);
    margin_dist.push(+p.toFixed(4));
  }

  return {
    moneyline: { home: +mlHome.toFixed(4), away: +(1 - mlHome).toFixed(4) },
    spread: {
      line: spreadLine, home_cover: +coverProb(spreadLine, em, sdM).toFixed(4),
      fair_line: fairSpread, exp_margin: +em.toFixed(1),
    },
    total: { line: totalLine, over: +overProb(totalLine, et, sdT).toFixed(4), model_total: +et.toFixed(1) },
    team_totals: { home: tt(expHome), away: tt(expAway) },
    first_half: {
      home_win: +pAtLeast(1, h1.em, disp.SD_H1_MARGIN).toFixed(4),
      spread_line: -Math.round(h1.em * 2) / 2,
      total_line: h1Line, over: +overProb(h1Line, h1.et, disp.SD_H1_TOTAL).toFixed(4), model_total: +h1.et.toFixed(1),
      exp_margin: +h1.em.toFixed(1),
    },
    first_quarter: {
      home_win: +pAtLeast(1, q1.em, disp.SD_Q1_MARGIN).toFixed(4),
      total_line: q1Line, over: +overProb(q1Line, q1.et, disp.SD_Q1_TOTAL).toFixed(4), model_total: +q1.et.toFixed(1),
      exp_margin: +q1.em.toFixed(1),
    },
    margin_dist,
    dist: { em: +em.toFixed(2), et: +et.toFixed(2), sd_margin: sdM, sd_total: sdT },
  };
}

module.exports = { normCdf, pAtLeast, pEq, overProb, coverProb, markets, DEFAULT_DISP };
