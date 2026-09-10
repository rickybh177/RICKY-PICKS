/* ============================================================
   NFL — motor de PROPS DE JUGADOR (yardas, recepciones, TDs).

   Idea: la proyección de un jugador para ESTE juego es su forma
   reciente (historial jugador-juego ponderado por recencia),
   escalada por dos cosas que sí sabemos de este partido:
   1. ENTORNO: los puntos que el modelo de equipo espera hoy vs los
      que su equipo anotó en los juegos de su muestra (una ofensiva
      que hoy se espera más productiva reparte más yardas);
   2. RIVAL: lo que esa defensa permite por juego en la categoría
      (pase / carrera / recepción) vs el promedio de liga, encogido.

   Distribuciones:
   - yardas, recepciones, completos → Normal(mu, sd), con sd del
     propio jugador encogida hacia el coeficiente de variación de su
     posición (validado en scripts/nfl-props-backtest.js);
   - TDs de pase → Poisson; anytime TD → 1 − e^(−λ).

   Fiabilidad: solo se proyecta a quien tiene historial suficiente
   con participación real (novatos y suplentes sin muestra quedan
   fuera), y sin línea del mercado no hay BET — solo lectura.
   Todo walk-forward: solo usa juegos ANTERIORES a la fecha objetivo.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

/* ---- parámetros (los valida scripts/nfl-props-backtest.js; el
   backtest los sobreescribe con Object.assign para hacer grids) ---- */
const P = {
  HALF_LIFE_GAMES: 6,      // recencia: el juego de hace 6 pesa ½
  MAX_GAMES: 16,           // muestra máxima por jugador
  MIN_GAMES: 4,            // mínimo para proyectar
  ENV_EXP: 0.6,            // yardas escalan sub-linealmente con puntos
  ENV_CLAMP: [0.8, 1.25],
  DEF_SHRINK: 0.5,         // peso de la defensa rival (0 = ignorar)
  DEF_CLAMP: [0.85, 1.15],
  DEF_GAMES: 16,
  SD_SHRINK_N: 6,          // n/(n+6) de peso a la sd propia
  /* Distribución de yardas/recepciones: mezcla lognormal/normal.
     Con Normal pura el "over" en la mediana salía 40-48% en vez de
     50% (la realidad es sesgada: muchos juegos chicos, pocos enormes);
     con lognormal pura, carrera/recepción se pasaban de sesgo en la
     cola baja (93-95% de over donde ocurre 85%). MIX_LN es el peso de
     la lognormal por stat, ajustado para clavar el centro — que es
     donde las casas ponen las líneas. */
  MIX_LN: { pass_yds: 1.0, pass_completions: 1.0, rush_yds: 0.6, reception_yds: 0.6, receptions: 0.6 },
  /* TDs: la tasa por juego de una muestra de ≤16 juegos es ruidosa;
     λ se encoge hacia el promedio de su posición con n/(n+TD_SHRINK_N).
     Sin esto el backtest predecía 5% donde pasaba 18% y 64% donde
     pasaba 44%. */
  TD_SHRINK_N: 10,
};
/* TDs por juego típicos por posición (prior del encogimiento) */
const TD_PRIOR = { pass_tds: 1.45, anytime_td: { QB: 0.25, RB: 0.45, WR: 0.30, TE: 0.25 } };

/* Umbrales de participación por posición para que un juego cuente. */
const QUALIFY = {
  QB: r => r.att >= 10,
  RB: r => r.ratt + r.tgt >= 5,
  WR: r => r.tgt >= 2,
  TE: r => r.tgt >= 2,
};

/* Coeficiente de variación por posición y stat (respaldo para la sd
   cuando el jugador tiene poca muestra). Se recalculan en buildIndex
   a partir del dataset; estos son los valores de arranque. */
const CV_DEFAULT = {
  pass_yds: 0.28, pass_completions: 0.24, rush_yds: 0.55, reception_yds: 0.62, receptions: 0.42,
};

/* ---- carga del historial ---- */
function loadStatic(year) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `player-games-${year}.json`), 'utf8'));
  } catch (e) { return null; }
}

/* Normaliza un dataset compacto a filas {gameId,date,week,seasontype,
   team,opp,home,teamPts,oppPts, id,name,pos, cmp,att,pyds,ptd,int,
   ratt,ryds,rtd, tgt,rec,recyds,rectd} */
function expand(ds) {
  const out = [];
  if (!ds) return out;
  const G = ds.games;
  for (const r of ds.rows) {
    const g = G[r[0]];
    const [gid, date, week, st, home, away, hs, as] = g;
    const team = r[3];
    const isHome = team === home;
    out.push({
      gameId: String(gid), date, week, seasontype: st,
      team, opp: isHome ? away : home, home: isHome,
      teamPts: isHome ? hs : as, oppPts: isHome ? as : hs,
      id: String(r[1]), name: r[2], pos: r[4],
      cmp: r[5], att: r[6], pyds: r[7], ptd: r[8], int: r[9],
      ratt: r[10], ryds: r[11], rtd: r[12],
      tgt: r[13], rec: r[14], recyds: r[15], rectd: r[16],
    });
  }
  return out;
}

/* Historial completo: temporadas estáticas + filas extra (en curso). */
function loadHistory({ years = [2024, 2025], extraRows = [] } = {}) {
  const rows = [];
  for (const y of years) rows.push(...expand(loadStatic(y)));
  rows.push(...extraRows);
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  return rows;
}

/* Índices: por jugador, por equipo-juego (defensa) y cv por posición. */
function buildIndex(rows) {
  const byPlayer = new Map();
  const teamGames = new Map(); // team -> [{date, gameId, allowed:{pass,rush,rec}, scored}] (lo que PERMITIÓ)
  const gameAgg = new Map();   // gameId -> { team: {pass, rush, rec} }
  for (const r of rows) {
    if (!byPlayer.has(r.id)) byPlayer.set(r.id, []);
    byPlayer.get(r.id).push(r);
    const key = r.gameId;
    if (!gameAgg.has(key)) gameAgg.set(key, {});
    const ga = gameAgg.get(key);
    ga[r.team] = ga[r.team] || { pass: 0, rush: 0, rec: 0, ptd: 0, rtd: 0, date: r.date, opp: r.opp };
    ga[r.team].pass += r.pyds; ga[r.team].rush += r.ryds; ga[r.team].rec += r.recyds;
    ga[r.team].ptd += r.ptd; ga[r.team].rtd += r.rtd;
  }
  // lo que cada defensa permitió = lo que produjo su rival en ese juego
  for (const [gameId, teams] of gameAgg) {
    for (const t in teams) {
      const opp = teams[t].opp;
      if (!teamGames.has(opp)) teamGames.set(opp, []);
      teamGames.get(opp).push({ gameId, date: teams[t].date, allowed: teams[t] });
    }
  }
  for (const arr of teamGames.values()) arr.sort((a, b) => new Date(a.date) - new Date(b.date));

  // cv por posición/stat: sd/mu de jugadores con ≥8 juegos calificados
  const cv = { ...CV_DEFAULT };
  const acc = {};
  for (const [, list] of byPlayer) {
    const pos = list[list.length - 1].pos;
    const q = list.filter(r => (QUALIFY[pos] || QUALIFY.WR)(r));
    if (q.length < 8) continue;
    const stats = statsFor(pos);
    for (const s of stats) {
      const vals = q.map(r => STAT_GET[s](r));
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (mu < 1) continue;
      const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / (vals.length - 1));
      acc[s] = acc[s] || [];
      acc[s].push(sd / mu);
    }
  }
  for (const s in acc) {
    const a = acc[s].sort((x, y) => x - y);
    cv[s] = a[Math.floor(a.length / 2)]; // mediana: robusta
  }
  return { byPlayer, teamGames, cv };
}

/* stats por posición y cómo leerlas de una fila */
const STAT_GET = {
  pass_yds: r => r.pyds, pass_tds: r => r.ptd, pass_completions: r => r.cmp,
  rush_yds: r => r.ryds, reception_yds: r => r.recyds, receptions: r => r.rec,
  anytime_td: r => r.rtd + r.rectd,
};
const DEF_CAT = { pass_yds: 'pass', pass_completions: 'pass', pass_tds: 'pass', rush_yds: 'rush', reception_yds: 'rec', receptions: 'rec', anytime_td: null };
function statsFor(pos) {
  if (pos === 'QB') return ['pass_yds', 'pass_tds', 'pass_completions', 'rush_yds'];
  if (pos === 'RB') return ['rush_yds', 'receptions', 'reception_yds', 'anytime_td'];
  return ['reception_yds', 'receptions', 'anytime_td'];
}

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/* Factor de defensa rival para una categoría, con juegos ANTERIORES a
   la fecha: (permitido/juego del rival ÷ promedio de liga), encogido. */
function defenseFactor(idx, opp, cat, beforeDate) {
  if (!cat) return 1;
  const cut = new Date(beforeDate).getTime();
  const games = (idx.teamGames.get(opp) || []).filter(g => new Date(g.date).getTime() < cut).slice(-P.DEF_GAMES);
  if (games.length < 4) return 1;
  const oppAvg = games.reduce((s, g) => s + g.allowed[cat], 0) / games.length;
  // liga: promedio de lo permitido por todas las defensas en la misma ventana
  let tot = 0, n = 0;
  for (const arr of idx.teamGames.values()) {
    const w = arr.filter(g => new Date(g.date).getTime() < cut).slice(-P.DEF_GAMES);
    for (const g of w) { tot += g.allowed[cat]; n++; }
  }
  if (!n) return 1;
  const f = 1 + P.DEF_SHRINK * (oppAvg / (tot / n) - 1);
  return Math.max(P.DEF_CLAMP[0], Math.min(P.DEF_CLAMP[1], f));
}

/* Proyección de un jugador para un juego.
   ctx: { date, opp, expPts (puntos esperados de SU equipo hoy) } */
function projectPlayer(idx, playerId, pos, ctx) {
  const all = (idx.byPlayer.get(playerId) || []);
  const cut = new Date(ctx.date).getTime();
  const qual = QUALIFY[pos] || QUALIFY.WR;
  const hist = all.filter(r => new Date(r.date).getTime() < cut && qual(r)).slice(-P.MAX_GAMES);
  if (hist.length < P.MIN_GAMES) return null;

  // pesos por recencia (el más reciente al final)
  const n = hist.length;
  const w = hist.map((_, i) => Math.pow(0.5, (n - 1 - i) / P.HALF_LIFE_GAMES));
  const W = w.reduce((a, b) => a + b, 0);
  const wmean = f => hist.reduce((s, r, i) => s + w[i] * f(r), 0) / W;
  const wsd = (f, mu) => Math.sqrt(Math.max(0, hist.reduce((s, r, i) => s + w[i] * (f(r) - mu) ** 2, 0) / W) * (n / Math.max(1, n - 1)));

  // entorno: puntos esperados hoy vs lo que su equipo anotó en la muestra
  const teamAvgPts = wmean(r => r.teamPts);
  let fEnv = 1;
  if (ctx.expPts != null && teamAvgPts > 5) {
    fEnv = Math.pow(ctx.expPts / teamAvgPts, P.ENV_EXP);
    fEnv = Math.max(P.ENV_CLAMP[0], Math.min(P.ENV_CLAMP[1], fEnv));
  }

  // ¿cambió de equipo? (menos de 4 juegos calificados con el actual):
  // su historial describe OTRA ofensiva — el llamador topa el veredicto
  const withTeam = ctx.team ? hist.filter(r => r.team === ctx.team).length : n;
  const out = { games: n, f_env: +fEnv.toFixed(3), team_changed: withTeam < 4, markets: {} };
  for (const s of statsFor(pos)) {
    const get = STAT_GET[s];
    const mu0 = wmean(get);
    // QB corredor: solo si de verdad corre
    if (s === 'rush_yds' && pos === 'QB' && wmean(r => r.ratt) < 4) continue;
    const fDef = defenseFactor(idx, ctx.opp, DEF_CAT[s], ctx.date);
    if (s === 'pass_tds' || s === 'anytime_td') {
      // encogimiento de la tasa hacia el prior de la posición
      const prior = s === 'pass_tds' ? TD_PRIOR.pass_tds : (TD_PRIOR.anytime_td[pos] || TD_PRIOR.anytime_td.WR);
      const kTd = n / (n + P.TD_SHRINK_N);
      const rate = kTd * mu0 + (1 - kTd) * prior;
      const lam = Math.max(0.02, rate * fEnv * (s === 'pass_tds' ? Math.sqrt(fDef) : 1));
      out.markets[s] = { type: 'poisson', mu: +lam.toFixed(3), f_def: +fDef.toFixed(3) };
      continue;
    }
    const mu = mu0 * fEnv * fDef;
    const sdOwn = wsd(get, mu0) * fEnv * fDef;
    const sdPos = (idx.cv[s] || CV_DEFAULT[s] || 0.5) * mu;
    const k = n / (n + P.SD_SHRINK_N);
    const sd = Math.sqrt(k * sdOwn ** 2 + (1 - k) * sdPos ** 2);
    out.markets[s] = { type: 'mix', w_ln: P.MIX_LN[s] != null ? P.MIX_LN[s] : 0.6, mu: +mu.toFixed(1), sd: +Math.max(1, sd).toFixed(1), f_def: +fDef.toFixed(3) };
  }
  return out;
}

/* P(stat > line) según la distribución del mercado. */
function probOver(m, line) {
  if (!m || line == null) return null;
  if (m.type === 'normal') return 1 - normCdf((line - m.mu) / m.sd);
  if (m.type === 'lognormal' || m.type === 'mix') {
    // lognormal por momentos: misma media y sd, con sesgo a la derecha
    let pLn = 1;
    if (line > 0) {
      const cv2 = (m.sd / m.mu) ** 2;
      const s2 = Math.log(1 + cv2);
      const mLog = Math.log(m.mu) - s2 / 2;
      pLn = 1 - normCdf((Math.log(line) - mLog) / Math.sqrt(s2));
    }
    if (m.type === 'lognormal') return pLn;
    const w = m.w_ln != null ? m.w_ln : 0.6;
    const pN = 1 - normCdf((line - m.mu) / m.sd);
    return w * pLn + (1 - w) * pN;
  }
  // poisson: P(X > line) = 1 − P(X ≤ floor(line))
  let p = 0, term = Math.exp(-m.mu);
  const k = Math.floor(line);
  for (let i = 0; i <= k; i++) { p += term; term *= m.mu / (i + 1); }
  return 1 - p;
}
/* anytime TD: P(≥1) */
function probAtLeastOne(m) { return m ? 1 - Math.exp(-m.mu) : null; }

module.exports = {
  loadHistory, buildIndex, projectPlayer, probOver, probAtLeastOne, statsFor, expand,
  QUALIFY, STAT_GET, normCdf, PARAMS: P, TD_PRIOR,
};
