/* ============================================================
   PRIORS NFL 2026 — generado por scripts/build-nfl-priors.js
   el 2026-08-04 desde 2024+2025 (regular+playoffs, ESPN),
   ajustados por rival (lib/nfl/fit.js, half-life 320 días) y
   regresados a la media (carry 0.6). off/def en puntos por juego
   vs promedio de liga. PRESEASON ajustado con las pretemporadas
   2024-2025 (98 juegos). NO editar a mano: regenerar.
   ============================================================ */
const LEAGUE_PPG = 23; // puntos por equipo por juego (fit 2024-25)
const HFA = 2.14;        // ventaja de local total, en puntos de margen

/* Pretemporada: entorno propio (titulares juegan poco).
   beta = fracción del rating regular que asoma en agosto. */
const PRESEASON = {
  "mu": 18.99,
  "hfa": 1,
  "beta": 0,
  "diag": {
    "rows": 196,
    "resid_sd": 9
  }
};

const PRIORS = {
  "ARI": {
    "off": -0.45,
    "def": -1.27
  },
  "ATL": {
    "off": -0.65,
    "def": -0.61
  },
  "BAL": {
    "off": 1.6,
    "def": 0.26
  },
  "BUF": {
    "off": 2.75,
    "def": 0.27
  },
  "CAR": {
    "off": -1.63,
    "def": -1
  },
  "CHI": {
    "off": 0.34,
    "def": 0.01
  },
  "CIN": {
    "off": 1.17,
    "def": -2.09
  },
  "CLE": {
    "off": -3.09,
    "def": -0.03
  },
  "DAL": {
    "off": 0.98,
    "def": -2.78
  },
  "DEN": {
    "off": 0.11,
    "def": 1.59
  },
  "DET": {
    "off": 2.96,
    "def": -0.02
  },
  "GB": {
    "off": 0.55,
    "def": 0.96
  },
  "HOU": {
    "off": 0.17,
    "def": 2.06
  },
  "IND": {
    "off": 1.31,
    "def": -0.87
  },
  "JAX": {
    "off": 0.91,
    "def": 0.51
  },
  "KC": {
    "off": -0.53,
    "def": 1.3
  },
  "LAC": {
    "off": -0.58,
    "def": 1.21
  },
  "LAR": {
    "off": 2.3,
    "def": 0.8
  },
  "LV": {
    "off": -2.96,
    "def": -1.18
  },
  "MIA": {
    "off": -1.21,
    "def": -0.35
  },
  "MIN": {
    "off": -0.62,
    "def": 1.83
  },
  "NE": {
    "off": 0.31,
    "def": 1.28
  },
  "NO": {
    "off": -2.05,
    "def": 0
  },
  "NYG": {
    "off": -1,
    "def": -0.91
  },
  "NYJ": {
    "off": -1.97,
    "def": -1.96
  },
  "PHI": {
    "off": 0.4,
    "def": 2.01
  },
  "PIT": {
    "off": -0.39,
    "def": 0.32
  },
  "SEA": {
    "off": 1.79,
    "def": 2.32
  },
  "SF": {
    "off": 0.71,
    "def": -0.07
  },
  "TB": {
    "off": 0.56,
    "def": -0.38
  },
  "TEN": {
    "off": -2.07,
    "def": -1.93
  },
  "WSH": {
    "off": 0.28,
    "def": -1.29
  }
};

module.exports = { PRIORS, LEAGUE_PPG, HFA, PRESEASON };
