/* ============================================================
   LIGA MX — metadatos de los 18 equipos del Apertura 2026.
   espnId: id de ESPN (mex.1) para logos y matching.
   altM: altitud del estadio PROPIO en metros — la altitud pesa
   mucho en Liga MX (CDMX/Toluca/Pachuca vs equipos del nivel
   del mar). El ajuste del modelo usa la altitud de la SEDE real
   del partido (venue del scoreboard, vía CITY_ALT), con altM
   como respaldo; la del visitante siempre sale de su altM.
   Nota 2026: Atlante subió (fuera Mazatlán) y hay sedes
   temporales por las obras del Mundial — por eso nada de
   estadios fijos: la sede manda.
   ============================================================ */
const TEAMS = {
  AME:  { espnId: 227,   name: 'América',        city: 'Ciudad de México', stadium: 'Estadio Azteca',            altM: 2240 },
  ATL:  { espnId: 226,   name: 'Atlante',        city: 'Ciudad de México', stadium: 'Estadio Azulgrana',         altM: 2240 },
  ATS:  { espnId: 216,   name: 'Atlas',          city: 'Guadalajara',      stadium: 'Estadio Jalisco',           altM: 1560 },
  ASL:  { espnId: 15720, name: 'San Luis',       city: 'San Luis Potosí',  stadium: 'Estadio Alfonso Lastras',   altM: 1860 },
  CAZ:  { espnId: 218,   name: 'Cruz Azul',      city: 'Ciudad de México', stadium: 'Estadio Olímpico Universitario', altM: 2240 },
  JUA:  { espnId: 17851, name: 'Juárez',         city: 'Ciudad Juárez',    stadium: 'Estadio Olímpico Benito Juárez', altM: 1140 },
  GDL:  { espnId: 219,   name: 'Chivas',         city: 'Zapopan',          stadium: 'Estadio Akron',             altM: 1580 },
  LEO:  { espnId: 228,   name: 'León',           city: 'León',             stadium: 'Estadio León',              altM: 1800 },
  MTY:  { espnId: 220,   name: 'Monterrey',      city: 'Guadalupe',        stadium: 'Estadio BBVA',              altM: 540 },
  NCX:  { espnId: 229,   name: 'Necaxa',         city: 'Aguascalientes',   stadium: 'Estadio Victoria',          altM: 1880 },
  PAC:  { espnId: 234,   name: 'Pachuca',        city: 'Pachuca',          stadium: 'Estadio Hidalgo',           altM: 2400 },
  PUE:  { espnId: 231,   name: 'Puebla',         city: 'Puebla',           stadium: 'Estadio Cuauhtémoc',        altM: 2135 },
  UNAM: { espnId: 233,   name: 'Pumas',          city: 'Ciudad de México', stadium: 'Estadio Olímpico Universitario', altM: 2240 },
  QRO:  { espnId: 222,   name: 'Querétaro',      city: 'Querétaro',        stadium: 'Estadio Corregidora',       altM: 1820 },
  SAN:  { espnId: 225,   name: 'Santos',         city: 'Torreón',          stadium: 'Estadio Corona',            altM: 1120 },
  UANL: { espnId: 232,   name: 'Tigres',         city: 'San Nicolás',      stadium: 'Estadio Universitario',     altM: 500 },
  TIJ:  { espnId: 10125, name: 'Tijuana',        city: 'Tijuana',          stadium: 'Estadio Caliente',          altM: 25 },
  TOL:  { espnId: 223,   name: 'Toluca',         city: 'Toluca',           stadium: 'Estadio Nemesio Díez',      altM: 2660 },
};

/* Altitud (m) por ciudad sede — cubre sedes actuales, temporales
   y plazas históricas que aparecen en los datos 2024-2026. */
const CITY_ALT = {
  'ciudad de mexico': 2240, 'mexico city': 2240, 'cdmx': 2240, 'distrito federal': 2240,
  'toluca': 2660, 'pachuca': 2400, 'puebla': 2135,
  'queretaro': 1820, 'aguascalientes': 1880, 'leon': 1800,
  'guadalajara': 1560, 'zapopan': 1580, 'san luis potosi': 1860,
  'torreon': 1120, 'ciudad juarez': 1140, 'juarez': 1140,
  'monterrey': 540, 'guadalupe': 540, 'san nicolas de los garza': 500, 'san nicolas': 500,
  'tijuana': 25, 'cancun': 10, 'mazatlan': 10, 'morelia': 1920,
  'hermosillo': 210, 'culiacan': 60, 'veracruz': 10, 'merida': 10,
  'tampico': 10, 'ciudad madero': 10, 'chihuahua': 1440, 'celaya': 1750,
  'irapuato': 1720, 'zacatecas': 2440, 'oaxaca': 1550, 'cuernavaca': 1510,
};

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/* Altitud de la sede real del partido; respaldo: estadio del local. */
function venueAltitude(venueCity, homeAbbr) {
  const byCity = CITY_ALT[norm(venueCity)];
  if (byCity != null) return byCity;
  const t = TEAMS[homeAbbr];
  return t ? t.altM : 1000;
}

function logoUrl(abbr) {
  const t = TEAMS[abbr];
  return t ? `https://a.espncdn.com/i/teamlogos/soccer/500/${t.espnId}.png` : '';
}

module.exports = { TEAMS, CITY_ALT, venueAltitude, logoUrl, norm };
