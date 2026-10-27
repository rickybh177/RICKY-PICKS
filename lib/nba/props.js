/* ============================================================
   NBA — motor de PROPS DE JUGADOR: puntos, rebotes, asistencias,
   triples, PRA (puntos+rebotes+asistencias) y doble-doble.

   Idea (misma receta que lib/nfl/props.js, adaptada al básquet, donde
   TODO pasa por los minutos):
   1. MINUTOS esperados: su carga reciente (historial ponderado por
      recencia, half-life corto: los roles cambian rápido).
   2. RITMO por minuto de cada estadística (ratio de medias ponderadas:
      estable aunque un juego sea de 8 minutos por faltas).
   3. ENTORNO: lo que el modelo de equipo espera HOY —puntos de su
      equipo (para puntos) y posesiones del juego (rebotes, asistencias,
      triples)— contra lo que su equipo hizo en los juegos de su
      muestra, con exponente sub-lineal.
   4. RIVAL: lo que esa defensa permite por juego en la estadística
      (por 100 posesiones) vs el promedio de liga, encogido.
   5. Distribución: la del jugador (sd propia encogida hacia el
      coeficiente de variación de la estadística), con la forma que
      el backtest validó por mercado (normal con continuidad para
      puntos/PRA/rebotes/asistencias; binomial negativa para triples).
      Doble-doble: frecuencia propia encogida hacia la que sale de las
      marginales.

   Solo se proyecta a quien tiene historial suficiente; sin línea del
   mercado no hay BET (solo lectura). Todo walk-forward: solo juegos
   ANTERIORES a la fecha objetivo.
   ============================================================ */
const { normCdf } = require('./engine');

const P = {
  MIN_HALF_LIFE: 5,      // recencia de los minutos (juegos)
  RATE_HALF_LIFE: 10,    // recencia de los ritmos por minuto
  MAX_GAMES: 30,         // muestra máxima por jugador (40 apenas mejora; 30 reacciona antes a un cambio de rol)
  MIN_GAMES: 5,          // mínimo para proyectar
  QUAL_MIN: 8,           // un juego cuenta si jugó ≥ 8 minutos
  ENV_EXP_PTS: 0.3,      // puntos escalan sub-linealmente con los puntos del equipo (0-0.5 plano en el backtest)
  ENV_EXP_PACE: 0.4,     // rebotes/asistencias/triples con el ritmo (efecto casi nulo medido)
  ENV_CLAMP: [0.85, 1.18],
  DEF_SHRINK: 0.5,       // peso de la defensa rival
  DEF_CLAMP: [0.9, 1.1],
  DEF_GAMES: 20,
  SD_SHRINK_N: 8,        // n/(n+8) de peso a la sd propia
  DD_SHRINK_N: 20,       // doble-doble: peso de la frecuencia propia (con 10 salía sobreconfiado arriba del 60%)
  /* mezcla lognormal/normal por stat: los conteos son sesgados a la
     derecha (muchos juegos chicos, pocos enormes); con normal pura el
     "over" en la mediana salía 5 pts arriba en rebotes y asistencias */
  MIX_LN: { pts: 0.5, reb: 0.5, ast: 0.5, pra: 0.4 },
  MIN_SD_FLOOR: 3.5,     // sd mínima de minutos
};
/* coeficiente de variación de arranque por stat (se recalcula del dataset) */
const CV_DEFAULT = { pts: 0.38, reb: 0.42, ast: 0.45, tpm: 0.75, pra: 0.30 };
const STATS = ['pts', 'reb', 'ast', 'tpm', 'pra'];
const DIST = { pts: 'mix', reb: 'mix', ast: 'mix', tpm: 'nb', pra: 'mix' };
const ENV_OF = { pts: 'pts', reb: 'pace', ast: 'pace', tpm: 'pace', pra: 'pts' };
const get = { pts: r => r.pts, reb: r => r.reb, ast: r => r.ast, tpm: r => r.tpm, pra: r => r.pts + r.reb + r.ast };

/* Índice de props: por jugador (filas calificadas) + lo que cada
   defensa permite por juego por stat (para el factor rival) + cv.
   Recibe el índice de lib/nba/players.js (byPlayer, teamGames). */
function buildPropsIndex(idx) {
  // permitido por juego: suma del stat de los jugadores RIVALES
  const allowed = new Map(); // team -> [{date, pts, reb, ast, tpm, poss}]
  for (const [team, list] of idx.teamGames) {
    for (const tg of list) {
      const s = { date: tg.date, pts: 0, reb: 0, ast: 0, tpm: 0 };
      for (const r of tg.rows) { s.pts += r.pts; s.reb += r.reb; s.ast += r.ast; s.tpm += r.tpm; }
      const opp = tg.opp;
      if (!allowed.has(opp)) allowed.set(opp, []);
      allowed.get(opp).push(s);
    }
  }
  for (const a of allowed.values()) a.sort((x, y) => new Date(x.date) - new Date(y.date));
  // cv por stat: mediana entre jugadores con ≥15 juegos calificados y media decente
  const cv = { ...CV_DEFAULT }, acc = {};
  for (const [, list] of idx.byPlayer) {
    const q = list.filter(r => !r.dnp && r.min >= P.QUAL_MIN);
    if (q.length < 15) continue;
    for (const s of STATS) {
      const v = q.map(get[s]);
      const mu = v.reduce((a, b) => a + b, 0) / v.length;
      if (mu < (s === 'tpm' ? 1 : 4)) continue;
      const sd = Math.sqrt(v.reduce((a, x) => a + (x - mu) ** 2, 0) / (v.length - 1));
      (acc[s] = acc[s] || []).push(sd / mu);
    }
  }
  for (const s in acc) { const a = acc[s].sort((x, y) => x - y); cv[s] = a[Math.floor(a.length / 2)]; }
  return { ...idx, allowed, cv };
}

/* factor rival: permitido/juego del rival ÷ liga, en juegos previos.
   Memo por (rival, stat, fecha): los 25 jugadores de un juego lo
   comparten y el backtest lo pide cientos de miles de veces. */
function defenseFactor(pidx, opp, stat, beforeDate) {
  const memoKey = opp + '|' + stat + '|' + String(beforeDate).slice(0, 10);
  if (!pidx._defMemo) pidx._defMemo = new Map();
  if (pidx._defMemo.has(memoKey)) return pidx._defMemo.get(memoKey);
  const v = defenseFactorRaw(pidx, opp, stat, beforeDate);
  pidx._defMemo.set(memoKey, v);
  return v;
}
function leagueAllowed(pidx, stat, beforeDate) {
  const k = stat + '|' + String(beforeDate).slice(0, 10);
  if (!pidx._lgMemo) pidx._lgMemo = new Map();
  if (pidx._lgMemo.has(k)) return pidx._lgMemo.get(k);
  const cut = new Date(beforeDate).getTime();
  let tot = 0, n = 0;
  for (const arr of pidx.allowed.values()) {
    const w = arr.filter(x => new Date(x.date).getTime() < cut).slice(-P.DEF_GAMES);
    for (const x of w) { tot += x[stat]; n++; }
  }
  const v = n ? tot / n : null;
  pidx._lgMemo.set(k, v);
  return v;
}
function defenseFactorRaw(pidx, opp, stat, beforeDate) {
  const cut = new Date(beforeDate).getTime();
  const mine = (pidx.allowed.get(opp) || []).filter(x => new Date(x.date).getTime() < cut).slice(-P.DEF_GAMES);
  if (mine.length < 5) return 1;
  const oppAvg = mine.reduce((s, x) => s + x[stat], 0) / mine.length;
  const lg = leagueAllowed(pidx, stat, beforeDate);
  if (!lg) return 1;
  const f = 1 + P.DEF_SHRINK * (oppAvg / lg - 1);
  return Math.max(P.DEF_CLAMP[0], Math.min(P.DEF_CLAMP[1], f));
}

/* Proyección de un jugador para un juego.
   ctx: { date, team, opp, expPts (puntos esperados de SU equipo),
          expPoss (posesiones esperadas del juego), lgPoss } */
function projectPlayer(pidx, playerId, ctx) {
  const all = pidx.byPlayer.get(playerId) || [];
  const cut = new Date(ctx.date).getTime();
  const hist = all.filter(r => new Date(r.date).getTime() < cut && !r.dnp && r.min >= P.QUAL_MIN).slice(-P.MAX_GAMES);
  if (hist.length < P.MIN_GAMES) return null;
  const n = hist.length;
  const wts = hl => hist.map((_, i) => Math.pow(0.5, (n - 1 - i) / hl));
  const wMin = wts(P.MIN_HALF_LIFE), wRate = wts(P.RATE_HALF_LIFE);
  const wmean = (w, f) => { let s = 0, W = 0; hist.forEach((r, i) => { s += w[i] * f(r); W += w[i]; }); return s / W; };

  // minutos
  const muMin = wmean(wMin, r => r.min);
  const sdMin = Math.max(P.MIN_SD_FLOOR, Math.sqrt(wmean(wMin, r => (r.min - muMin) ** 2) * n / Math.max(1, n - 1)));
  // entorno
  const teamPts = wmean(wRate, r => r.teamPts);
  const teamPoss = wmean(wRate, r => (r.poss || ctx.lgPoss || 100));
  const fPts = ctx.expPts && teamPts > 50 ? clamp(Math.pow(ctx.expPts / teamPts, P.ENV_EXP_PTS)) : 1;
  const fPace = ctx.expPoss && teamPoss > 60 ? clamp(Math.pow(ctx.expPoss / teamPoss, P.ENV_EXP_PACE)) : 1;
  // cambio de equipo: menos de 4 juegos con el actual
  const withTeam = ctx.team ? hist.filter(r => r.team === ctx.team).length : n;
  const starterRate = wmean(wMin, r => (r.starter ? 1 : 0));

  const out = { games: n, minutes: +muMin.toFixed(1), sd_minutes: +sdMin.toFixed(1), starter_rate: +starterRate.toFixed(2), f_pts: +fPts.toFixed(3), f_pace: +fPace.toFixed(3), team_changed: withTeam < 4, markets: {} };
  const perMin = {};
  for (const s of STATS) {
    const rate = wmean(wRate, r => get[s](r)) / wmean(wRate, r => r.min); // ratio de medias
    perMin[s] = rate;
    const fEnv = ENV_OF[s] === 'pts' ? fPts : fPace;
    const fDef = defenseFactor(pidx, ctx.opp, s === 'pra' ? 'pts' : s, ctx.date);
    const mu = rate * muMin * fEnv * fDef;
    // sd propia (del stat por juego), encogida al cv de la stat
    const mu0 = wmean(wRate, get[s]);
    const sdOwn = Math.sqrt(Math.max(0, wmean(wRate, r => (get[s](r) - mu0) ** 2)) * n / Math.max(1, n - 1)) * (mu / Math.max(0.1, mu0));
    const sdPos = (pidx.cv[s] || CV_DEFAULT[s]) * mu;
    const k = n / (n + P.SD_SHRINK_N);
    const sd = Math.sqrt(k * sdOwn ** 2 + (1 - k) * sdPos ** 2);
    out.markets[s] = { type: DIST[s], w_ln: P.MIX_LN[s], mu: +mu.toFixed(2), sd: +Math.max(s === 'tpm' ? 0.6 : 1.2, sd).toFixed(2), f_def: +fDef.toFixed(3) };
  }
  // doble-doble: frecuencia propia (encogida) hacia la de las marginales
  {
    const emp = wmean(wRate, r => (([r.pts, r.reb, r.ast].filter(v => v >= 10).length >= 2) ? 1 : 0));
    const m = out.markets;
    const p10 = s => 1 - normCdf((9.5 - m[s].mu) / m[s].sd);
    const a = p10('pts'), b = p10('reb'), c = p10('ast');
    const ind = a * b + a * c + b * c - 2 * a * b * c; // ≥2 de 3, independientes
    const k = n / (n + P.DD_SHRINK_N);
    const p = k * emp + (1 - k) * ind;
    out.markets.dd = { type: 'bernoulli', p: +Math.min(0.98, Math.max(0.005, p)).toFixed(3), emp: +emp.toFixed(3), ind: +ind.toFixed(3) };
  }
  return out;
}
function clamp(x) { return Math.max(P.ENV_CLAMP[0], Math.min(P.ENV_CLAMP[1], x)); }

/* P(stat > line). Normal con continuidad para enteros; binomial
   negativa por momentos para triples (Poisson si no hay sobredispersión). */
function probOver(m, line) {
  if (!m || line == null) return null;
  if (m.type === 'bernoulli') return m.p;
  const k = Math.floor(line); // over ⇔ X ≥ k+1 (línea .5) — líneas enteras: push, se trata como .5 abajo
  const thr = Number.isInteger(line) ? line + 0.5 : line;
  const x = Math.ceil(thr) - 0.5; // umbral continuo: X > line ⇔ X ≥ ceil(line) (enteros)
  const pN = 1 - normCdf((x - m.mu) / m.sd);
  if (m.type === 'normal') return pN;
  if (m.type === 'mix') {
    // lognormal por momentos (misma media y sd, sesgo a la derecha)
    let pLn = 1;
    if (m.mu <= 0.05) return pN; // sin producción: la lognormal no está definida
    if (x > 0) {
      const cv2 = (m.sd / m.mu) ** 2, s2 = Math.log(1 + cv2), mLog = Math.log(m.mu) - s2 / 2;
      pLn = 1 - normCdf((Math.log(x) - mLog) / Math.sqrt(s2));
    }
    const w = m.w_ln != null ? m.w_ln : 0.5;
    return w * pLn + (1 - w) * pN;
  }
  // nb: P(X ≤ k) con media mu y varianza sd²
  const mu = m.mu, v = Math.max(mu * 1.0001, m.sd * m.sd);
  const r = mu * mu / (v - mu), p = r / (r + mu); // p = prob de "éxito" en la parametrización estándar
  let cdf = 0, term = Math.pow(p, r); // P(X=0)
  for (let i = 0; i <= k; i++) {
    cdf += term;
    term *= (r + i) / (i + 1) * (1 - p);
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

module.exports = { buildPropsIndex, projectPlayer, probOver, defenseFactor, STATS, DIST, PARAMS: P, CV_DEFAULT, get };
