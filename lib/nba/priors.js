/* ============================================================
   PRIORS NBA 2026-27 — generado por scripts/build-nba-priors.js
   el 2026-10-27 desde 2023-24 → 2025-26 (3973 juegos, ESPN),
   ajustados por rival (lib/nba/fit.js, half-life 365 días), con
   descanso y ausencias descontados, y regresados a la media (carry
   0.7). off/def en puntos por 100 posesiones vs promedio de liga;
   pace en posesiones por juego vs promedio. NO editar a mano: regenerar.
   ============================================================ */
const LEAGUE = { mu: 112, hfa: 1.74, poss: 102 }; // eficiencia media, localía (margen pts/100), posesiones por juego

/* Parámetros validados en scripts/nba-backtest.js (walk-forward 2025-26). */
const PARAMS = {
  CARRY: 0.7,
  K: 0.05,            // aprendizaje de eficiencia por resultado
  KP: 0.1,          // aprendizaje del ritmo
  ABS_C: 0.3,    // peso del Game Score de los ausentes (techo medido con ausencias perfectas: 0.35)
  LUCK: {"off":0.5,"def":0.5},
  /* descanso, en pts/100 de eficiencia (residuo medio por categoría,
     encogido). "long" = 6+ días sin jugar: se juega PEOR (oxidado). */
  REST: {"b2b_home":-0.41,"b2b_away":-0.36,"three_in_four":0.34,"rested":0.01,"long":-1.11},
};
/* n por categoría: {"normal":3969,"rested":1449,"b2b_home":643,"b2b_away":678,"three_in_four":993,"long":214} */

/* Dispersión FUERA DE MUESTRA (walk-forward 2025-26, 1235 juegos):
   margen y total alrededor de la predicción; fracciones y sd de la
   1ª mitad y el 1er cuarto sobre los parciales reales. */
const DISP = {
  "SD_ML": 12.5,
  "SD_MARGIN": 14.187,
  "SD_TOTAL": 22.972,
  "H1_SHARE_TOTAL": 0.505,
  "SD_H1_TOTAL": 12.296,
  "H1_SHARE_MARGIN": 0.63,
  "SD_H1_MARGIN": 11.22,
  "Q1_SHARE_TOTAL": 0.255,
  "SD_Q1_TOTAL": 8.282,
  "Q1_SHARE_MARGIN": 0.36,
  "SD_Q1_MARGIN": 8.232
};

const PRIORS = {
  "ATL": {
    "off": 0.24,
    "def": -0.15,
    "pace": 1.75
  },
  "BKN": {
    "off": -3.66,
    "def": -1.78,
    "pace": -1.43
  },
  "BOS": {
    "off": 3.31,
    "def": 1.92,
    "pace": -2.51
  },
  "CHA": {
    "off": -1.07,
    "def": -0.01,
    "pace": -1.2
  },
  "CHI": {
    "off": -0.83,
    "def": -0.97,
    "pace": 1.77
  },
  "CLE": {
    "off": 2.46,
    "def": 0.52,
    "pace": 0
  },
  "DAL": {
    "off": -1.07,
    "def": 0.02,
    "pace": 1.01
  },
  "DEN": {
    "off": 3.17,
    "def": -0.45,
    "pace": -0.15
  },
  "DET": {
    "off": 0.06,
    "def": 2.07,
    "pace": 0.38
  },
  "GS": {
    "off": -0.36,
    "def": 1.01,
    "pace": -0.15
  },
  "HOU": {
    "off": 0.25,
    "def": 1.69,
    "pace": -0.89
  },
  "IND": {
    "off": -0.09,
    "def": -1.56,
    "pace": 1.02
  },
  "LAC": {
    "off": 1.26,
    "def": 0.29,
    "pace": -1.63
  },
  "LAL": {
    "off": 1.11,
    "def": 0.22,
    "pace": -0.83
  },
  "MEM": {
    "off": -1.17,
    "def": -0.29,
    "pace": 1.57
  },
  "MIA": {
    "off": -0.1,
    "def": 0.71,
    "pace": 0.66
  },
  "MIL": {
    "off": -0.62,
    "def": -0.86,
    "pace": -0.73
  },
  "MIN": {
    "off": -0.01,
    "def": 1.92,
    "pace": -0.03
  },
  "NO": {
    "off": -1.04,
    "def": -1.81,
    "pace": 0.47
  },
  "NY": {
    "off": 2.51,
    "def": 1.42,
    "pace": -1.74
  },
  "OKC": {
    "off": 2.56,
    "def": 4.07,
    "pace": 0.2
  },
  "ORL": {
    "off": -1.66,
    "def": 1.65,
    "pace": -0.46
  },
  "PHI": {
    "off": -0.17,
    "def": -0.46,
    "pace": -0.06
  },
  "PHX": {
    "off": 0.61,
    "def": -0.63,
    "pace": -1.15
  },
  "POR": {
    "off": -1.77,
    "def": 0.15,
    "pace": 0.49
  },
  "SA": {
    "off": 1.04,
    "def": 1.52,
    "pace": 0.42
  },
  "SAC": {
    "off": -0.61,
    "def": -2.89,
    "pace": -0.12
  },
  "TOR": {
    "off": -0.73,
    "def": 0.41,
    "pace": 0.08
  },
  "UTAH": {
    "off": -0.61,
    "def": -3.75,
    "pace": 1.74
  },
  "WSH": {
    "off": -3,
    "def": -4.02,
    "pace": 1.54
  }
};

module.exports = { PRIORS, LEAGUE, PARAMS, DISP };
