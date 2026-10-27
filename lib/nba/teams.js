/* ============================================================
   NBA — metadatos de los 30 equipos.
   abbr: la de ESPN (es la llave de todo el modelo).
   full: nombre tal como lo publica The Odds API (match de momios).
   altM: altitud de la cancha (Denver y Utah juegan en altura; el
   backtest mide si pesa más que la localía normal).
   ============================================================ */
const TEAMS = {
  ATL:  { espnId: 1,  name: 'Hawks',         city: 'Atlanta',        full: 'Atlanta Hawks' },
  BOS:  { espnId: 2,  name: 'Celtics',       city: 'Boston',         full: 'Boston Celtics' },
  BKN:  { espnId: 17, name: 'Nets',          city: 'Brooklyn',       full: 'Brooklyn Nets' },
  CHA:  { espnId: 30, name: 'Hornets',       city: 'Charlotte',      full: 'Charlotte Hornets' },
  CHI:  { espnId: 4,  name: 'Bulls',         city: 'Chicago',        full: 'Chicago Bulls' },
  CLE:  { espnId: 5,  name: 'Cavaliers',     city: 'Cleveland',      full: 'Cleveland Cavaliers' },
  DAL:  { espnId: 6,  name: 'Mavericks',     city: 'Dallas',         full: 'Dallas Mavericks' },
  DEN:  { espnId: 7,  name: 'Nuggets',       city: 'Denver',         full: 'Denver Nuggets', altM: 1609 },
  DET:  { espnId: 8,  name: 'Pistons',       city: 'Detroit',        full: 'Detroit Pistons' },
  GS:   { espnId: 9,  name: 'Warriors',      city: 'Golden State',   full: 'Golden State Warriors' },
  HOU:  { espnId: 10, name: 'Rockets',       city: 'Houston',        full: 'Houston Rockets' },
  IND:  { espnId: 11, name: 'Pacers',        city: 'Indiana',        full: 'Indiana Pacers' },
  LAC:  { espnId: 12, name: 'Clippers',      city: 'Los Ángeles',    full: 'Los Angeles Clippers' },
  LAL:  { espnId: 13, name: 'Lakers',        city: 'Los Ángeles',    full: 'Los Angeles Lakers' },
  MEM:  { espnId: 29, name: 'Grizzlies',     city: 'Memphis',        full: 'Memphis Grizzlies' },
  MIA:  { espnId: 14, name: 'Heat',          city: 'Miami',          full: 'Miami Heat' },
  MIL:  { espnId: 15, name: 'Bucks',         city: 'Milwaukee',      full: 'Milwaukee Bucks' },
  MIN:  { espnId: 16, name: 'Timberwolves',  city: 'Minnesota',      full: 'Minnesota Timberwolves' },
  NO:   { espnId: 3,  name: 'Pelicans',      city: 'Nueva Orleans',  full: 'New Orleans Pelicans' },
  NY:   { espnId: 18, name: 'Knicks',        city: 'Nueva York',     full: 'New York Knicks' },
  OKC:  { espnId: 25, name: 'Thunder',       city: 'Oklahoma City',  full: 'Oklahoma City Thunder' },
  ORL:  { espnId: 19, name: 'Magic',         city: 'Orlando',        full: 'Orlando Magic' },
  PHI:  { espnId: 20, name: '76ers',         city: 'Filadelfia',     full: 'Philadelphia 76ers' },
  PHX:  { espnId: 21, name: 'Suns',          city: 'Phoenix',        full: 'Phoenix Suns' },
  POR:  { espnId: 22, name: 'Trail Blazers', city: 'Portland',       full: 'Portland Trail Blazers' },
  SAC:  { espnId: 23, name: 'Kings',         city: 'Sacramento',     full: 'Sacramento Kings' },
  SA:   { espnId: 24, name: 'Spurs',         city: 'San Antonio',    full: 'San Antonio Spurs' },
  TOR:  { espnId: 28, name: 'Raptors',       city: 'Toronto',        full: 'Toronto Raptors' },
  UTAH: { espnId: 26, name: 'Jazz',          city: 'Utah',           full: 'Utah Jazz', altM: 1288 },
  WSH:  { espnId: 27, name: 'Wizards',       city: 'Washington',     full: 'Washington Wizards' },
};

/* nombre completo de The Odds API → abbr (el API también escribe
   "LA Clippers" en algunas casas; se acepta por palabra clave) */
const BY_FULL = {};
for (const ab in TEAMS) BY_FULL[TEAMS[ab].full.toLowerCase()] = ab;
BY_FULL['la clippers'] = 'LAC';
BY_FULL['la lakers'] = 'LAL';
function abbrFromFull(name) {
  const n = String(name || '').toLowerCase().trim();
  if (BY_FULL[n]) return BY_FULL[n];
  for (const ab in TEAMS) if (n.endsWith(TEAMS[ab].name.toLowerCase())) return ab;
  return null;
}

function logoUrl(abbr) {
  return 'https://a.espncdn.com/i/teamlogos/nba/500/' + String(abbr).toLowerCase() + '.png';
}

module.exports = { TEAMS, abbrFromFull, logoUrl };
