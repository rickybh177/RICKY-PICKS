/* ============================================================
   PRIORS LALIGA — 2026-27
   ARCHIVO GENERADO por scripts/build-euro-priors.js el 2026-09-05
   con 1520 partidos de esp.1 (2022-07-01 → 2026-07-31,
   decaimiento de 500 días, shotsW 0). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: 0.0818,        // log-goles base por equipo
  hfa: 0.2908,       // ventaja de local (log)
  rho: 0.015,       // corrección Dixon-Coles de marcadores bajos
  conversion: 0.315,   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: 1.491,
  avg_away_goals: 1.126,
  draw_rate: 0.254,
  fit_games: 1520,
  corners_home: 5.47,
  corners_away: 4.25,
  promoted_anchor: { att: -0.1488, def: 0.101 },
};

/* ratings iniciales de la plantilla 2026-27 (20 equipos) */
const PRIORS = {
  "83": {
    "att": 0.6231,
    "def": -0.2835
  },
  "85": {
    "att": 0.1215,
    "def": 0.0032
  },
  "86": {
    "att": 0.4779,
    "def": -0.3352
  },
  "87": {
    "att": -0.1488,
    "def": 0.101
  },
  "88": {
    "att": -0.0614,
    "def": 0.0488
  },
  "89": {
    "att": 0.0775,
    "def": -0.0156
  },
  "90": {
    "att": -0.1488,
    "def": 0.101
  },
  "93": {
    "att": 0.0466,
    "def": -0.1301
  },
  "94": {
    "att": -0.0365,
    "def": -0.0154
  },
  "96": {
    "att": -0.1059,
    "def": -0.0156
  },
  "97": {
    "att": -0.0313,
    "def": -0.0251
  },
  "99": {
    "att": -0.1488,
    "def": 0.101
  },
  "101": {
    "att": -0.1504,
    "def": -0.1237
  },
  "102": {
    "att": 0.3794,
    "def": -0.0198
  },
  "243": {
    "att": -0.0237,
    "def": 0.0731
  },
  "244": {
    "att": 0.165,
    "def": -0.075
  },
  "1068": {
    "att": 0.3139,
    "def": -0.2307
  },
  "1538": {
    "att": 0.0295,
    "def": 0.1174
  },
  "2922": {
    "att": -0.2743,
    "def": -0.2165
  },
  "3751": {
    "att": -0.0033,
    "def": 0.1005
  }
};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = {
  "83": {
    "f": 1.336,
    "a": 0.941
  },
  "85": {
    "f": 0.826,
    "a": 0.971
  },
  "86": {
    "f": 1.241,
    "a": 0.808
  },
  "87": {
    "f": 0.95,
    "a": 1.05
  },
  "88": {
    "f": 0.971,
    "a": 0.997
  },
  "89": {
    "f": 1.121,
    "a": 0.941
  },
  "90": {
    "f": 0.95,
    "a": 1.05
  },
  "93": {
    "f": 1.147,
    "a": 0.838
  },
  "94": {
    "f": 1.048,
    "a": 0.988
  },
  "96": {
    "f": 1.04,
    "a": 1.036
  },
  "97": {
    "f": 0.821,
    "a": 0.993
  },
  "99": {
    "f": 0.95,
    "a": 1.05
  },
  "101": {
    "f": 1.138,
    "a": 1.066
  },
  "102": {
    "f": 0.89,
    "a": 1.01
  },
  "243": {
    "f": 0.993,
    "a": 0.95
  },
  "244": {
    "f": 0.95,
    "a": 1.053
  },
  "1068": {
    "f": 1.267,
    "a": 0.907
  },
  "1538": {
    "f": 0.907,
    "a": 1.173
  },
  "2922": {
    "f": 0.911,
    "a": 0.963
  },
  "3751": {
    "f": 0.834,
    "a": 0.946
  }
};

/* calibración del runtime (misma que usa scripts/euro-backtest.js) */
const CAL = {
  "halfLife": 500,
  "shotsW": 0,
  "sgdK": 0.025,
  "sgdCap": 2.2,
  "muShiftN": 80,
  "muShiftCap": 0.08,
  "mktBlend": 0.45,
  "x2Floor": 0.35,
  "restDays": 4.5,
  "restMult": 0.97,
  "dcBet": 0.76,
  "dcMaybe": 0.7,
  "bttsBet": 0.6,
  "bttsMaybe": 0.58
};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
