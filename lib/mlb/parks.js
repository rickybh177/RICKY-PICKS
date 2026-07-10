/* ============================================================
   PARQUES MLB — park factors, techo y metadata de equipos.
   Factores indexados a 1.00 = neutral (aprox. rolling 3 años,
   estilo Baseball Savant). Solo backend.
   ============================================================ */

// Clave = team id de MLB StatsAPI (equipo local define el parque).
const PARKS = {
  108: { park: 'Angel Stadium',       run: 1.01, hr: 1.04, roof: 'open' },  // LAA
  109: { park: 'Chase Field',         run: 1.03, hr: 1.03, roof: 'retractable' }, // AZ
  110: { park: 'Camden Yards',        run: 0.98, hr: 1.02, roof: 'open' },  // BAL
  111: { park: 'Fenway Park',         run: 1.07, hr: 0.96, roof: 'open' },  // BOS
  112: { park: 'Wrigley Field',       run: 0.98, hr: 0.96, roof: 'open' },  // CHC
  113: { park: 'Great American BP',   run: 1.04, hr: 1.18, roof: 'open' },  // CIN
  114: { park: 'Progressive Field',   run: 0.98, hr: 0.97, roof: 'open' },  // CLE
  115: { park: 'Coors Field',         run: 1.12, hr: 1.10, roof: 'open' },  // COL
  116: { park: 'Comerica Park',       run: 0.97, hr: 0.94, roof: 'open' },  // DET
  117: { park: 'Daikin Park',         run: 0.99, hr: 1.06, roof: 'retractable' }, // HOU
  118: { park: 'Kauffman Stadium',    run: 1.04, hr: 0.88, roof: 'open' },  // KC
  119: { park: 'Dodger Stadium',      run: 0.98, hr: 1.07, roof: 'open' },  // LAD
  120: { park: 'Nationals Park',      run: 1.00, hr: 1.00, roof: 'open' },  // WSH
  121: { park: 'Citi Field',          run: 0.96, hr: 0.98, roof: 'open' },  // NYM
  133: { park: 'Sutter Health Park',  run: 1.02, hr: 1.04, roof: 'open' },  // ATH
  134: { park: 'PNC Park',            run: 0.96, hr: 0.88, roof: 'open' },  // PIT
  135: { park: 'Petco Park',          run: 0.96, hr: 0.97, roof: 'open' },  // SD
  136: { park: 'T-Mobile Park',       run: 0.92, hr: 0.96, roof: 'retractable' }, // SEA
  137: { park: 'Oracle Park',         run: 0.95, hr: 0.85, roof: 'open' },  // SF
  138: { park: 'Busch Stadium',       run: 0.97, hr: 0.92, roof: 'open' },  // STL
  139: { park: 'Tropicana Field',     run: 0.96, hr: 0.95, roof: 'dome' },  // TB
  140: { park: 'Globe Life Field',    run: 0.98, hr: 0.98, roof: 'retractable' }, // TEX
  141: { park: 'Rogers Centre',       run: 1.00, hr: 1.02, roof: 'retractable' }, // TOR
  142: { park: 'Target Field',        run: 0.99, hr: 0.97, roof: 'open' },  // MIN
  143: { park: 'Citizens Bank Park',  run: 1.01, hr: 1.08, roof: 'open' },  // PHI
  144: { park: 'Truist Park',         run: 1.01, hr: 1.04, roof: 'open' },  // ATL
  145: { park: 'Rate Field',          run: 1.00, hr: 1.08, roof: 'open' },  // CWS
  146: { park: 'loanDepot park',      run: 0.97, hr: 0.92, roof: 'retractable' }, // MIA
  147: { park: 'Yankee Stadium',      run: 0.99, hr: 1.10, roof: 'open' },  // NYY
  158: { park: 'American Family Field', run: 0.99, hr: 1.04, roof: 'retractable' }, // MIL
};

// Metadata pública de equipos (abreviatura + nombre corto).
const TEAMS = {
  108: { abbr: 'LAA', name: 'Angels' },
  109: { abbr: 'AZ',  name: 'D-backs' },
  110: { abbr: 'BAL', name: 'Orioles' },
  111: { abbr: 'BOS', name: 'Red Sox' },
  112: { abbr: 'CHC', name: 'Cubs' },
  113: { abbr: 'CIN', name: 'Reds' },
  114: { abbr: 'CLE', name: 'Guardians' },
  115: { abbr: 'COL', name: 'Rockies' },
  116: { abbr: 'DET', name: 'Tigers' },
  117: { abbr: 'HOU', name: 'Astros' },
  118: { abbr: 'KC',  name: 'Royals' },
  119: { abbr: 'LAD', name: 'Dodgers' },
  120: { abbr: 'WSH', name: 'Nationals' },
  121: { abbr: 'NYM', name: 'Mets' },
  133: { abbr: 'ATH', name: 'Athletics' },
  134: { abbr: 'PIT', name: 'Pirates' },
  135: { abbr: 'SD',  name: 'Padres' },
  136: { abbr: 'SEA', name: 'Mariners' },
  137: { abbr: 'SF',  name: 'Giants' },
  138: { abbr: 'STL', name: 'Cardinals' },
  139: { abbr: 'TB',  name: 'Rays' },
  140: { abbr: 'TEX', name: 'Rangers' },
  141: { abbr: 'TOR', name: 'Blue Jays' },
  142: { abbr: 'MIN', name: 'Twins' },
  143: { abbr: 'PHI', name: 'Phillies' },
  144: { abbr: 'ATL', name: 'Braves' },
  145: { abbr: 'CWS', name: 'White Sox' },
  146: { abbr: 'MIA', name: 'Marlins' },
  147: { abbr: 'NYY', name: 'Yankees' },
  158: { abbr: 'MIL', name: 'Brewers' },
};

const NEUTRAL_PARK = { park: 'Neutral', run: 1.0, hr: 1.0, roof: 'open' };

function parkFor(homeTeamId) {
  return PARKS[homeTeamId] || NEUTRAL_PARK;
}
function teamMeta(teamId, fallbackName) {
  return TEAMS[teamId] || { abbr: '???', name: fallbackName || 'Equipo' };
}

/* Clima → multiplicador de HR y de hits en juego.
   MLB manda weather como { condition, temp: "84", wind: "8 mph, Out To CF" }.
   Con techo cerrado/domo: neutral. */
function weatherMods(weather, park) {
  const out = { hrMult: 1.0, hitMult: 1.0, temp: null, windTxt: null, condition: null, applied: false };
  if (!weather) return out;
  out.condition = weather.condition || null;
  const closed = park.roof === 'dome' ||
    /roof closed|dome/i.test(weather.condition || '');
  const temp = parseFloat(weather.temp);
  out.temp = Number.isFinite(temp) ? temp : null;
  out.windTxt = weather.wind || null;
  if (closed) { out.condition = weather.condition || 'Techo cerrado'; return out; }

  let hr = 1.0;
  if (Number.isFinite(temp)) hr *= 1 + 0.005 * (temp - 72); // ~+0.5% HR por °F
  const wind = /([\d.]+)\s*mph\s*,\s*(.+)/i.exec(weather.wind || '');
  if (wind) {
    const mph = parseFloat(wind[1]);
    const dir = wind[2].trim().toLowerCase();
    if (/^out to/.test(dir)) hr *= 1 + 0.008 * mph;      // viento a favor
    else if (/^in from/.test(dir)) hr *= 1 - 0.008 * mph; // viento en contra
    // cruzado (L To R / R To L): neutral
  }
  out.hrMult = Math.min(1.30, Math.max(0.75, hr));
  // El clima que ayuda a los HR también ayuda un poco a los hits.
  out.hitMult = 1 + 0.15 * (out.hrMult - 1);
  out.applied = true;
  return out;
}

module.exports = { PARKS, TEAMS, NEUTRAL_PARK, parkFor, teamMeta, weatherMods };
