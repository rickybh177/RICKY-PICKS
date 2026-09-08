/* ============================================================
   EUROPA — nombres de equipo de The Odds API → id de ESPN.

   The Odds API publica cada partido con el nombre "largo" del club
   ("Brighton and Hove Albion", "Real Racing Club de Santander",
   "1. FC Köln") y ESPN lo identifica por un id numérico estable
   ("331", "87", "122"). Como TODO el modelo se indexa por ese id
   (lib/euro/leagues.js), aquí vive la traducción, liga por liga.

   Dos capas:
   1. NAMES: mapa explícito con cada nombre que el API nos ha dado
      (levantado en vivo el 5-sep-2026: 20 + 20 + 18 nombres, los 58
      equipos de 2026-27) más los alias que usa en otras temporadas
      o que ESPN escribe distinto ("Athletic Club" / "Athletic
      Bilbao", "FC Cologne" / "1. FC Köln", "Hamburg SV" /
      "Hamburger SV", "Málaga" / "Malaga CF"...).
   2. Respaldo por normalización contra los nombres de TEAMS (name y
      full): minúsculas, sin acentos, sin las siglas de club (FC, CF,
      SC, SV, AFC, 1., 04, 05, 07...). Si un nombre nuevo llega y no
      está en NAMES, esto lo rescata; si tampoco, se avisa UNA vez en
      el log (console.error) y el partido queda sin momios — nunca se
      inventa un empate de nombres ambiguo.
   ============================================================ */

const { TEAMS } = require('./leagues');

/* nombre del API → id de ESPN (string). Un id puede tener varios alias. */
const NAMES = {
  epl: {
    'Arsenal': '359',
    'Aston Villa': '362',
    'Bournemouth': '349', 'AFC Bournemouth': '349',
    'Brentford': '337',
    'Brighton and Hove Albion': '331', 'Brighton & Hove Albion': '331', 'Brighton': '331',
    'Chelsea': '363',
    'Coventry City': '388', 'Coventry': '388',
    'Crystal Palace': '384',
    'Everton': '368',
    'Fulham': '370',
    'Hull City': '306', 'Hull': '306',
    'Ipswich Town': '373', 'Ipswich': '373',
    'Leeds United': '357', 'Leeds': '357',
    'Liverpool': '364',
    'Manchester City': '382', 'Man City': '382',
    'Manchester United': '360', 'Man United': '360', 'Man Utd': '360',
    'Newcastle United': '361', 'Newcastle': '361',
    'Nottingham Forest': '393', "Nott'm Forest": '393', 'Nottm Forest': '393',
    'Sunderland': '366',
    'Tottenham Hotspur': '367', 'Tottenham': '367', 'Spurs': '367',
  },
  laliga: {
    'Alavés': '96', 'Alaves': '96', 'Deportivo Alavés': '96', 'Deportivo Alaves': '96',
    'Athletic Bilbao': '93', 'Athletic Club': '93', 'Athletic Club Bilbao': '93',
    'Atlético Madrid': '1068', 'Atletico Madrid': '1068', 'Atlético de Madrid': '1068',
    'Barcelona': '83', 'FC Barcelona': '83',
    'CA Osasuna': '97', 'Osasuna': '97',
    'Celta Vigo': '85', 'RC Celta': '85', 'Celta de Vigo': '85',
    'Deportivo La Coruña': '90', 'Deportivo La Coruna': '90', 'Deportivo de La Coruña': '90', 'Deportivo': '90',
    'Elche CF': '3751', 'Elche': '3751',
    'Espanyol': '88', 'RCD Espanyol': '88',
    'Getafe': '2922', 'Getafe CF': '2922',
    'Levante': '1538', 'Levante UD': '1538',
    'Málaga': '99', 'Malaga': '99', 'Málaga CF': '99', 'Malaga CF': '99',
    'Rayo Vallecano': '101',
    'Real Betis': '244', 'Betis': '244',
    'Real Madrid': '86',
    'Real Racing Club de Santander': '87', 'Racing Santander': '87', 'Racing de Santander': '87', 'Racing': '87',
    'Real Sociedad': '89',
    'Sevilla': '243', 'Sevilla FC': '243',
    'Valencia': '94', 'Valencia CF': '94',
    'Villarreal': '102', 'Villarreal CF': '102',
  },
  bundesliga: {
    '1. FC Köln': '122', '1. FC Koln': '122', 'FC Cologne': '122', 'FC Köln': '122', 'Köln': '122', 'Cologne': '122',
    'Augsburg': '3841', 'FC Augsburg': '3841',
    'Bayer Leverkusen': '131', 'Bayer 04 Leverkusen': '131', 'Leverkusen': '131',
    'Bayern Munich': '132', 'Bayern München': '132', 'FC Bayern Munich': '132', 'FC Bayern München': '132', 'Bayern': '132',
    'Borussia Dortmund': '124', 'Dortmund': '124',
    'Borussia Monchengladbach': '268', 'Borussia Mönchengladbach': '268', 'Gladbach': '268',
    'Eintracht Frankfurt': '125', 'Frankfurt': '125',
    'Elversberg': '10388', 'SV Elversberg': '10388',
    'FC Schalke 04': '133', 'Schalke 04': '133', 'Schalke': '133',
    'FSV Mainz 05': '2950', '1. FSV Mainz 05': '2950', 'Mainz 05': '2950', 'Mainz': '2950',
    'Hamburger SV': '127', 'Hamburg SV': '127', 'Hamburg': '127',
    'RB Leipzig': '11420', 'Leipzig': '11420',
    'SC Freiburg': '126', 'Freiburg': '126',
    'SC Paderborn': '3307', 'SC Paderborn 07': '3307', 'Paderborn': '3307',
    'TSG Hoffenheim': '7911', 'TSG 1899 Hoffenheim': '7911', 'Hoffenheim': '7911',
    'Union Berlin': '598', '1. FC Union Berlin': '598', 'FC Union Berlin': '598',
    'VfB Stuttgart': '134', 'Stuttgart': '134',
    'Werder Bremen': '137', 'SV Werder Bremen': '137', 'Bremen': '137',
  },
  /* Champions League 2026-27: 32 nombres levantados en vivo el 8-sep-2026
     (soccer_uefa_champs_league) + los 4 cuyos partidos ya habían
     empezado (LASK, AEK, Brujas, Villa) y alias habituales. */
  ucl: {
    'AEK Athens': '887', 'AEK Athens FC': '887', 'AEK': '887',
    'AS Roma': '104', 'Roma': '104',
    'Arsenal': '359',
    'Aston Villa': '362',
    'Atlético Madrid': '1068', 'Atletico Madrid': '1068', 'Atlético de Madrid': '1068',
    'Barcelona': '83', 'FC Barcelona': '83',
    'Bayern Munich': '132', 'Bayern München': '132', 'FC Bayern Munich': '132', 'Bayern': '132',
    'Bodø/Glimt': '2980', 'Bodo/Glimt': '2980', 'FK Bodø/Glimt': '2980', 'Bodø Glimt': '2980', 'Bodo Glimt': '2980',
    'Borussia Dortmund': '124', 'Dortmund': '124',
    'Club Brugge': '570', 'Club Brugge KV': '570', 'Club Bruges': '570', 'Brugge': '570',
    'Como': '2572', 'Como 1907': '2572',
    'Fenerbahce': '436', 'Fenerbahçe': '436', 'Fenerbahce SK': '436', 'Fenerbahçe SK': '436',
    'Feyenoord': '142', 'Feyenoord Rotterdam': '142',
    'Galatasaray': '432', 'Galatasaray SK': '432',
    'Inter Milan': '110', 'Internazionale': '110', 'Inter': '110', 'FC Internazionale Milano': '110',
    'LASK Linz': '4411', 'LASK': '4411',
    'Lille': '166', 'LOSC Lille': '166', 'Lille OSC': '166',
    'Liverpool': '364',
    'Manchester City': '382', 'Man City': '382',
    'Manchester United': '360', 'Man United': '360', 'Man Utd': '360',
    'Napoli': '114', 'SSC Napoli': '114',
    'PSV Eindhoven': '148', 'PSV': '148',
    'Paris Saint Germain': '160', 'Paris Saint-Germain': '160', 'PSG': '160', 'Paris SG': '160',
    'Porto': '437', 'FC Porto': '437',
    'RB Leipzig': '11420', 'Leipzig': '11420',
    'RC Lens': '175', 'Lens': '175',
    'Real Betis': '244', 'Betis': '244',
    'Real Madrid': '86',
    'Sabah FK': '21922', 'Sabah': '21922', 'Sabah FC': '21922',
    'Shakhtar Donetsk': '493', 'Shakhtar': '493', 'FC Shakhtar Donetsk': '493',
    'Slavia Praha': '494', 'Slavia Prague': '494', 'SK Slavia Praha': '494', 'SK Slavia Prague': '494',
    'Sporting Lisbon': '2250', 'Sporting CP': '2250', 'Sporting': '2250', 'Sporting Clube de Portugal': '2250',
    'VfB Stuttgart': '134', 'Stuttgart': '134',
    'Viking FK': '510', 'Viking': '510',
    'Villarreal': '102', 'Villarreal CF': '102',
    'ŠK Slovan Bratislava': '521', 'SK Slovan Bratislava': '521', 'Slovan Bratislava': '521', 'Slovan': '521',
  },
};

/* ---- normalización (misma para el nombre del API y para TEAMS) ---- */
const CLUB_TOKENS = new Set([
  'fc', 'cf', 'sc', 'sv', 'afc', 'club', 'cd', 'ud', 'rc', 'rcd', 'ca', 'de', 'and', 'the',
  'tsg', 'vfb', 'fsv', 'vfl', 'bsc', 'fsv', '1', '04', '05', '07', '1899', 'deportivo', 'real',
]);
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t && !CLUB_TOKENS.has(t))
    .join(' ');
}

/* índice normalizado por liga: 'brighton hove albion' → id (se arma una vez) */
const _normIndex = {};
function normIndex(leagueId) {
  if (_normIndex[leagueId]) return _normIndex[leagueId];
  const exact = new Map();  // normalizado → id
  const tokens = [];        // [{ id, set }] para el respaldo por palabras
  const teams = TEAMS[leagueId] || {};
  for (const id in teams) {
    for (const variant of [teams[id].name, teams[id].full]) {
      const n = normalize(variant);
      if (n) exact.set(n, id);
    }
    const set = new Set(normalize(teams[id].full + ' ' + teams[id].name).split(' '));
    tokens.push({ id, set });
  }
  for (const raw in (NAMES[leagueId] || {})) {
    const n = normalize(raw);
    if (n) exact.set(n, NAMES[leagueId][raw]);
  }
  return (_normIndex[leagueId] = { exact, tokens });
}

const _warned = new Set(); // `${liga}:${nombre}` ya avisado

/* Resuelve UN nombre del API dentro de una liga. */
function resolveName(leagueId, name) {
  if (!name) return null;
  const table = NAMES[leagueId] || {};
  if (table[name]) return table[name];
  const idx = normIndex(leagueId);
  const n = normalize(name);
  if (!n) return null;
  if (idx.exact.has(n)) return idx.exact.get(n);
  // respaldo por palabras: todas las palabras del nombre corto dentro del largo,
  // y SOLO si un único equipo cumple (sin adivinar entre dos)
  const words = new Set(n.split(' '));
  const hits = idx.tokens.filter(t => {
    const [small, big] = words.size <= t.set.size ? [words, t.set] : [t.set, words];
    for (const w of small) if (!big.has(w)) return false;
    return true;
  });
  if (hits.length === 1) return hits[0].id;
  const key = `${leagueId}:${name}`;
  if (!_warned.has(key)) {
    _warned.add(key);
    console.error(`euro/oddsnames: sin equipo para "${name}" en ${leagueId}` +
      (hits.length > 1 ? ` (ambiguo: ${hits.map(h => h.id).join(',')})` : '') +
      ' — agrégalo a NAMES');
  }
  return null;
}

/* nameToId[liga] = función (nombre → id | null), lista para
   getSoccerOdds(LEAGUES[liga].oddsKey, nameToId[liga]). */
const nameToId = {};
for (const leagueId in TEAMS) nameToId[leagueId] = name => resolveName(leagueId, name);

module.exports = { NAMES, nameToId, resolveName, normalize };
