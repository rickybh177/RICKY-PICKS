/* ============================================================
   NHL — metadatos de los 32 equipos.
   abbr: la de ESPN (es la llave de todo el modelo).
   full: nombre tal como lo publica The Odds API (match de momios).

   OJO con ESPN: la abreviatura de un mismo equipo cambia según el
   endpoint y la temporada (Utah sale como "UTAH" en /teams y en la
   2024-25, y como "UTA" en el scoreboard de 2025-26 en adelante), así
   que la identidad de un equipo se resuelve SIEMPRE por espnId
   (abbrOfId) y la abreviatura es solo nuestra llave canónica.
   Arizona (id 24) se mudó a Utah en 2024: mismo plantel, se trata
   como el mismo equipo para heredar su rating.
   ============================================================ */
const TEAMS = {
  ANA:  { espnId: 25,     name: 'Ducks',          city: 'Anaheim',       full: 'Anaheim Ducks' },
  BOS:  { espnId: 1,      name: 'Bruins',         city: 'Boston',        full: 'Boston Bruins' },
  BUF:  { espnId: 2,      name: 'Sabres',         city: 'Buffalo',       full: 'Buffalo Sabres' },
  CGY:  { espnId: 3,      name: 'Flames',         city: 'Calgary',       full: 'Calgary Flames' },
  CAR:  { espnId: 7,      name: 'Hurricanes',     city: 'Carolina',      full: 'Carolina Hurricanes' },
  CHI:  { espnId: 4,      name: 'Blackhawks',     city: 'Chicago',       full: 'Chicago Blackhawks' },
  COL:  { espnId: 17,     name: 'Avalanche',      city: 'Colorado',      full: 'Colorado Avalanche' },
  CBJ:  { espnId: 29,     name: 'Blue Jackets',   city: 'Columbus',      full: 'Columbus Blue Jackets' },
  DAL:  { espnId: 9,      name: 'Stars',          city: 'Dallas',        full: 'Dallas Stars' },
  DET:  { espnId: 5,      name: 'Red Wings',      city: 'Detroit',       full: 'Detroit Red Wings' },
  EDM:  { espnId: 6,      name: 'Oilers',         city: 'Edmonton',      full: 'Edmonton Oilers' },
  FLA:  { espnId: 26,     name: 'Panthers',       city: 'Florida',       full: 'Florida Panthers' },
  LA:   { espnId: 8,      name: 'Kings',          city: 'Los Ángeles',   full: 'Los Angeles Kings' },
  MIN:  { espnId: 30,     name: 'Wild',           city: 'Minnesota',     full: 'Minnesota Wild' },
  MTL:  { espnId: 10,     name: 'Canadiens',      city: 'Montreal',      full: 'Montreal Canadiens' },
  NSH:  { espnId: 27,     name: 'Predators',      city: 'Nashville',     full: 'Nashville Predators' },
  NJ:   { espnId: 11,     name: 'Devils',         city: 'Nueva Jersey',  full: 'New Jersey Devils' },
  NYI:  { espnId: 12,     name: 'Islanders',      city: 'Nueva York',    full: 'New York Islanders' },
  NYR:  { espnId: 13,     name: 'Rangers',        city: 'Nueva York',    full: 'New York Rangers' },
  OTT:  { espnId: 14,     name: 'Senators',       city: 'Ottawa',        full: 'Ottawa Senators' },
  PHI:  { espnId: 15,     name: 'Flyers',         city: 'Filadelfia',    full: 'Philadelphia Flyers' },
  PIT:  { espnId: 16,     name: 'Penguins',       city: 'Pittsburgh',    full: 'Pittsburgh Penguins' },
  SJ:   { espnId: 18,     name: 'Sharks',         city: 'San José',      full: 'San Jose Sharks' },
  SEA:  { espnId: 124292, name: 'Kraken',         city: 'Seattle',       full: 'Seattle Kraken' },
  STL:  { espnId: 19,     name: 'Blues',          city: 'San Luis',      full: 'St Louis Blues' },
  TB:   { espnId: 20,     name: 'Lightning',      city: 'Tampa Bay',     full: 'Tampa Bay Lightning' },
  TOR:  { espnId: 21,     name: 'Maple Leafs',    city: 'Toronto',       full: 'Toronto Maple Leafs' },
  UTAH: { espnId: 129764, name: 'Mammoth',        city: 'Utah',          full: 'Utah Mammoth', logo: 'utah' },
  VAN:  { espnId: 22,     name: 'Canucks',        city: 'Vancouver',     full: 'Vancouver Canucks' },
  VGK:  { espnId: 37,     name: 'Golden Knights', city: 'Las Vegas',     full: 'Vegas Golden Knights' },
  WSH:  { espnId: 23,     name: 'Capitals',       city: 'Washington',    full: 'Washington Capitals' },
  WPG:  { espnId: 28,     name: 'Jets',           city: 'Winnipeg',      full: 'Winnipeg Jets' },
};

/* espnId → abbr canónica. 24 = Arizona Coyotes (hasta 2023-24) → Utah. */
const ID_TO_ABBR = { 24: 'UTAH' };
for (const ab in TEAMS) ID_TO_ABBR[String(TEAMS[ab].espnId)] = ab;
function abbrOfId(id) { return ID_TO_ABBR[String(id)] || null; }

/* nombre completo de The Odds API → abbr. El API escribe "St Louis
   Blues" (sin punto), "Montréal Canadiens" (con acento) y Utah ha sido
   "Utah Hockey Club" y "Utah Mammoth": se normaliza y, si no casa
   exacto, se acepta por apodo al final del nombre. */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const BY_FULL = {};
for (const ab in TEAMS) BY_FULL[norm(TEAMS[ab].full)] = ab;
BY_FULL['utah hockey club'] = 'UTAH';
BY_FULL['utah'] = 'UTAH';
function abbrFromFull(name) {
  const n = norm(name);
  if (BY_FULL[n]) return BY_FULL[n];
  for (const ab in TEAMS) if (n.endsWith(norm(TEAMS[ab].name))) return ab;
  return null;
}

function logoUrl(abbr) {
  const t = TEAMS[abbr];
  return 'https://a.espncdn.com/i/teamlogos/nhl/500/' + ((t && t.logo) || String(abbr).toLowerCase()) + '.png';
}

module.exports = { TEAMS, abbrOfId, abbrFromFull, logoUrl };
