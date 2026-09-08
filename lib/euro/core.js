/* ============================================================
   EUROPA — núcleo del modelo (funciones puras, sin I/O).

   ESTE ARCHIVO LO COMPARTEN EL BACKTEST Y EL RUNTIME:
   scripts/euro-backtest.js y lib/euro/model.js importan de aquí
   las mismas lambdas, el mismo paso de aprendizaje (sgdUpdate) y
   la misma corrección global del entorno goleador (muShift). Así
   lo que se mide en el backtest es EXACTAMENTE lo que corre en
   producción: no hay dos copias de la fórmula que puedan
   divergir en silencio. Si hay que cambiar cómo aprende el
   modelo, se cambia aquí y se vuelve a correr el backtest.

   Modelo por partido (Dixon-Coles, sin altitud — es Europa):
     λ_local  = exp(mu + hfa + att[h] + def[a])
     λ_visita = exp(mu +       att[a] + def[h])
   att = fuerza ofensiva, def = DEBILIDAD defensiva (positivo =
   concede más). Todo indexado por id de equipo de ESPN (string).

   Lo que entra: ratings R = { '<id>': {att, def} }, un juego g con
   home.id / away.id / home.score / away.score (y opcionalmente
   home.sot / away.sot para el aprendizaje por tiros a puerta),
   los parámetros de liga LG = { mu, hfa, rho, conversion } y la
   calibración CAL (lib/euro/priors/<liga>.js).

   También vive aquí el EV contra el mercado (evVerdict, ev1x2,
   evTotal): el backtest lo mide contra cierres reales con la MISMA
   función y el mismo encogimiento (mktBlend) y piso (x2Floor) que
   el runtime, así lo que se reporta como ROI es lo que se publica.
   ============================================================ */

const { amToProb, devig } = require('../mx/engine');

/* Calibración por defecto: la que se hornea en los priors si el
   script no recibe banderas. build-euro-priors.js la importa de
   aquí para que haya UNA sola fuente de verdad. */
const DEFAULT_CAL = {
  halfLife: 365,     // días para que un partido pese la mitad en el fit
  shotsW: 0,         // peso de los tiros a puerta en el objetivo (0 = goles puros)
  sgdK: 0.025,       // qué tanto aprende de cada resultado (estilo Elo)
  sgdCap: 2.2,       // sorpresa máxima que se aprende por juego (goles)
  muShiftN: 80,      // encogimiento de la corrección goleadora de liga
  muShiftCap: 0.08,  // tope de esa corrección (log)
  /* EV contra el mercado. Medido el 5-sep-2026 con cierres reales
     (euro-backtest 24-25 y 25-26, 3 ligas): el consenso de cierre
     tiene MEJOR Brier que el modelo en las seis temporadas y con el
     blend 0.22 / piso 0.2 heredados de Liga MX los BET del 1X2
     perdían en todas (−5% a −26% de ROI). Se sube el encogimiento y
     el piso: fuera empates y underdogs largos, ~70% menos BETs. Con
     esto el sangrado baja pero NO se vuelve positivo — ver el
     backtest antes de abrir el 1X2 con EV al público. */
  mktBlend: 0.45,    // encogimiento de la prob hacia el mercado para el EV
  x2Floor: 0.35,     // prob (ya encogida) mínima para dar BET/MAYBE en el 1X2
  restDays: 4.5,     // menos de esto entre juegos = descanso corto
  restMult: 0.97,    // descanso corto: −3% de goles esperados
  dcBet: 0.76,       // barras de la doble oportunidad
  dcMaybe: 0.70,
  bttsBet: 0.555,    // barras de ambos anotan
  bttsMaybe: 0.535,
};
const MU_PSEUDO_GOALS = 8;          // pseudo-goles: un 0-0 temprano no mueve la liga entera
const LAM_MIN = 0.15, LAM_MAX = 4.2; // tope de goles esperados por lado

function withDefaults(cal) {
  return { ...DEFAULT_CAL, ...(cal || {}) };
}

/* Nivel goleador y localía que aplican a UN juego. Por defecto los
   de la liga (LG.mu, LG.hfa). Un modelo de COPA (Champions) aprende
   también de partidos de OTRA competencia — la liga doméstica de
   cada club — y esos juegos vienen etiquetados con g.comp ('dom');
   LG.comps trae el mu/hfa de esa competencia (comps.dom), porque el
   entorno goleador y la ventaja de local de una liga no son los de
   la Champions. Sede neutral (la final europea): sin localía. Para
   las ligas normales (sin comp ni comps) es exactamente LG.mu /
   LG.hfa, como siempre. */
function levelOf(LG, g) {
  const c = g.comp && LG.comps ? LG.comps[g.comp] : null;
  return {
    mu: c && c.mu != null ? c.mu : LG.mu,
    hfa: g.neutral ? 0 : (c && c.hfa != null ? c.hfa : LG.hfa),
    /* escala de las diferencias de rating (LG.scale, default 1): en el
       ajuste conjunto de la Champions la regularización encoge las
       diferencias ENTRE ligas (solo las identifican los partidos
       europeos) y el favorito sale subestimado; la escala europea las
       re-expande (lib/euro/fit.js, paso 3). Las ligas normales no la
       traen → 1. Un comp con override usa la suya (o 1). */
    scale: c ? (c.scale != null ? c.scale : 1) : (LG.scale != null ? LG.scale : 1),
  };
}

/* goles esperados de UN partido con los ratings R dados */
function lambdas(R, g, LG) {
  const rh = R[g.home.id], ra = R[g.away.id];
  if (!rh || !ra) return null;
  const { mu, hfa, scale } = levelOf(LG, g);
  const lh = Math.exp(mu + hfa + scale * (rh.att + ra.def));
  const la = Math.exp(mu + scale * (ra.att + rh.def));
  return { lh, la };
}

const clampLambda = l => Math.min(LAM_MAX, Math.max(LAM_MIN, l));

/* Objetivo de aprendizaje de UN lado: goles reales mezclados con
   los goles "merecidos" según tiros a puerta (sot × conversión de
   liga), topados a goles+2.5 para que un 0-3 con 12 tiros a puerta
   no se vuelva un 4-3. Con shotsW=0 o sin estadística, es el gol
   real. La MISMA fórmula la usa el fit (lib/euro/fit.js), por eso
   vive aquí. */
function blendTarget(goals, sot, conversion, shotsW) {
  if (!shotsW || sot == null || !conversion) return goals;
  const deserved = Math.min(goals + 2.5, sot * conversion);
  return (1 - shotsW) * goals + shotsW * deserved;
}

/* objetivos de los dos lados de un juego terminado */
function targetsOf(g, learn) {
  const shotsW = learn ? learn.shotsW : 0;
  const conv = learn ? learn.conversion : null;
  return {
    th: blendTarget(g.home.score, g.home.sot, conv, shotsW),
    ta: blendTarget(g.away.score, g.away.sot, conv, shotsW),
  };
}

/* paso de aprendizaje con UN resultado (gradiente Poisson, capado).
   learn = { shotsW, conversion } opcional; sin él aprende de goles. */
function sgdUpdate(R, g, LG, k = DEFAULT_CAL.sgdK, cap = DEFAULT_CAL.sgdCap, learn = null) {
  if (g.home.score == null || g.away.score == null) return false;
  const L = lambdas(R, g, LG);
  if (!L) return false;
  const { th, ta } = targetsOf(g, learn);
  const dH = Math.max(-cap, Math.min(cap, th - L.lh));
  const dA = Math.max(-cap, Math.min(cap, ta - L.la));
  R[g.home.id].att += k * dH;
  R[g.away.id].def += k * dH;
  R[g.away.id].att += k * dA;
  R[g.home.id].def += k * dA;
  return true;
}

/* Corrección GLOBAL del entorno goleador. Si la temporada anota
   más/menos de lo que la historia decía, el nivel de liga se
   corrige solo, encogido con n/(n+muShiftN) y topado. acc lleva
   los acumulados de la temporada EN CURSO nada más:
   { obs, pred, n, muShift }. Devuelve el muShift nuevo. */
function muShiftStep(acc, L, g, cal) {
  const C = withDefaults(cal);
  acc.obs += g.home.score + g.away.score;
  acc.pred += L.lh + L.la;
  acc.n++;
  const raw = Math.log((acc.obs + MU_PSEUDO_GOALS) / (acc.pred + MU_PSEUDO_GOALS)) * (acc.n / (acc.n + C.muShiftN));
  acc.muShift = Math.max(-C.muShiftCap, Math.min(C.muShiftCap, raw));
  return acc.muShift;
}

/* Recorre los resultados en orden cronológico aplicando el ciclo
   completo del runtime por juego:
     1. LGdyn = liga con el muShift vigente
     2. onPredict(g, R, LGdyn)   ← el backtest registra aquí su
        predicción ANTES de que el modelo vea el marcador
     3. muShiftStep con los goles reales
     4. sgdUpdate con el mismo LGdyn
   Juegos con un equipo desconocido en R se saltan (no se inventan
   ratings a media temporada; los priors deben traer a todos). */
function replayResults(results, priors, LG, cal, onPredict) {
  const C = withDefaults(cal);
  const R = {};
  for (const t in priors) R[t] = { att: priors[t].att, def: priors[t].def };
  const learn = C.shotsW > 0 ? { shotsW: C.shotsW, conversion: LG.conversion } : null;
  const sorted = [...results]
    .filter(g => g.home.score != null && g.away.score != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const acc = { obs: 0, pred: 0, n: 0, muShift: 0 };
  let learned = 0;
  for (const g of sorted) {
    if (!R[g.home.id] || !R[g.away.id]) continue;
    /* muShift corrige el entorno goleador de LA competencia que se
       predice. Si LG.muShiftComp está definido (copa que aprende
       también de ligas domésticas), solo los juegos de esa
       competencia lo alimentan y lo reciben; los demás entran con su
       propio nivel (LG.comps) tal cual. Sin muShiftComp: todos, como
       siempre. */
    const shifts = !LG.muShiftComp || g.comp === LG.muShiftComp;
    const LGdyn = shifts ? { ...LG, mu: LG.mu + acc.muShift } : LG;
    if (onPredict) onPredict(g, R, LGdyn);
    const L = lambdas(R, g, LGdyn);
    if (shifts) muShiftStep(acc, L, g, C);
    sgdUpdate(R, g, LGdyn, C.sgdK, C.sgdCap, learn);
    learned++;
  }
  return { R, muShift: +acc.muShift.toFixed(4), learned };
}

/* ratings vigentes: priors + todos los resultados de la temporada */
function currentRatings(results, priors, LG, cal) {
  return replayResults(results, priors, LG, cal, null);
}

/* ---- descanso: días desde el último juego de liga ---- */
function restInfo(lastMs, kickoffISO, cal) {
  const C = withDefaults(cal);
  if (!lastMs) return { mult: 1, note: null };
  const days = (new Date(kickoffISO).getTime() - lastMs) / 86400000;
  // restMult 1 = ajuste apagado (Champions: TODOS juegan entre semana
  // tras la liga del fin de semana, el corto descanso ya vive en el
  // nivel ajustado de la competencia) — sin nota tampoco
  if (days < C.restDays && C.restMult < 1) return { mult: C.restMult, note: 'jornada entre semana (descanso corto)' };
  return { mult: 1, note: null };
}

/* ============================================================
   EV CONTRA EL MERCADO (mismo código en runtime y backtest)
   ============================================================ */

/* Barras de EV con momios reales (las de Liga MX). El piso del 1X2
   sale de CAL (x2Floor) porque se calibra por liga en el backtest
   contra cierres; los de totales y BTTS son constantes. Se publican
   en ev_params para que la página replique el cálculo con los
   momios del usuario sin copiar constantes a mano. */
const EV_BARS = {
  x2: { bet: 0.03, maybe: 0.01 },
  total: { bet: 0.025, maybe: 0.01, floor: 0.3 },
  btts: { bet: 0.025, maybe: 0.01, floor: 0.2 },
};
function evBars(cal) {
  const C = withDefaults(cal);
  return { x2: { ...EV_BARS.x2, floor: C.x2Floor }, total: { ...EV_BARS.total }, btts: { ...EV_BARS.btts } };
}

/* Con momios reales el EV se calcula sobre una prob ENCOGIDA hacia
   el mercado (blend = CAL.mktBlend): la línea de cierre trae
   información que el modelo no tiene (lesiones, rotaciones, dinero
   informado) y sin el encogimiento el modelo regala BETs de +20% de
   EV en underdogs. La prob que se MUESTRA sigue siendo la del
   modelo; el piso (bars.floor) también se aplica a la encogida. */
function evVerdict(p, amOdds, pMarket, bars, blend) {
  if (p == null || amOdds == null) return { verdict: 'skip', ev: null };
  const imp = amToProb(amOdds);
  if (imp == null) return { verdict: 'skip', ev: null };
  const pb = pMarket != null ? (1 - blend) * p + blend * pMarket : p;
  const dec = 1 / imp;
  const ev = pb * dec - 1;
  let verdict = 'skip';
  if (pb >= bars.floor && ev >= bars.bet) verdict = 'bet';
  else if (pb >= bars.floor && ev >= bars.maybe) verdict = 'maybe';
  return { verdict, ev: +ev.toFixed(3) };
}

/* 1X2 contra el consenso: devig de los tres momios y EV de cada
   resultado. p3 = [local, empate, visita] del modelo; am3 = momios
   americanos en el mismo orden. Devuelve [{ ev, verdict, imp }] o
   null si falta algún momio (entonces no hay precio que ganar). */
function ev1x2(p3, am3, cal) {
  if (!am3 || am3.length !== 3 || am3.some(a => a == null)) return null;
  const raw = am3.map(amToProb);
  if (raw.some(x => x == null)) return null;
  const C = withDefaults(cal);
  const imp = devig(raw);
  const bars = evBars(C).x2;
  return p3.map((p, i) => ({ ...evVerdict(p, am3[i], imp[i], bars, C.mktBlend), imp: imp[i] }));
}

/* Índice del resultado con VALOR: el mayor EV entre los que no son
   skip (en empate, el primero: local > empate > visita), o -1 si
   ninguno. Es la regla con la que el runtime elige qué 1X2 mostrar. */
function bestValueIndex(evs) {
  let best = -1;
  evs.forEach((e, i) => { if (e.verdict !== 'skip' && (best < 0 || e.ev > evs[best].ev)) best = i; });
  return best;
}

/* Total de goles contra el consenso: el lado que favorece el modelo
   (over si pOver ≥ 0.5) y su EV contra el precio de ESE lado, con la
   prob del mercado sacada del par over/under sin vig. Sin momios
   devuelve verdict null (el caller decide el tope sin precio). */
function evTotal(pOver, amOver, amUnder, cal) {
  const side = pOver >= 0.5 ? 'over' : 'under';
  const p = side === 'over' ? pOver : 1 - pOver;
  const am = side === 'over' ? amOver : amUnder;
  const rawO = amOver != null ? amToProb(amOver) : null, rawU = amUnder != null ? amToProb(amUnder) : null;
  if (rawO == null || rawU == null) return { side, p, am: null, ev: null, verdict: null, imp: null };
  const C = withDefaults(cal);
  const [dO, dU] = devig([rawO, rawU]);
  const imp = side === 'over' ? dO : dU;
  const v = evVerdict(p, am, imp, evBars(C).total, C.mktBlend);
  return { side, p, am, ev: v.ev, verdict: v.verdict, imp };
}

module.exports = {
  DEFAULT_CAL, MU_PSEUDO_GOALS, LAM_MIN, LAM_MAX,
  withDefaults, levelOf, lambdas, clampLambda, blendTarget, targetsOf,
  sgdUpdate, muShiftStep, replayResults, currentRatings, restInfo,
  EV_BARS, evBars, evVerdict, ev1x2, bestValueIndex, evTotal,
};
