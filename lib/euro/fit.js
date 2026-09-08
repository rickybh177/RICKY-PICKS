/* ============================================================
   EUROPA — ajuste Dixon-Coles con decaimiento temporal.
   Usado SOLO por scripts (build-euro-priors, euro-backtest);
   nunca se carga en runtime del API. Generaliza lib/mx/fit.js:
   sin altitud (Europa es plana para estos fines), equipos por id
   de ESPN, liga sin liguilla (solo jornadas), y objetivo opcional
   mezclado con tiros a puerta.

   Modelo por partido:
     λ_local  = exp(mu + hfa + att[h] + def[a])
     λ_visita = exp(mu +       att[a] + def[h])
   att = fuerza ofensiva (goles que mete), def = DEBILIDAD
   defensiva (goles que concede; positivo = defensa mala). rho
   corrige los marcadores bajos (0-0, 1-0, 0-1, 1-1) al estilo
   Dixon-Coles.

   Ajuste en dos pasos (estándar):
   1. att/def por Fisher scoring sobre la log-verosimilitud Poisson
      ponderada por recencia; mu y hfa en FORMA CERRADA en cada
      iteración (la lección de Liga MX: moverlos por gradiente
      junto con att/def diverge por colinealidad).
   2. rho por búsqueda en malla sobre la verosimilitud DC completa
      con las lambdas fijas — siempre con goles REALES, aunque el
      paso 1 haya usado objetivos mezclados con tiros.

   Objetivo por lado (shotsW en [0,1]): con estadística del juego,
   (1−shotsW)·goles + shotsW·min(goles+2.5, sot·conversión); sin
   ella, goles. Las ecuaciones de score Poisson aceptan objetivos
   fraccionarios sin problema. La fórmula vive en lib/euro/core.js
   (blendTarget) para que el runtime aprenda con la misma.

   Ancla de ascendidos SALIDA DE LOS DATOS: los equipos que
   aparecen por primera vez después de la primera temporada de la
   ventana son, por construcción, recién ascendidos; el promedio
   de sus att/def ajustados es el perfil típico del que sube.
   Respaldo si no hay ninguno: {att:-0.25, def:0.15}.
   ============================================================ */

const { blendTarget } = require('./core');

const HALF_LIFE_DAYS = 365;   // una temporada atrás pesa ½; plantillas rotan cada verano
const REG_W = 8;              // pseudo-partidos hacia el ancla (regresión a la media)
const LOW_EVIDENCE_W = 3;     // con menos peso que esto, el equipo se ancla como ascendido
const FALLBACK_ANCHOR = { att: -0.25, def: 0.15 };
const CONV_MIN = 0.25, CONV_MAX = 0.45; // goles por tiro a puerta, rango sano

function gameWeight(g, asOfMs, halfLife) {
  const days = Math.max(0, (asOfMs - new Date(g.date).getTime()) / 86400000);
  return Math.pow(0.5, days / (halfLife || HALF_LIFE_DAYS));
}

/* goles por tiro a puerta sobre los juegos con estadística */
function conversionOf(games) {
  let goals = 0, sot = 0;
  for (const g of games) {
    if (g.home.sot == null || g.away.sot == null) continue;
    goals += g.home.score + g.away.score;
    sot += g.home.sot + g.away.sot;
  }
  if (!sot) return null;
  return Math.min(CONV_MAX, Math.max(CONV_MIN, goals / sot));
}

/* Un ajuste completo (paso 1 + paso 2) con las anclas dadas.
   lowAnchor = ancla para equipos con poca evidencia. */
function solve(rows, teams, lowAnchor, iters) {
  const att = {}, def = {}, anchorAtt = {}, anchorDef = {}, wSum = {};
  for (const t of teams) { att[t] = 0; def[t] = 0; wSum[t] = 0; anchorAtt[t] = 0; anchorDef[t] = 0; }
  for (const r of rows) { wSum[r.h] += r.w; wSum[r.a] += r.w; }
  const lowEvidence = [];
  for (const t of teams) {
    if (wSum[t] < LOW_EVIDENCE_W) {
      lowEvidence.push(t);
      anchorAtt[t] = lowAnchor.att; anchorDef[t] = lowAnchor.def;
      att[t] = lowAnchor.att; def[t] = lowAnchor.def;
    }
  }

  /* Dos competencias en el mismo ajuste: 'dom' (ligas) y 'uefa'
     (Champions / Europa League / Conference). Comparten att/def — es
     lo que permite comparar un Bayern con un Liverpool: los partidos
     europeos son los puentes entre ligas — pero cada una tiene su
     nivel goleador y su localía: muU y hfaU son los desplazamientos
     de los juegos europeos respecto a mu/hfa doméstico. Sede neutral
     (r.n, la final): sin localía. Sin filas 'uefa' (las ligas
     normales) muU = 0 y todo queda exactamente como antes. */
  let mu = 0, hfa = 0.25, muU = 0, hfaU = 0.25;
  const muOf = r => mu + (r.c === 'uefa' ? muU : 0);
  const hfaOf = r => (r.n ? 0 : (r.c === 'uefa' ? hfaU : hfa));
  const lamH = r => Math.exp(muOf(r) + hfaOf(r) + att[r.h] + def[r.a]);
  const lamA = r => Math.exp(muOf(r) + att[r.a] + def[r.h]);

  /* mu y hfa en forma cerrada dados att/def: media ponderada
     predicha = media ponderada observada (del objetivo), por
     competencia. En sede neutral los dos lados cuentan como
     "visita" (sin localía). */
  const solveMuHfa = () => {
    const S = { dom: { th: 0, eh: 0, ta: 0, ea: 0 }, uefa: { th: 0, eh: 0, ta: 0, ea: 0 } };
    for (const r of rows) {
      const s = S[r.c === 'uefa' ? 'uefa' : 'dom'];
      const eh = Math.exp(att[r.h] + def[r.a]), ea = Math.exp(att[r.a] + def[r.h]);
      if (r.n) { s.ta += r.w * (r.th + r.ta); s.ea += r.w * (eh + ea); }
      else { s.th += r.w * r.th; s.eh += r.w * eh; s.ta += r.w * r.ta; s.ea += r.w * ea; }
    }
    const lg = (a, b) => Math.log(Math.max(1e-9, a / b));
    if (S.dom.ea > 0) {
      mu = lg(S.dom.ta, S.dom.ea);
      hfa = S.dom.eh > 0 ? lg(S.dom.th, S.dom.eh) - mu : hfa;
    } else { mu = lg(S.uefa.ta, S.uefa.ea); hfa = 0; } // solo juegos europeos (no pasa en la práctica)
    if (S.uefa.ea > 0) {
      muU = lg(S.uefa.ta, S.uefa.ea) - mu;
      hfaU = S.uefa.eh > 0 ? lg(S.uefa.th, S.uefa.eh) - mu - muU : hfaU;
    } else { muU = 0; hfaU = hfa; }
  };

  let itersUsed = 0, lastStep = 0;
  for (let it = 0; it < iters; it++) {
    itersUsed = it + 1;
    solveMuHfa();

    // att/def: Newton amortiguado por equipo (Fisher = Σw·λ + reg)
    const gAtt = {}, gDef = {}, fAtt = {}, fDef = {};
    for (const t of teams) { gAtt[t] = 0; gDef[t] = 0; fAtt[t] = 0; fDef[t] = 0; }
    for (const r of rows) {
      const lh = lamH(r), la = lamA(r);
      const rh = r.w * (r.th - lh), ra = r.w * (r.ta - la);
      const fh = r.w * lh, fa = r.w * la;
      gAtt[r.h] += rh; fAtt[r.h] += fh;
      gAtt[r.a] += ra; fAtt[r.a] += fa;
      gDef[r.a] += rh; fDef[r.a] += fh;
      gDef[r.h] += ra; fDef[r.h] += fa;
    }
    const prevAtt = { ...att }, prevDef = { ...def };
    for (const t of teams) {
      // regularización: REG_W pseudo-juegos empujando al ancla
      gAtt[t] -= REG_W * (att[t] - anchorAtt[t]); fAtt[t] += REG_W;
      gDef[t] -= REG_W * (def[t] - anchorDef[t]); fDef[t] += REG_W;
      att[t] += 0.5 * gAtt[t] / Math.max(1e-6, fAtt[t]);
      def[t] += 0.5 * gDef[t] / Math.max(1e-6, fDef[t]);
    }

    // identificabilidad: att y def centrados en 0 (el nivel vive en mu)
    const mA = teams.reduce((s, t) => s + att[t], 0) / teams.length;
    const mD = teams.reduce((s, t) => s + def[t], 0) / teams.length;
    for (const t of teams) { att[t] -= mA; def[t] -= mD; }
    mu += mA + mD;

    /* Convergencia medida DESPUÉS de centrar. Con equipos anclados a
       un valor distinto de 0 (ascendidos), la regularización mete un
       empuje común a todos los equipos que el centrado deshace en la
       misma iteración: el paso crudo nunca baja de ~1e-3 aunque los
       ratings ya no se muevan (Bundesliga con Hertha/Schalke 22-23). */
    let maxD = 0;
    for (const t of teams) maxD = Math.max(maxD, Math.abs(att[t] - prevAtt[t]), Math.abs(def[t] - prevDef[t]));
    lastStep = maxD;
    if (it > 20 && maxD < 1e-6) break;
  }
  solveMuHfa();

  /* ---- paso 2: rho por malla (verosimilitud DC completa, goles reales) ---- */
  const tau = (x, y, lh, la, rho) => {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  };
  let bestRho = 0, bestLL = -Infinity;
  for (let rho = -0.20; rho <= 0.08 + 1e-9; rho += 0.005) {
    let ll = 0, ok = true;
    for (const r of rows) {
      const lh = lamH(r), la = lamA(r);
      const t = tau(r.gh, r.ga, lh, la, rho);
      if (t <= 1e-9) { ok = false; break; }
      ll += r.w * Math.log(t);
    }
    if (ok && ll > bestLL) { bestLL = ll; bestRho = rho; }
  }

  /* ---- paso 3: ESCALA EUROPEA por malla (solo filas 'uefa') ----
     Con att/def fijos, busca s que maximiza la verosimilitud Poisson
     de los partidos europeos usando s·(att+def), re-resolviendo muU y
     hfaU en forma cerrada para cada s (el nivel y la localía
     europeos dependen de la escala). Sin filas 'uefa' → 1. */
  let scaleU = 1;
  const uefaRows = rows.filter(r => r.c === 'uefa');
  if (uefaRows.length) {
    let bestS = 1, bestLL = -Infinity;
    for (let sc = 0.8; sc <= 1.8 + 1e-9; sc += 0.05) {
      // muU/hfaU cerrados para esta escala
      let th = 0, eh = 0, ta = 0, ea = 0;
      for (const r of uefaRows) {
        const ehr = Math.exp(sc * (att[r.h] + def[r.a])), ear = Math.exp(sc * (att[r.a] + def[r.h]));
        if (r.n) { ta += r.w * (r.th + r.ta); ea += r.w * (ehr + ear); }
        else { th += r.w * r.th; eh += r.w * ehr; ta += r.w * r.ta; ea += r.w * ear; }
      }
      const muS = Math.log(Math.max(1e-9, ta / ea));                    // = mu + muU para esta escala
      const hfaS = eh > 0 ? Math.log(Math.max(1e-9, th / eh)) - muS : 0;
      let ll = 0;
      for (const r of uefaRows) {
        const lh = Math.exp(muS + (r.n ? 0 : hfaS) + sc * (att[r.h] + def[r.a]));
        const la = Math.exp(muS + sc * (att[r.a] + def[r.h]));
        ll += r.w * (r.th * Math.log(lh) - lh + r.ta * Math.log(la) - la);
      }
      if (ll > bestLL) { bestLL = ll; bestS = sc; }
    }
    scaleU = +bestS.toFixed(2);
    if (scaleU !== 1) {
      // dejar muU/hfaU coherentes con la escala elegida
      let th = 0, eh = 0, ta = 0, ea = 0;
      for (const r of uefaRows) {
        const ehr = Math.exp(scaleU * (att[r.h] + def[r.a])), ear = Math.exp(scaleU * (att[r.a] + def[r.h]));
        if (r.n) { ta += r.w * (r.th + r.ta); ea += r.w * (ehr + ear); }
        else { th += r.w * r.th; eh += r.w * ehr; ta += r.w * r.ta; ea += r.w * ear; }
      }
      const muS = Math.log(Math.max(1e-9, ta / ea));
      muU = muS - mu;
      hfaU = eh > 0 ? Math.log(Math.max(1e-9, th / eh)) - muS : hfaU;
    }
  }

  return { att, def, mu, hfa, muU, hfaU, scaleU, rho: bestRho, wSum, lowEvidence, itersUsed, lastStep };
}

/* games: juegos TERMINADOS (scripts/euro-history.js o data.js).
   asOf: ms (los juegos posteriores pesan como si fueran de hoy;
   quien llama debe filtrar por fecha para no filtrar el futuro).
   Devuelve { ratings: {id:{att,def}}, mu, hfa, rho, promotedAnchor,
   conversion, diag }. */
function fitDixonColes(games, { asOf, halfLife, shotsW = 0, iters = 300 } = {}) {
  const asOfMs = asOf || Date.now();
  const hl = halfLife || HALF_LIFE_DAYS;
  const done = games.filter(g => g.home && g.away && g.home.score != null && g.away.score != null
    && g.home.id && g.away.id && (g.completed == null || g.completed));
  if (!done.length) throw new Error('fitDixonColes: sin partidos');

  const conversion = conversionOf(done); // se reporta aunque shotsW sea 0 (el runtime puede activarlo)
  const rows = done.map(g => ({
    h: g.home.id, a: g.away.id,
    gh: g.home.score, ga: g.away.score,                          // goles reales (rho, diagnóstico)
    th: blendTarget(g.home.score, g.home.sot, conversion, shotsW), // objetivo del paso 1
    ta: blendTarget(g.away.score, g.away.sot, conversion, shotsW),
    w: gameWeight(g, asOfMs, hl),
    year: g.seasonYear != null ? g.seasonYear : new Date(g.date).getUTCFullYear(),
    c: g.comp === 'uefa' ? 'uefa' : 'dom',                          // competencia (ver solve)
    n: !!g.neutral,                                                 // sede neutral
  }));
  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))];

  /* ascendidos según los datos: primera aparición después de la
     primera temporada de la ventana */
  const firstYear = Math.min(...rows.map(r => r.year));
  const firstSeen = {};
  for (const r of rows) for (const t of [r.h, r.a]) {
    if (firstSeen[t] == null || r.year < firstSeen[t]) firstSeen[t] = r.year;
  }
  const promotedIds = teams.filter(t => firstSeen[t] > firstYear);

  // pasada 1: ancla de respaldo para equipos con poca evidencia
  let sol = solve(rows, teams, FALLBACK_ANCHOR, iters);
  let promotedAnchor = { ...FALLBACK_ANCHOR }, anchorSource = 'respaldo';
  if (promotedIds.length) {
    const n = promotedIds.length;
    promotedAnchor = {
      att: +(promotedIds.reduce((s, t) => s + sol.att[t], 0) / n).toFixed(4),
      def: +(promotedIds.reduce((s, t) => s + sol.def[t], 0) / n).toFixed(4),
    };
    anchorSource = `${n} ascendidos en la ventana`;
    // pasada 2 solo si algún equipo se ancla y el ancla cambió
    if (sol.lowEvidence.length) sol = solve(rows, teams, promotedAnchor, iters);
  }

  const ratings = {};
  for (const t of teams) ratings[t] = { att: +sol.att[t].toFixed(4), def: +sol.def[t].toFixed(4) };

  // diagnóstico
  let sumH = 0, sumA = 0, draws = 0, totW = 0, withStats = 0, uefaRows = 0;
  for (const r of rows) { sumH += r.gh; sumA += r.ga; totW += r.w; if (r.gh === r.ga) draws++; if (r.c === 'uefa') uefaRows++; }
  for (const g of done) if (g.home.sot != null && g.away.sot != null) withStats++;
  const diag = {
    games: rows.length,
    weightSum: +totW.toFixed(1),
    teams: teams.length,
    avg_home_goals: +(sumH / rows.length).toFixed(3),
    avg_away_goals: +(sumA / rows.length).toFixed(3),
    draw_rate: +(draws / rows.length).toFixed(3),
    games_with_stats: withStats,
    uefa_games: uefaRows,
    half_life: hl,
    shots_w: shotsW,
    iters: sol.itersUsed,
    last_step: +sol.lastStep.toExponential(2), // tamaño del último paso Newton (convergencia)
    promoted_ids: promotedIds,
    promoted_anchor_source: anchorSource,
    low_evidence_ids: sol.lowEvidence,
  };

  return {
    ratings,
    mu: +sol.mu.toFixed(4), hfa: +sol.hfa.toFixed(4), rho: +sol.rho.toFixed(3),
    muUefa: +sol.muU.toFixed(4), hfaUefa: +sol.hfaU.toFixed(4), // desplazamientos de los juegos europeos (0 / = hfa sin ellos)
    scaleUefa: sol.scaleU,                                       // escala de las diferencias de rating en Europa (1 sin juegos europeos)
    promotedAnchor,
    conversion: conversion != null ? +conversion.toFixed(3) : null,
    diag,
  };
}

module.exports = { fitDixonColes, gameWeight, conversionOf, HALF_LIFE_DAYS, REG_W, FALLBACK_ANCHOR };
