/* ============================================================
   PRIORS SERIE A — 2026-27
   ARCHIVO GENERADO por scripts/build-euro-priors.js el 2026-11-12
   con 1520 partidos de ita.1 (2022-07-01 → 2026-07-31,
   decaimiento de 365 días, shotsW 0). NO editar a mano:
   regenerar con el script (las banderas quedan horneadas en CAL).
   Llaves = id de equipo de ESPN (string). att = fuerza ofensiva,
   def = debilidad defensiva (escala log). Los ascendidos sin
   historia traen promoted_anchor.
   ============================================================ */
const LEAGUE = {
  mu: 0.1222,        // log-goles base por equipo
  hfa: 0.1156,       // ventaja de local (log)
  rho: -0.025,       // corrección Dixon-Coles de marcadores bajos
  conversion: 0.328,   // goles por tiro a puerta (para shotsW > 0)
  avg_home_goals: 1.366,
  avg_away_goals: 1.174,
  draw_rate: 0.276,
  fit_games: 1520,
  corners_home: 4.98,
  corners_away: 3.88,
  promoted_anchor: { att: -0.0863, def: 0.0608 },
};

/* ratings iniciales de la plantilla 2026-27 (20 equipos) */
const PRIORS = {
  "103": {
    "att": 0.2511,
    "def": -0.1606
  },
  "104": {
    "att": 0.273,
    "def": -0.2886
  },
  "105": {
    "att": 0.305,
    "def": -0.2144
  },
  "107": {
    "att": 0.1508,
    "def": -0.0749
  },
  "109": {
    "att": 0.1111,
    "def": -0.0578
  },
  "110": {
    "att": 0.6007,
    "def": -0.2863
  },
  "111": {
    "att": 0.2478,
    "def": -0.296
  },
  "112": {
    "att": 0.0804,
    "def": -0.1367
  },
  "113": {
    "att": -0.3431,
    "def": 0.0302
  },
  "114": {
    "att": 0.2498,
    "def": -0.285
  },
  "115": {
    "att": -0.2155,
    "def": -0.0115
  },
  "118": {
    "att": -0.0176,
    "def": 0.0101
  },
  "239": {
    "att": -0.0394,
    "def": 0.0607
  },
  "2572": {
    "att": 0.2847,
    "def": -0.2464
  },
  "2925": {
    "att": -0.0557,
    "def": 0.1067
  },
  "3263": {
    "att": -0.0604,
    "def": -0.0162
  },
  "3997": {
    "att": 0.0297,
    "def": 0.1107
  },
  "4007": {
    "att": -0.1824,
    "def": 0.1975
  },
  "4057": {
    "att": -0.0216,
    "def": 0.1891
  },
  "17530": {
    "att": -0.1724,
    "def": 0.0762
  }
};

/* factores de córneres a favor (f) y en contra (a), relativos a la liga */
const CORNERS = {
  "103": {
    "f": 0.97,
    "a": 0.975
  },
  "104": {
    "f": 1.144,
    "a": 0.829
  },
  "105": {
    "f": 1.224,
    "a": 0.961
  },
  "107": {
    "f": 1.008,
    "a": 0.98
  },
  "109": {
    "f": 1.003,
    "a": 1.027
  },
  "110": {
    "f": 1.346,
    "a": 0.726
  },
  "111": {
    "f": 1.186,
    "a": 0.881
  },
  "112": {
    "f": 0.89,
    "a": 0.961
  },
  "113": {
    "f": 0.984,
    "a": 1.177
  },
  "114": {
    "f": 1.186,
    "a": 0.702
  },
  "115": {
    "f": 0.9,
    "a": 1.102
  },
  "118": {
    "f": 1.012,
    "a": 1.074
  },
  "239": {
    "f": 0.895,
    "a": 1.045
  },
  "2572": {
    "f": 1.017,
    "a": 0.782
  },
  "2925": {
    "f": 0.885,
    "a": 1.13
  },
  "3263": {
    "f": 0.867,
    "a": 1.083
  },
  "3997": {
    "f": 0.885,
    "a": 1.092
  },
  "4007": {
    "f": 0.95,
    "a": 1.05
  },
  "4057": {
    "f": 0.95,
    "a": 1.05
  },
  "17530": {
    "f": 0.95,
    "a": 1.05
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
  "dcBet": 0.76,
  "dcMaybe": 0.7,
  "bttsBet": 0.66,
  "bttsMaybe": 0.62
};

module.exports = { LEAGUE, PRIORS, CORNERS, CAL };
