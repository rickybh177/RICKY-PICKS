/* ============================================================
   EUROPA — catálogo de ligas y equipos (Premier, LaLiga,
   Bundesliga y Champions League; Serie A y Ligue 1 listas pero
   apagadas; más las ligas y copas que solo alimentan el ajuste
   conjunto de la Champions, marcadas fitOnly).

   TODO se indexa por el id de equipo de ESPN como string
   ("364" = Liverpool), nunca por abreviatura: la abreviatura
   cambia entre temporadas (Man City fue "MCI" y hoy es "MNC") y
   choca entre ligas ("MUN" es Bayern Múnich en ger.1 y Man United
   en eng.1). El id es estable en el histórico 2022-2026 y es el
   mismo que usa el CDN de logos.

   TEAMS trae las plantillas 2026-27 tal como las regresa ESPN
   /teams (name = shortDisplayName, sirve para la UI en español).
   city viene de la sede de sus partidos de local en la temporada
   en curso (ESPN /teams no trae estadio); '' si aún no ha jugado
   en casa. Se regenera con un script de una sola vez cuando cambia
   la plantilla (ascensos/descensos), no a mano — salvo tres sedes
   que ESPN trae mal y se corrigieron (Dortmund "Aue", Hamburg
   "Hamburg Norderstedt", Troyes "Paris"). La ciudad es solo para
   mostrar: el modelo no la usa (sin altitud en Europa).
   ============================================================ */

// Bandera de Inglaterra: secuencia de tags Unicode (no es un país ISO).
const FLAG_ENG = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';

const LEAGUES = {
  epl: {
    id: 'epl', espn: 'eng.1', name: 'Premier League', short: 'Premier',
    country: 'Inglaterra', flag: FLAG_ENG, oddsKey: 'soccer_epl',
    teamsCount: 20, rounds: 38, seasonLabel: '2026-27', seasonStart: '2026-08-01',
    histStart: '2022-07-01', histEnd: '2026-07-31', enabled: true,
  },
  laliga: {
    id: 'laliga', espn: 'esp.1', name: 'LaLiga', short: 'LaLiga',
    country: 'España', flag: '🇪🇸', oddsKey: 'soccer_spain_la_liga',
    teamsCount: 20, rounds: 38, seasonLabel: '2026-27', seasonStart: '2026-08-01',
    histStart: '2022-07-01', histEnd: '2026-07-31', enabled: true,
  },
  bundesliga: {
    id: 'bundesliga', espn: 'ger.1', name: 'Bundesliga', short: 'Bundesliga',
    country: 'Alemania', flag: '🇩🇪', oddsKey: 'soccer_germany_bundesliga',
    teamsCount: 18, rounds: 34, seasonLabel: '2026-27', seasonStart: '2026-08-01',
    histStart: '2022-07-01', histEnd: '2026-07-31', enabled: true,
  },
  seriea: {
    id: 'seriea', espn: 'ita.1', name: 'Serie A', short: 'Serie A',
    country: 'Italia', flag: '🇮🇹', oddsKey: 'soccer_italy_serie_a',
    teamsCount: 20, rounds: 38, seasonLabel: '2026-27', seasonStart: '2026-08-01',
    histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false,
  },
  ligue1: {
    id: 'ligue1', espn: 'fra.1', name: 'Ligue 1', short: 'Ligue 1',
    country: 'Francia', flag: '🇫🇷', oddsKey: 'soccer_france_ligue_one',
    teamsCount: 18, rounds: 34, seasonLabel: '2026-27', seasonStart: '2026-08-01',
    histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false,
  },

  /* ---- CHAMPIONS LEAGUE (copa: 36 clubes de 16 ligas) ----
     type 'cup' y comp 'uefa': sus partidos llevan nivel goleador y
     localía propios (LEAGUE.mu/hfa del archivo de priors son los
     europeos) y el "recién ascendido" es el debutante europeo.
     Como los 36 vienen de ligas distintas, los priors salen de UN
     ajuste conjunto sobre las ligas domésticas y las tres copas
     europeas (fitWith: los partidos europeos son los puentes que
     permiten comparar un Bayern con un Liverpool). En temporada el
     modelo aprende de la Champions Y de la liga de cada club
     (learnFrom), con el mu/hfa doméstico (LEAGUE.comps.dom).
     slugCheck false: el código ESPN ya es la competencia entera y
     sus slugs no llevan año ("league-phase", "round-of-16").
     ESPN NO incluye las rondas previas de clasificación (jul-ago),
     así que seasonStart puede ser 1-ago sin traer nada de más. */
  ucl: {
    id: 'ucl', espn: 'uefa.champions', name: 'Champions League', short: 'Champions',
    country: 'Europa', flag: '🏆', oddsKey: 'soccer_uefa_champs_league',
    teamsCount: 36, rounds: 8, seasonLabel: '2026-27', seasonStart: '2026-08-01',
    histStart: '2022-07-01', histEnd: '2026-07-31', enabled: true,
    type: 'cup', comp: 'uefa', slugCheck: false,
    learnFrom: ['epl', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'por', 'ned', 'tur', 'bel', 'aut', 'nor', 'gre'],
    fitWith: ['uel', 'uecl', 'epl', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'por', 'ned', 'tur', 'bel', 'aut', 'nor', 'gre', 'sco', 'den', 'cyp', 'swe'],
  },

  /* ---- SOLO PARA EL AJUSTE (fitOnly: no se venden, sin priors ni
     endpoint). Las dos copas europeas hermanas y las ligas domésticas
     de los clubes de Champions que ESPN cubre (Chequia, Eslovaquia,
     Ucrania y Azerbaiyán no están en ESPN: sus clubes se califican
     solo con sus partidos europeos). Noruega y Suecia juegan de marzo
     a noviembre: el "año" del archivo de histórico es solo un cubo. */
  uel:  { id: 'uel', espn: 'uefa.europa', name: 'Europa League', short: 'Europa League', country: 'Europa', flag: '🏆', teamsCount: 36, rounds: 8, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, comp: 'uefa', slugCheck: false, type: 'cup' },
  uecl: { id: 'uecl', espn: 'uefa.europa.conf', name: 'Conference League', short: 'Conference', country: 'Europa', flag: '🏆', teamsCount: 36, rounds: 6, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, comp: 'uefa', slugCheck: false, type: 'cup' },
  por:  { id: 'por', espn: 'por.1', name: 'Primeira Liga', short: 'Portugal', country: 'Portugal', flag: '🇵🇹', teamsCount: 18, rounds: 34, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  ned:  { id: 'ned', espn: 'ned.1', name: 'Eredivisie', short: 'Países Bajos', country: 'Países Bajos', flag: '🇳🇱', teamsCount: 18, rounds: 34, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  tur:  { id: 'tur', espn: 'tur.1', name: 'Süper Lig', short: 'Turquía', country: 'Turquía', flag: '🇹🇷', teamsCount: 18, rounds: 34, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  bel:  { id: 'bel', espn: 'bel.1', name: 'Pro League', short: 'Bélgica', country: 'Bélgica', flag: '🇧🇪', teamsCount: 16, rounds: 30, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  aut:  { id: 'aut', espn: 'aut.1', name: 'Bundesliga austriaca', short: 'Austria', country: 'Austria', flag: '🇦🇹', teamsCount: 12, rounds: 32, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  nor:  { id: 'nor', espn: 'nor.1', name: 'Eliteserien', short: 'Noruega', country: 'Noruega', flag: '🇳🇴', teamsCount: 16, rounds: 30, seasonLabel: '2026', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  gre:  { id: 'gre', espn: 'gre.1', name: 'Super League', short: 'Grecia', country: 'Grecia', flag: '🇬🇷', teamsCount: 14, rounds: 26, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  sco:  { id: 'sco', espn: 'sco.1', name: 'Premiership', short: 'Escocia', country: 'Escocia', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', teamsCount: 12, rounds: 38, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  den:  { id: 'den', espn: 'den.1', name: 'Superliga', short: 'Dinamarca', country: 'Dinamarca', flag: '🇩🇰', teamsCount: 12, rounds: 32, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  cyp:  { id: 'cyp', espn: 'cyp.1', name: 'Primera División chipriota', short: 'Chipre', country: 'Chipre', flag: '🇨🇾', teamsCount: 14, rounds: 32, seasonLabel: '2026-27', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
  swe:  { id: 'swe', espn: 'swe.1', name: 'Allsvenskan', short: 'Suecia', country: 'Suecia', flag: '🇸🇪', teamsCount: 16, rounds: 30, seasonLabel: '2026', seasonStart: '2026-08-01', histStart: '2022-07-01', histEnd: '2026-07-31', enabled: false, fitOnly: true, slugCheck: false },
};

/* Plantillas 2026-27 por liga, indexadas por id de ESPN (string). */
const TEAMS = {
  // Premier League 2026-27 — 20 equipos (ESPN eng.1)
  epl: {
    '359': { abbr: 'ARS', name: 'Arsenal', full: 'Arsenal', city: 'London' },
    '362': { abbr: 'AVL', name: 'Aston Villa', full: 'Aston Villa', city: 'Birmingham' },
    '349': { abbr: 'BOU', name: 'Bournemouth', full: 'AFC Bournemouth', city: 'Bournemouth' },
    '337': { abbr: 'BRE', name: 'Brentford', full: 'Brentford', city: 'Brentford' },
    '331': { abbr: 'BHA', name: 'Brighton', full: 'Brighton & Hove Albion', city: 'Falmer' },
    '384': { abbr: 'CRY', name: 'C Palace', full: 'Crystal Palace', city: 'London' },
    '363': { abbr: 'CHE', name: 'Chelsea', full: 'Chelsea', city: 'London' },
    '388': { abbr: 'COV', name: 'Coventry', full: 'Coventry City', city: 'Coventry' },
    '368': { abbr: 'EVE', name: 'Everton', full: 'Everton', city: 'Liverpool' },
    '370': { abbr: 'FUL', name: 'Fulham', full: 'Fulham', city: 'London' },
    '306': { abbr: 'HUL', name: 'Hull', full: 'Hull City', city: 'Hull' },
    '373': { abbr: 'IPS', name: 'Ipswich', full: 'Ipswich Town', city: 'Ipswich' },
    '357': { abbr: 'LEE', name: 'Leeds', full: 'Leeds United', city: 'Leeds' },
    '364': { abbr: 'LIV', name: 'Liverpool', full: 'Liverpool', city: 'Liverpool' },
    '382': { abbr: 'MNC', name: 'Man City', full: 'Manchester City', city: 'Manchester' },
    '360': { abbr: 'MAN', name: 'Man United', full: 'Manchester United', city: 'Manchester' },
    '361': { abbr: 'NEW', name: 'Newcastle', full: 'Newcastle United', city: 'Newcastle-upon-Tyne' },
    '393': { abbr: 'NFO', name: 'Nottm Forest', full: 'Nottingham Forest', city: 'Nottingham' },
    '367': { abbr: 'TOT', name: 'Spurs', full: 'Tottenham Hotspur', city: 'London' },
    '366': { abbr: 'SUN', name: 'Sunderland', full: 'Sunderland', city: 'Sunderland' },
  },
  // LaLiga 2026-27 — 20 equipos (ESPN esp.1)
  laliga: {
    '96': { abbr: 'ALA', name: 'Alavés', full: 'Alavés', city: 'Vitoria-Gasteiz' },
    '93': { abbr: 'ATH', name: 'Athletic', full: 'Athletic Club', city: 'Bilbao' },
    '1068': { abbr: 'ATM', name: 'Atlético', full: 'Atlético Madrid', city: 'Madrid' },
    '83': { abbr: 'BAR', name: 'Barcelona', full: 'Barcelona', city: 'Barcelona' },
    '244': { abbr: 'BET', name: 'Betis', full: 'Real Betis', city: 'Sevilla' },
    '85': { abbr: 'CEL', name: 'Celta Vigo', full: 'Celta Vigo', city: 'Vigo' },
    '90': { abbr: 'DEP', name: 'Deportivo', full: 'Deportivo', city: 'La Coruña' },
    '3751': { abbr: 'ELC', name: 'Elche', full: 'Elche', city: 'Elche' },
    '88': { abbr: 'ESP', name: 'Espanyol', full: 'Espanyol', city: 'Barcelona' },
    '2922': { abbr: 'GET', name: 'Getafe', full: 'Getafe', city: 'Getafe' },
    '1538': { abbr: 'LEV', name: 'Levante', full: 'Levante', city: 'Manises' },
    '99': { abbr: 'MCF', name: 'Málaga', full: 'Málaga', city: 'Malaga' },
    '97': { abbr: 'OSA', name: 'Osasuna', full: 'Osasuna', city: 'Pamplona' },
    '87': { abbr: 'RAC', name: 'Racing', full: 'Racing Santander', city: 'Santander' },
    '101': { abbr: 'RAY', name: 'Rayo', full: 'Rayo Vallecano', city: 'Madrid' },
    '86': { abbr: 'RMA', name: 'Real Madrid', full: 'Real Madrid', city: 'Madrid' },
    '89': { abbr: 'RSO', name: 'Real Sociedad', full: 'Real Sociedad', city: 'San Sebastian' },
    '243': { abbr: 'SEV', name: 'Sevilla', full: 'Sevilla', city: 'Sevilla' },
    '94': { abbr: 'VAL', name: 'Valencia', full: 'Valencia', city: 'Manises' },
    '102': { abbr: 'VIL', name: 'Villarreal', full: 'Villarreal', city: 'Villarreal' },
  },
  // Bundesliga 2026-27 — 18 equipos (ESPN ger.1)
  bundesliga: {
    '3841': { abbr: 'FCA', name: 'Augsburg', full: 'FC Augsburg', city: 'Augsburg' },
    '132': { abbr: 'MUN', name: 'Bayern', full: 'Bayern Munich', city: 'München' },
    '137': { abbr: 'SVW', name: 'Bremen', full: 'Werder Bremen', city: 'Bremen' },
    '122': { abbr: 'KOE', name: 'Cologne', full: 'FC Cologne', city: 'Cologne' },
    '124': { abbr: 'DOR', name: 'Dortmund', full: 'Borussia Dortmund', city: 'Dortmund' },
    '10388': { abbr: 'ELV', name: 'Elversberg', full: 'SV Elversberg', city: 'Spiesen-Elversberg' },
    '125': { abbr: 'SGE', name: 'Frankfurt', full: 'Eintracht Frankfurt', city: 'Frankfurt' },
    '126': { abbr: 'SCF', name: 'Freiburg', full: 'SC Freiburg', city: 'Freiburg im Breisgau' },
    '268': { abbr: 'BMG', name: 'Gladbach', full: 'Borussia Mönchengladbach', city: 'Mönchengladbach' },
    '127': { abbr: 'HSV', name: 'Hamburg', full: 'Hamburg SV', city: 'Hamburg' },
    '7911': { abbr: 'TSG', name: 'Hoffenheim', full: 'TSG Hoffenheim', city: 'Sinsheim' },
    '131': { abbr: 'B04', name: 'Leverkusen', full: 'Bayer Leverkusen', city: 'Leverkusen' },
    '2950': { abbr: 'M05', name: 'Mainz', full: 'Mainz', city: 'Mainz' },
    '3307': { abbr: 'SCP', name: 'Paderborn', full: 'SC Paderborn 07', city: 'Paderborn' },
    '11420': { abbr: 'RBL', name: 'RB Leipzig', full: 'RB Leipzig', city: 'Leipzig' },
    '133': { abbr: 'S04', name: 'Schalke', full: 'Schalke 04', city: 'Gelsenkirchen' },
    '134': { abbr: 'VFB', name: 'Stuttgart', full: 'VfB Stuttgart', city: 'Stuttgart' },
    '598': { abbr: 'FCU', name: 'Union Berlin', full: '1. FC Union Berlin', city: 'Berlin' },
  },
  // Serie A 2026-27 — 20 equipos (ESPN ita.1)
  seriea: {
    '104': { abbr: 'ROMA', name: 'AS Roma', full: 'AS Roma', city: 'Roma' },
    '105': { abbr: 'ATA', name: 'Atalanta', full: 'Atalanta', city: 'Bergamo' },
    '107': { abbr: 'BOL', name: 'Bologna', full: 'Bologna', city: 'Bologna' },
    '2925': { abbr: 'CAG', name: 'Cagliari', full: 'Cagliari', city: 'Cagliari' },
    '2572': { abbr: 'COMO', name: 'Como', full: 'Como', city: 'Como' },
    '109': { abbr: 'FIO', name: 'Fiorentina', full: 'Fiorentina', city: 'Firenze' },
    '4057': { abbr: 'FRO', name: 'Frosinone', full: 'Frosinone', city: 'Frosinone' },
    '3263': { abbr: 'GEN', name: 'Genoa', full: 'Genoa', city: 'Genova' },
    '110': { abbr: 'INT', name: 'Inter Milan', full: 'Internazionale', city: 'Milano' },
    '111': { abbr: 'JUV', name: 'Juventus', full: 'Juventus', city: 'Torino' },
    '112': { abbr: 'LAZ', name: 'Lazio', full: 'Lazio', city: 'Roma' },
    '113': { abbr: 'LEC', name: 'Lecce', full: 'Lecce', city: 'Lecce' },
    '103': { abbr: 'MIL', name: 'Milan', full: 'AC Milan', city: 'Milano' },
    '4007': { abbr: 'MON', name: 'Monza', full: 'Monza', city: 'Monza' },
    '114': { abbr: 'NAP', name: 'Napoli', full: 'Napoli', city: 'Napoli' },
    '115': { abbr: 'PAR', name: 'Parma', full: 'Parma', city: 'Parma' },
    '3997': { abbr: 'SAS', name: 'Sassuolo', full: 'Sassuolo', city: 'Reggio Emilia' },
    '239': { abbr: 'TOR', name: 'Torino', full: 'Torino', city: 'Torino' },
    '118': { abbr: 'UDI', name: 'Udinese', full: 'Udinese', city: 'Udine' },
    '17530': { abbr: 'VEN', name: 'Venezia', full: 'Venezia', city: 'Venezia' },
  },
  // Ligue 1 2026-27 — 18 equipos (ESPN fra.1)
  ligue1: {
    '7868': { abbr: 'ANG', name: 'Angers', full: 'Angers', city: 'Angers' },
    '172': { abbr: 'AUX', name: 'Auxerre', full: 'AJ Auxerre', city: 'Auxerre' },
    '6997': { abbr: 'BRE', name: 'Brest', full: 'Brest', city: 'Brest' },
    '3236': { abbr: 'HAC', name: 'Le Havre AC', full: 'Le Havre AC', city: 'Le Havre' },
    '2697': { abbr: 'MNS', name: 'Le Mans', full: 'Le Mans', city: 'Le Mans' },
    '175': { abbr: 'RCL', name: 'Lens', full: 'Lens', city: 'Lens' },
    '166': { abbr: 'LILL', name: 'Lille', full: 'Lille', city: 'Lille' },
    '273': { abbr: 'LOR', name: 'Lorient', full: 'Lorient', city: 'Lorient' },
    '167': { abbr: 'LYON', name: 'Lyon', full: 'Lyon', city: 'Lyon' },
    '176': { abbr: 'OLM', name: 'Marseille', full: 'Marseille', city: 'Marseille' },
    '174': { abbr: 'MON', name: 'Monaco', full: 'AS Monaco', city: 'Monaco' },
    '2502': { abbr: 'NICE', name: 'Nice', full: 'Nice', city: 'Nice' },
    '6851': { abbr: 'PAR', name: 'Paris FC', full: 'Paris FC', city: 'Paris' },
    '160': { abbr: 'PSG', name: 'PSG', full: 'Paris Saint-Germain', city: 'Paris' },
    '169': { abbr: 'REN', name: 'Rennes', full: 'Stade Rennais', city: 'Rennes' },
    '180': { abbr: 'STR', name: 'Strasbourg', full: 'Strasbourg', city: 'Strasbourg' },
    '179': { abbr: 'TOU', name: 'Toulouse', full: 'Toulouse', city: 'Toulouse' },
    '170': { abbr: 'TRY', name: 'Troyes', full: 'Troyes', city: 'Troyes' },
  },

  /* Los 36 de la fase de liga de la Champions 2026-27 (scoreboard de
     uefa.champions, 8-sep-2026). Mismos ids que en sus ligas (Real
     Madrid es 86 aquí y en LaLiga). Sin ciudad: la sede se muestra
     desde el evento. */
  ucl: {
    '887': { abbr: 'AEK', name: 'AEK Athens', full: 'AEK Athens', city: 'Atenas' },
    '104': { abbr: 'ROMA', name: 'Roma', full: 'AS Roma', city: 'Roma' },
    '359': { abbr: 'ARS', name: 'Arsenal', full: 'Arsenal', city: 'Londres' },
    '362': { abbr: 'AVL', name: 'Aston Villa', full: 'Aston Villa', city: 'Birmingham' },
    '1068': { abbr: 'ATM', name: 'Atlético', full: 'Atlético Madrid', city: 'Madrid' },
    '83': { abbr: 'BAR', name: 'Barcelona', full: 'Barcelona', city: 'Barcelona' },
    '132': { abbr: 'MUN', name: 'Bayern', full: 'Bayern Munich', city: 'Múnich' },
    '2980': { abbr: 'BODO', name: 'Bodø/Glimt', full: 'Bodø/Glimt', city: 'Bodø' },
    '124': { abbr: 'DOR', name: 'Dortmund', full: 'Borussia Dortmund', city: 'Dortmund' },
    '570': { abbr: 'BRU', name: 'Club Brugge', full: 'Club Brugge', city: 'Brujas' },
    '2572': { abbr: 'COMO', name: 'Como', full: 'Como', city: 'Como' },
    '437': { abbr: 'FCP', name: 'Porto', full: 'FC Porto', city: 'Oporto' },
    '436': { abbr: 'FEN', name: 'Fenerbahçe', full: 'Fenerbahçe', city: 'Estambul' },
    '142': { abbr: 'FEY', name: 'Feyenoord', full: 'Feyenoord Rotterdam', city: 'Róterdam' },
    '432': { abbr: 'GAL', name: 'Galatasaray', full: 'Galatasaray', city: 'Estambul' },
    '110': { abbr: 'INT', name: 'Inter', full: 'Internazionale', city: 'Milán' },
    '4411': { abbr: 'LAS', name: 'LASK', full: 'LASK Linz', city: 'Linz' },
    '175': { abbr: 'RCL', name: 'Lens', full: 'RC Lens', city: 'Lens' },
    '166': { abbr: 'LILL', name: 'Lille', full: 'Lille', city: 'Lille' },
    '364': { abbr: 'LIV', name: 'Liverpool', full: 'Liverpool', city: 'Liverpool' },
    '382': { abbr: 'MNC', name: 'Man City', full: 'Manchester City', city: 'Mánchester' },
    '360': { abbr: 'MAN', name: 'Man United', full: 'Manchester United', city: 'Mánchester' },
    '114': { abbr: 'NAP', name: 'Napoli', full: 'Napoli', city: 'Nápoles' },
    '148': { abbr: 'PSV', name: 'PSV', full: 'PSV Eindhoven', city: 'Eindhoven' },
    '160': { abbr: 'PSG', name: 'PSG', full: 'Paris Saint-Germain', city: 'París' },
    '11420': { abbr: 'RBL', name: 'RB Leipzig', full: 'RB Leipzig', city: 'Leipzig' },
    '244': { abbr: 'BET', name: 'Betis', full: 'Real Betis', city: 'Sevilla' },
    '86': { abbr: 'RMA', name: 'Real Madrid', full: 'Real Madrid', city: 'Madrid' },
    '21922': { abbr: 'SAB', name: 'Sabah', full: 'Sabah FK', city: 'Bakú' },
    '493': { abbr: 'SHK', name: 'Shakhtar', full: 'Shakhtar Donetsk', city: 'Donetsk' },
    '494': { abbr: 'SLP', name: 'Slavia Praga', full: 'Slavia Prague', city: 'Praga' },
    '521': { abbr: 'SLB', name: 'Slovan Bratislava', full: 'Slovan Bratislava', city: 'Bratislava' },
    '2250': { abbr: 'SCP', name: 'Sporting', full: 'Sporting CP', city: 'Lisboa' },
    '134': { abbr: 'VFB', name: 'Stuttgart', full: 'VfB Stuttgart', city: 'Stuttgart' },
    '510': { abbr: 'VIK', name: 'Viking', full: 'Viking FK', city: 'Stavanger' },
    '102': { abbr: 'VIL', name: 'Villarreal', full: 'Villarreal', city: 'Villarreal' },
  },
};

function logoUrl(id) {
  return id != null ? `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` : '';
}

/* Config de la liga o null si no existe (acepta 'epl', 'laliga'…). */
function leagueOf(id) {
  return (id && LEAGUES[String(id).toLowerCase()]) || null;
}

module.exports = { LEAGUES, TEAMS, logoUrl, leagueOf };
