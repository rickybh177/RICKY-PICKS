/* ============================================================
   PRIORS PREMIER LEAGUE — 2026-27
   ARCHIVO GENERADO por scripts/build-euro-priors.js el 2026-09-05
   con 1520 partidos de eng.1 (2022-07-01 → 2026-07-31,
   decaimiento de 365 días, shotsW 0). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: 0.2539,        // log-goles base por equipo
  hfa: 0.1776,       // ventaja de local (log)
  rho: -0.08,       // corrección Dixon-Coles de marcadores bajos
  conversion: 0.352,   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: 1.618,
  avg_away_goals: 1.336,
  draw_rate: 0.241,
  fit_games: 1520,
  corners_home: 5.39,
  corners_away: 4.6,
  promoted_anchor: { att: -0.1486, def: 0.2113 },
};

/* ratings iniciales de la plantilla 2026-27 (20 equipos) */
const PRIORS = {
  "306": {
    "att": -0.1486,
    "def": 0.2113
  },
  "331": {
    "att": 0.0923,
    "def": -0.0803
  },
  "337": {
    "att": 0.1072,
    "def": -0.0483
  },
  "349": {
    "att": 0.0747,
    "def": -0.0588
  },
  "357": {
    "att": -0.0231,
    "def": -0.002
  },
  "359": {
    "att": 0.3152,
    "def": -0.5109
  },
  "360": {
    "att": 0.1462,
    "def": -0.093
  },
  "361": {
    "att": 0.1844,
    "def": -0.0601
  },
  "362": {
    "att": 0.1291,
    "def": -0.0919
  },
  "363": {
    "att": 0.1308,
    "def": -0.0876
  },
  "364": {
    "att": 0.3173,
    "def": -0.126
  },
  "366": {
    "att": -0.1399,
    "def": -0.1295
  },
  "367": {
    "att": 0.0746,
    "def": 0.071
  },
  "368": {
    "att": -0.1282,
    "def": -0.1392
  },
  "370": {
    "att": -0.0263,
    "def": -0.0723
  },
  "373": {
    "att": -0.2267,
    "def": 0.2936
  },
  "382": {
    "att": 0.3853,
    "def": -0.3637
  },
  "384": {
    "att": -0.0887,
    "def": -0.0755
  },
  "388": {
    "att": -0.1486,
    "def": 0.2113
  },
  "393": {
    "att": 0.0027,
    "def": -0.0787
  }
};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = {
  "306": {
    "f": 0.95,
    "a": 1.05
  },
  "331": {
    "f": 0.979,
    "a": 0.971
  },
  "337": {
    "f": 0.967,
    "a": 1.059
  },
  "349": {
    "f": 1.092,
    "a": 1.05
  },
  "357": {
    "f": 0.909,
    "a": 1.013
  },
  "359": {
    "f": 1.109,
    "a": 0.742
  },
  "360": {
    "f": 0.967,
    "a": 0.984
  },
  "361": {
    "f": 1.171,
    "a": 0.988
  },
  "362": {
    "f": 1.038,
    "a": 0.988
  },
  "363": {
    "f": 1.15,
    "a": 0.888
  },
  "364": {
    "f": 1.175,
    "a": 0.904
  },
  "366": {
    "f": 0.792,
    "a": 1.025
  },
  "367": {
    "f": 1.079,
    "a": 0.971
  },
  "368": {
    "f": 0.909,
    "a": 1.021
  },
  "370": {
    "f": 0.992,
    "a": 1.084
  },
  "373": {
    "f": 0.95,
    "a": 1.05
  },
  "382": {
    "f": 1.238,
    "a": 0.813
  },
  "384": {
    "f": 0.875,
    "a": 1.038
  },
  "388": {
    "f": 0.95,
    "a": 1.05
  },
  "393": {
    "f": 1.038,
    "a": 0.971
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
  "dcBet": 0.72,
  "dcMaybe": 0.66,
  "bttsBet": 0.555,
  "bttsMaybe": 0.535
};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
