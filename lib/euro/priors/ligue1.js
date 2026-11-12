/* ============================================================
   PRIORS LIGUE 1 — 2026-27
   ARCHIVO GENERADO por scripts/build-euro-priors.js el 2026-11-12
   con 1297 partidos de fra.1 (2022-07-01 → 2026-07-31,
   decaimiento de 365 días, shotsW 0). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: 0.2202,        // log-goles base por equipo
  hfa: 0.184,       // ventaja de local (log)
  rho: -0.04,       // corrección Dixon-Coles de marcadores bajos
  conversion: 0.319,   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: 1.53,
  avg_away_goals: 1.297,
  draw_rate: 0.238,
  fit_games: 1297,
  corners_home: 5.37,
  corners_away: 4.26,
  promoted_anchor: { att: -0.112, def: 0.1544 },
};

/* ratings iniciales de la plantilla 2026-27 (18 equipos) */
const PRIORS = {
  "160": {
    "att": 0.5066,
    "def": -0.3405
  },
  "166": {
    "att": 0.1008,
    "def": -0.2821
  },
  "167": {
    "att": 0.2046,
    "def": -0.0933
  },
  "169": {
    "att": 0.211,
    "def": -0.0145
  },
  "170": {
    "att": -0.0569,
    "def": 0.1694
  },
  "172": {
    "att": -0.1213,
    "def": -0.0769
  },
  "174": {
    "att": 0.2905,
    "def": -0.0041
  },
  "175": {
    "att": 0.2012,
    "def": -0.258
  },
  "176": {
    "att": 0.2985,
    "def": -0.0686
  },
  "179": {
    "att": 0.0207,
    "def": -0.0639
  },
  "180": {
    "att": 0.1622,
    "def": -0.0418
  },
  "273": {
    "att": 0.0405,
    "def": 0.0342
  },
  "2502": {
    "att": -0.0027,
    "def": -0.0254
  },
  "2697": {
    "att": -0.112,
    "def": 0.1544
  },
  "3236": {
    "att": -0.2045,
    "def": 0.0208
  },
  "6851": {
    "att": 0.0491,
    "def": -0.0408
  },
  "6997": {
    "att": 0.0243,
    "def": 0.051
  },
  "7868": {
    "att": -0.3414,
    "def": 0.0224
  }
};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = {
  "160": {
    "f": 1.251,
    "a": 0.737
  },
  "166": {
    "f": 1.143,
    "a": 0.836
  },
  "167": {
    "f": 1.176,
    "a": 1.025
  },
  "169": {
    "f": 1.19,
    "a": 0.968
  },
  "170": {
    "f": 0.95,
    "a": 1.05
  },
  "172": {
    "f": 0.996,
    "a": 0.992
  },
  "174": {
    "f": 1.039,
    "a": 0.921
  },
  "175": {
    "f": 1.228,
    "a": 0.893
  },
  "176": {
    "f": 1.062,
    "a": 0.808
  },
  "179": {
    "f": 0.952,
    "a": 1.049
  },
  "180": {
    "f": 0.907,
    "a": 0.973
  },
  "273": {
    "f": 0.794,
    "a": 1.091
  },
  "2502": {
    "f": 1.044,
    "a": 1.147
  },
  "2697": {
    "f": 0.95,
    "a": 1.05
  },
  "3236": {
    "f": 0.911,
    "a": 1.001
  },
  "6851": {
    "f": 0.93,
    "a": 1.124
  },
  "6997": {
    "f": 0.845,
    "a": 1.166
  },
  "7868": {
    "f": 0.798,
    "a": 1.062
  }
};

/* calibración del runtime (misma que usa scripts/euro-backtest.js) */
const CAL = {
  "halfLife": 365,
  "shotsW": 0,
  "sgdK": 0.025,
  "sgdCap": 2.2,
  "muShiftN": 80,
  "muShiftCap": 0.08,
  "mktBlend": 0.45,
  "x2Floor": 0.35,
  "restDays": 4.5,
  "restMult": 0.97,
  "dcBet": 0.8,
  "dcMaybe": 0.74,
  "bttsBet": 0.555,
  "bttsMaybe": 0.535
};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
