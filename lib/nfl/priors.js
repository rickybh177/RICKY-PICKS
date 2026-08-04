/* ============================================================
   PRIORS NFL 2026 — generado por scripts/build-nfl-priors.js
   el 2026-08-04 desde 2024+2025 (regular+playoffs, ESPN),
   ajustados por rival (lib/nfl/fit.js, half-life 320 días) y
   regresados a la media (carry 0.6). off/def en puntos por juego
   vs promedio de liga. NO editar a mano: regenerar.
   ============================================================ */
const LEAGUE_PPG = 23; // puntos por equipo por juego (fit 2024-25)
const HFA = 2.14;        // ventaja de local total, en puntos de margen

/* PRETEMPORADA — universo aparte, ajustado SOLO con pretemporadas
   2021-2025 (245 juegos, carry 0.6).
   Los ratings de temporada regular no predicen agosto (corr ≈ 0);
   lo que persiste es el desempeño de la propia pretemporada
   (corr ≈ 0.21): filosofía del coach y profundidad del roster.
   La localía en agosto es casi nula (~0.2 pts) — el fit la saca. */
const PRESEASON = {
  "ratings": {
    "PIT": {
      "off": -0.04,
      "def": 0.46
    },
    "DAL": {
      "off": 0.31,
      "def": -0.6
    },
    "NE": {
      "off": 0.03,
      "def": -0.13
    },
    "WSH": {
      "off": -1.08,
      "def": -1.57
    },
    "PHI": {
      "off": -0.37,
      "def": -0.44
    },
    "ATL": {
      "off": -1.44,
      "def": -0.47
    },
    "TEN": {
      "off": 0.05,
      "def": 0.09
    },
    "DET": {
      "off": -1.07,
      "def": -0.57
    },
    "BUF": {
      "off": -0.37,
      "def": -1.09
    },
    "ARI": {
      "off": -0.88,
      "def": -0.04
    },
    "CHI": {
      "off": 1.66,
      "def": 0.77
    },
    "MIA": {
      "off": 0.06,
      "def": 0.72
    },
    "MIN": {
      "off": -0.34,
      "def": 0.43
    },
    "DEN": {
      "off": 1.91,
      "def": 1.27
    },
    "JAX": {
      "off": 0.13,
      "def": 0.54
    },
    "CLE": {
      "off": 0.44,
      "def": -0.01
    },
    "BAL": {
      "off": 0.46,
      "def": 0.88
    },
    "NO": {
      "off": -0.37,
      "def": -0.27
    },
    "NYG": {
      "off": 1.22,
      "def": 0.41
    },
    "NYJ": {
      "off": -0.07,
      "def": 0.55
    },
    "TB": {
      "off": -0.16,
      "def": 0.66
    },
    "CIN": {
      "off": -0.19,
      "def": -1.55
    },
    "GB": {
      "off": -0.2,
      "def": 0.55
    },
    "HOU": {
      "off": -0.14,
      "def": 1.48
    },
    "SF": {
      "off": -0.17,
      "def": -0.23
    },
    "KC": {
      "off": 0.48,
      "def": -1.22
    },
    "LV": {
      "off": 0.05,
      "def": -0.4
    },
    "SEA": {
      "off": 0.28,
      "def": 0.16
    },
    "LAR": {
      "off": -0.19,
      "def": -0.1
    },
    "LAC": {
      "off": 0.49,
      "def": 0.19
    },
    "IND": {
      "off": 1.18,
      "def": -0.04
    },
    "CAR": {
      "off": -1.64,
      "def": -0.41
    }
  },
  "mu": 19.46,
  "hfa": 0.12,
  "carry": 0.6,
  "diag": {
    "games": 245,
    "resid_sd": 8.03,
    "avg_ppg": 19.03,
    "hfa_fit_decayed": 0.86,
    "hfa_games": 240
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
