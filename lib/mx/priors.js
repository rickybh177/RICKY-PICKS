/* ============================================================
   PRIORS LIGA MX — APERTURA 2026
   Generado por scripts/build-mx-priors.js el 2026-07-17
   con 847 partidos de mex.1 (2024-01-01 → 2026-07-14,
   decaimiento de 300 días). NO editar a mano: regenerar
   con el script.
   att = fuerza ofensiva, def = debilidad defensiva (escala log).
   ============================================================ */
const LEAGUE = {
  mu: 0.1794,        // log-goles base por equipo
  hfa: 0.2627,       // ventaja de local (log)
  altC: 0.0739,      // empuje por km de altitud cuesta arriba
  rho: -0.065,       // corrección Dixon-Coles de marcadores bajos
  avg_home_goals: 1.627,
  avg_away_goals: 1.204,
  draw_rate: 0.251,
  fit_games: 847,
  corners_home: 5.03,
  corners_away: 4.46,
};

const PRIORS = {
  "AME": {
    "att": 0.1033,
    "def": -0.2502
  },
  "ATL": {
    "att": -0.2,
    "def": 0.12
  },
  "ATS": {
    "att": -0.1519,
    "def": 0.0738
  },
  "ASL": {
    "att": 0.0038,
    "def": 0.1466
  },
  "CAZ": {
    "att": 0.1884,
    "def": -0.2409
  },
  "JUA": {
    "att": 0.0094,
    "def": 0.1521
  },
  "GDL": {
    "att": 0.1256,
    "def": -0.1794
  },
  "LEO": {
    "att": -0.1287,
    "def": 0.1655
  },
  "MTY": {
    "att": 0.1885,
    "def": -0.0285
  },
  "NCX": {
    "att": 0.0027,
    "def": 0.1493
  },
  "PAC": {
    "att": -0.0155,
    "def": -0.1289
  },
  "PUE": {
    "att": -0.3316,
    "def": 0.2661
  },
  "UNAM": {
    "att": 0.0948,
    "def": -0.066
  },
  "QRO": {
    "att": -0.2574,
    "def": 0.0205
  },
  "SAN": {
    "att": -0.1817,
    "def": 0.2678
  },
  "UANL": {
    "att": 0.1771,
    "def": -0.2918
  },
  "TIJ": {
    "att": 0.0823,
    "def": -0.0576
  },
  "TOL": {
    "att": 0.2381,
    "def": -0.1952
  }
};

const CORNERS = {
  "AME": {
    "f": 1.057,
    "a": 0.875
  },
  "ATL": {
    "f": 0.95,
    "a": 1.05
  },
  "ATS": {
    "f": 0.839,
    "a": 1.013
  },
  "ASL": {
    "f": 0.948,
    "a": 0.815
  },
  "CAZ": {
    "f": 1.127,
    "a": 0.878
  },
  "JUA": {
    "f": 1.003,
    "a": 1.034
  },
  "GDL": {
    "f": 1.145,
    "a": 0.703
  },
  "LEO": {
    "f": 1.073,
    "a": 1.057
  },
  "MTY": {
    "f": 1.073,
    "a": 1.034
  },
  "NCX": {
    "f": 0.964,
    "a": 1.127
  },
  "PAC": {
    "f": 0.982,
    "a": 0.968
  },
  "PUE": {
    "f": 0.948,
    "a": 1.244
  },
  "UNAM": {
    "f": 0.788,
    "a": 1.312
  },
  "QRO": {
    "f": 1.096,
    "a": 1.12
  },
  "SAN": {
    "f": 0.964,
    "a": 0.925
  },
  "UANL": {
    "f": 1.086,
    "a": 0.897
  },
  "TIJ": {
    "f": 0.862,
    "a": 1.018
  },
  "TOL": {
    "f": 1.159,
    "a": 0.788
  }
};

module.exports = { LEAGUE, PRIORS, CORNERS };
