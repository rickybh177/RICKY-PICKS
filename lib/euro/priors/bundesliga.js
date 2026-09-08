/* ============================================================
   PRIORS BUNDESLIGA — 2026-27
   ARCHIVO GENERADO por scripts/build-euro-priors.js el 2026-09-05
   con 1224 partidos de ger.1 (2022-07-01 → 2026-07-31,
   decaimiento de 500 días, shotsW 0). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: 0.322,        // log-goles base por equipo
  hfa: 0.1883,       // ventaja de local (log)
  rho: -0.08,       // corrección Dixon-Coles de marcadores bajos
  conversion: 0.34,   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: 1.768,
  avg_away_goals: 1.422,
  draw_rate: 0.252,
  fit_games: 1224,
  corners_home: 5.52,
  corners_away: 4.26,
  promoted_anchor: { att: -0.2122, def: 0.1222 },
};

/* ratings iniciales de la plantilla 2026-27 (18 equipos) */
const PRIORS = {
  "122": {
    "att": -0.1017,
    "def": 0.0769
  },
  "124": {
    "att": 0.3295,
    "def": -0.2653
  },
  "125": {
    "att": 0.1684,
    "def": 0.0013
  },
  "126": {
    "att": -0.0108,
    "def": -0.0235
  },
  "127": {
    "att": -0.1514,
    "def": -0.0372
  },
  "131": {
    "att": 0.3173,
    "def": -0.243
  },
  "132": {
    "att": 0.7119,
    "def": -0.3088
  },
  "133": {
    "att": -0.1458,
    "def": 0.126
  },
  "134": {
    "att": 0.2848,
    "def": -0.1093
  },
  "137": {
    "att": -0.1039,
    "def": 0.0218
  },
  "268": {
    "att": -0.0208,
    "def": 0.001
  },
  "598": {
    "att": -0.189,
    "def": -0.0393
  },
  "2950": {
    "att": -0.0439,
    "def": -0.1173
  },
  "3307": {
    "att": -0.2122,
    "def": 0.1222
  },
  "3841": {
    "att": -0.1433,
    "def": 0.0157
  },
  "7911": {
    "att": 0.1425,
    "def": 0.0614
  },
  "10388": {
    "att": -0.2122,
    "def": 0.1222
  },
  "11420": {
    "att": 0.2187,
    "def": -0.1742
  }
};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = {
  "122": {
    "f": 0.957,
    "a": 1.106
  },
  "124": {
    "f": 1.073,
    "a": 0.892
  },
  "125": {
    "f": 0.966,
    "a": 0.948
  },
  "126": {
    "f": 0.883,
    "a": 0.887
  },
  "127": {
    "f": 0.804,
    "a": 1.152
  },
  "131": {
    "f": 1.111,
    "a": 0.878
  },
  "132": {
    "f": 1.231,
    "a": 0.79
  },
  "133": {
    "f": 0.95,
    "a": 1.05
  },
  "134": {
    "f": 1.124,
    "a": 0.906
  },
  "137": {
    "f": 0.948,
    "a": 1.018
  },
  "268": {
    "f": 0.822,
    "a": 1.004
  },
  "598": {
    "f": 1.022,
    "a": 0.994
  },
  "2950": {
    "f": 1.032,
    "a": 0.952
  },
  "3307": {
    "f": 0.95,
    "a": 1.05
  },
  "3841": {
    "f": 0.957,
    "a": 1.101
  },
  "7911": {
    "f": 1.152,
    "a": 0.985
  },
  "10388": {
    "f": 0.95,
    "a": 1.05
  },
  "11420": {
    "f": 1.064,
    "a": 0.911
  }
};

/* calibración del runtime (misma que usa scripts/euro-backtest.js) */
const CAL = {
  "halfLife": 500,
  "shotsW": 0,
  "sgdK": 0.015,
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
