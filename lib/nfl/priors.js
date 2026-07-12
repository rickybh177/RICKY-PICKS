/* ============================================================
   PRIORS NFL 2026 — generado por scripts/build-nfl-priors.js
   el 2026-07-12 desde la temporada 2025 (ESPN).
   off/def = puntos por juego vs promedio de liga, ya regresados
   a la media (45% de arrastre año-a-año). NO editar a mano:
   regenerar con el script.
   ============================================================ */
const LEAGUE_PPG = 23.01; // puntos por equipo por juego, liga 2025

const PRIORS = {
  "ARI": {
    "off": -0.96,
    "def": -2.56
  },
  "ATL": {
    "off": -1.01,
    "def": -0.26
  },
  "BAL": {
    "off": 0.87,
    "def": -0.18
  },
  "BUF": {
    "off": 2.38,
    "def": 0.69
  },
  "CAR": {
    "off": -2.12,
    "def": 0.3
  },
  "CHI": {
    "off": 1.32,
    "def": -0.63
  },
  "CIN": {
    "off": 0.6,
    "def": -2.67
  },
  "CLE": {
    "off": -2.97,
    "def": 0.32
  },
  "DAL": {
    "off": 2.11,
    "def": -3.17
  },
  "DEN": {
    "off": 0.26,
    "def": 2.12
  },
  "DET": {
    "off": 2.38,
    "def": -0.58
  },
  "GB": {
    "off": -0.01,
    "def": 0.83
  },
  "HOU": {
    "off": 0.34,
    "def": 2.55
  },
  "IND": {
    "off": 1.98,
    "def": -0.55
  },
  "JAX": {
    "off": 2.19,
    "def": 1.46
  },
  "KC": {
    "off": -0.77,
    "def": 1.67
  },
  "LAC": {
    "off": -0.61,
    "def": 1.36
  },
  "LAR": {
    "off": 3.36,
    "def": 1.2
  },
  "LV": {
    "off": -3.98,
    "def": -1.08
  },
  "MIA": {
    "off": -1.17,
    "def": -0.87
  },
  "MIN": {
    "off": -1.25,
    "def": 1.54
  },
  "NE": {
    "off": 2.61,
    "def": 1.89
  },
  "NO": {
    "off": -2.26,
    "def": 0.22
  },
  "NYG": {
    "off": -0.27,
    "def": -1.26
  },
  "NYJ": {
    "off": -2.41,
    "def": -2.96
  },
  "PHI": {
    "off": -0.32,
    "def": 1.75
  },
  "PIT": {
    "off": 0.15,
    "def": 0.11
  },
  "SEA": {
    "off": 2.43,
    "def": 2.63
  },
  "SF": {
    "off": 1.21,
    "def": 0.54
  },
  "TB": {
    "off": -0.3,
    "def": -0.52
  },
  "TEN": {
    "off": -2.84,
    "def": -2.3
  },
  "WSH": {
    "off": -0.93,
    "def": -1.58
  }
};

module.exports = { PRIORS, LEAGUE_PPG };
