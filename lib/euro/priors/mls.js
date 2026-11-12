/* ============================================================
   PRIORS MLS — 2026
   ARCHIVO GENERADO por scripts/build-euro-priors.js el 2026-11-12
   con 2034 partidos de usa.1 (2022-02-01 → 2026-01-31,
   decaimiento de 365 días, shotsW 0). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: 0.2684,        // log-goles base por equipo
  hfa: 0.2458,       // ventaja de local (log)
  rho: -0.065,       // corrección Dixon-Coles de marcadores bajos
  conversion: 0.335,   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: 1.71,
  avg_away_goals: 1.258,
  draw_rate: 0.259,
  fit_games: 2034,
  corners_home: 5.32,
  corners_away: 4.23,
  promoted_anchor: { att: 0.0688, def: -0.0034 },
};

/* ratings iniciales de la plantilla 2026 (30 equipos) */
const PRIORS = {
  "182": {
    "att": 0.0907,
    "def": 0.1202
  },
  "183": {
    "att": 0.1782,
    "def": -0.0674
  },
  "184": {
    "att": -0.1034,
    "def": 0.1388
  },
  "185": {
    "att": 0.0003,
    "def": 0.0123
  },
  "186": {
    "att": -0.0821,
    "def": 0.2178
  },
  "187": {
    "att": 0.1199,
    "def": 0.1503
  },
  "189": {
    "att": -0.1112,
    "def": 0.1084
  },
  "190": {
    "att": -0.0423,
    "def": -0.0659
  },
  "191": {
    "att": -0.0009,
    "def": 0.2116
  },
  "193": {
    "att": -0.2433,
    "def": 0.2234
  },
  "4771": {
    "att": -0.087,
    "def": -0.0231
  },
  "6077": {
    "att": -0.1183,
    "def": -0.0717
  },
  "7318": {
    "att": -0.2644,
    "def": 0.0032
  },
  "9720": {
    "att": -0.1785,
    "def": 0.1308
  },
  "9723": {
    "att": -0.0459,
    "def": 0.0551
  },
  "9726": {
    "att": 0.0639,
    "def": -0.1724
  },
  "9727": {
    "att": 0.1481,
    "def": -0.1401
  },
  "10739": {
    "att": 0.1311,
    "def": -0.1857
  },
  "12011": {
    "att": 0.1128,
    "def": -0.0341
  },
  "17362": {
    "att": 0.0449,
    "def": -0.0717
  },
  "17606": {
    "att": -0.0254,
    "def": -0.1377
  },
  "18267": {
    "att": 0.0239,
    "def": -0.1175
  },
  "18418": {
    "att": -0.0921,
    "def": 0.0865
  },
  "18966": {
    "att": 0.2141,
    "def": -0.2091
  },
  "18986": {
    "att": -0.0464,
    "def": -0.0676
  },
  "20232": {
    "att": 0.3947,
    "def": 0.0409
  },
  "20906": {
    "att": -0.1622,
    "def": -0.0099
  },
  "21300": {
    "att": -0.0568,
    "def": -0.1186
  },
  "21812": {
    "att": -0.0426,
    "def": 0.1251
  },
  "22529": {
    "att": 0.1801,
    "def": -0.1319
  }
};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = {
  "182": {
    "f": 0.952,
    "a": 1.006
  },
  "183": {
    "f": 1.037,
    "a": 0.77
  },
  "184": {
    "f": 1.046,
    "a": 1.117
  },
  "185": {
    "f": 0.818,
    "a": 1.311
  },
  "186": {
    "f": 0.992,
    "a": 0.987
  },
  "187": {
    "f": 1.104,
    "a": 1.051
  },
  "189": {
    "f": 1.032,
    "a": 0.903
  },
  "190": {
    "f": 0.913,
    "a": 0.898
  },
  "191": {
    "f": 1.179,
    "a": 1.036
  },
  "193": {
    "f": 0.903,
    "a": 1.051
  },
  "4771": {
    "f": 0.979,
    "a": 1.046
  },
  "6077": {
    "f": 1.036,
    "a": 1.109
  },
  "7318": {
    "f": 0.836,
    "a": 1.103
  },
  "9720": {
    "f": 1.046,
    "a": 0.903
  },
  "9723": {
    "f": 1.015,
    "a": 1.046
  },
  "9726": {
    "f": 1.09,
    "a": 0.912
  },
  "9727": {
    "f": 1.17,
    "a": 0.973
  },
  "10739": {
    "f": 1.187,
    "a": 0.887
  },
  "12011": {
    "f": 0.957,
    "a": 0.999
  },
  "17362": {
    "f": 0.946,
    "a": 1.107
  },
  "17606": {
    "f": 1.025,
    "a": 1.127
  },
  "18267": {
    "f": 0.863,
    "a": 1.081
  },
  "18418": {
    "f": 0.898,
    "a": 0.993
  },
  "18966": {
    "f": 1.009,
    "a": 0.964
  },
  "18986": {
    "f": 1.09,
    "a": 0.752
  },
  "20232": {
    "f": 0.979,
    "a": 0.87
  },
  "20906": {
    "f": 0.943,
    "a": 1.111
  },
  "21300": {
    "f": 0.868,
    "a": 1.082
  },
  "21812": {
    "f": 1.012,
    "a": 1.117
  },
  "22529": {
    "f": 1.064,
    "a": 0.725
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
  "dcBet": 0.9,
  "dcMaybe": 0.8,
  "bttsBet": 0.555,
  "bttsMaybe": 0.535
};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
