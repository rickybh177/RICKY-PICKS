/* ============================================================
   NFL — metadatos de los 32 equipos y sus estadios.
   lat/lon: para el pronóstico de clima (Open-Meteo).
   roof: 'dome' (cerrado o retráctil/canopy: sin clima) | 'open'.
   altM: altitud en metros (Denver patea/anota distinto).
   Los juegos en sede neutral (internacionales) se detectan por
   ESPN (neutralSite) y NO usan el estadio del local.
   ============================================================ */
const TEAMS = {
  ARI: { espnId: 22, name: 'Cardinals',   city: 'Arizona',       lat: 33.5276, lon: -112.2626, roof: 'dome' },
  ATL: { espnId: 1,  name: 'Falcons',     city: 'Atlanta',       lat: 33.7554, lon: -84.4008,  roof: 'dome' },
  BAL: { espnId: 33, name: 'Ravens',      city: 'Baltimore',     lat: 39.2780, lon: -76.6227,  roof: 'open' },
  BUF: { espnId: 2,  name: 'Bills',       city: 'Buffalo',       lat: 42.7738, lon: -78.7870,  roof: 'open' },
  CAR: { espnId: 29, name: 'Panthers',    city: 'Carolina',      lat: 35.2258, lon: -80.8528,  roof: 'open' },
  CHI: { espnId: 3,  name: 'Bears',       city: 'Chicago',       lat: 41.8623, lon: -87.6167,  roof: 'open' },
  CIN: { espnId: 4,  name: 'Bengals',     city: 'Cincinnati',    lat: 39.0954, lon: -84.5160,  roof: 'open' },
  CLE: { espnId: 5,  name: 'Browns',      city: 'Cleveland',     lat: 41.5061, lon: -81.6995,  roof: 'open' },
  DAL: { espnId: 6,  name: 'Cowboys',     city: 'Dallas',        lat: 32.7473, lon: -97.0945,  roof: 'dome' },
  DEN: { espnId: 7,  name: 'Broncos',     city: 'Denver',        lat: 39.7439, lon: -105.0201, roof: 'open', altM: 1609 },
  DET: { espnId: 8,  name: 'Lions',       city: 'Detroit',       lat: 42.3400, lon: -83.0456,  roof: 'dome' },
  GB:  { espnId: 9,  name: 'Packers',     city: 'Green Bay',     lat: 44.5013, lon: -88.0622,  roof: 'open' },
  HOU: { espnId: 34, name: 'Texans',      city: 'Houston',       lat: 29.6847, lon: -95.4107,  roof: 'dome' },
  IND: { espnId: 11, name: 'Colts',       city: 'Indianápolis',  lat: 39.7601, lon: -86.1639,  roof: 'dome' },
  JAX: { espnId: 30, name: 'Jaguars',     city: 'Jacksonville',  lat: 30.3240, lon: -81.6373,  roof: 'open' },
  KC:  { espnId: 12, name: 'Chiefs',      city: 'Kansas City',   lat: 39.0489, lon: -94.4839,  roof: 'open' },
  LV:  { espnId: 13, name: 'Raiders',     city: 'Las Vegas',     lat: 36.0909, lon: -115.1833, roof: 'dome' },
  LAC: { espnId: 24, name: 'Chargers',    city: 'Los Ángeles',   lat: 33.9535, lon: -118.3392, roof: 'dome' },
  LAR: { espnId: 14, name: 'Rams',        city: 'Los Ángeles',   lat: 33.9535, lon: -118.3392, roof: 'dome' },
  MIA: { espnId: 15, name: 'Dolphins',    city: 'Miami',         lat: 25.9580, lon: -80.2389,  roof: 'open' },
  MIN: { espnId: 16, name: 'Vikings',     city: 'Minnesota',     lat: 44.9738, lon: -93.2577,  roof: 'dome' },
  NE:  { espnId: 17, name: 'Patriots',    city: 'Nueva Inglaterra', lat: 42.0909, lon: -71.2643, roof: 'open' },
  NO:  { espnId: 18, name: 'Saints',      city: 'Nueva Orleans', lat: 29.9511, lon: -90.0812,  roof: 'dome' },
  NYG: { espnId: 19, name: 'Giants',      city: 'Nueva York',    lat: 40.8128, lon: -74.0742,  roof: 'open' },
  NYJ: { espnId: 20, name: 'Jets',        city: 'Nueva York',    lat: 40.8128, lon: -74.0742,  roof: 'open' },
  PHI: { espnId: 21, name: 'Eagles',      city: 'Filadelfia',    lat: 39.9008, lon: -75.1675,  roof: 'open' },
  PIT: { espnId: 23, name: 'Steelers',    city: 'Pittsburgh',    lat: 40.4468, lon: -80.0158,  roof: 'open' },
  SF:  { espnId: 25, name: '49ers',       city: 'San Francisco', lat: 37.4030, lon: -121.9700, roof: 'open' },
  SEA: { espnId: 26, name: 'Seahawks',    city: 'Seattle',       lat: 47.5952, lon: -122.3316, roof: 'open' },
  TB:  { espnId: 27, name: 'Buccaneers',  city: 'Tampa Bay',     lat: 27.9759, lon: -82.5033,  roof: 'open' },
  TEN: { espnId: 10, name: 'Titans',      city: 'Tennessee',     lat: 36.1665, lon: -86.7713,  roof: 'open' },
  WSH: { espnId: 28, name: 'Commanders',  city: 'Washington',    lat: 38.9077, lon: -76.8645,  roof: 'open' },
};

function logoUrl(abbr) {
  return 'https://a.espncdn.com/i/teamlogos/nfl/500/' + String(abbr).toLowerCase() + '.png';
}

module.exports = { TEAMS, logoUrl };
