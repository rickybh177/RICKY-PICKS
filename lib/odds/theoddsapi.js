/* ============================================================
   THE ODDS API — momios de consenso multi-casas (mercado europeo/
   latam: Bet365, Betano, Pinnacle, etc.), el mismo pool de líneas
   que usan las casas mexicanas tipo Playdoit. Solo backend.

   Compartido por Liga MX y MLB (y disponible para NFL).
   - regions=eu (1 región = menos créditos y las líneas más
     cercanas a las casas MX; DraftKings US queda como fallback).
   - markets=h2h,totals (2 créditos por request).
   - Caché in-memory ODDS_TTL_MIN (default 15 min): con el plan
     de 20K créditos alcanza de sobra para 2-3 deportes.
   - Consenso por outcome = mediana de las probabilidades
     implícitas de todas las casas, convertida de vuelta a momio
     americano (la mediana de momios americanos directa se rompe
     en la discontinuidad ±100).
   - Si el API falla, se sirve el último valor bueno (stale es
     mejor que nada) y el caller siempre tiene fallback ESPN/DK.
   ============================================================ */

const KEY = process.env.ODDS_API_KEY || '';
// Plan gratis = 500 créditos/mes para TODO (Liga MX + MLB + NFL comparten
// la misma key). h2h+totals cuesta 2 créditos por consulta; a 6h de
// caché el consumo combinado queda ~420/mes, con margen. Al subir de
// plan, bajar ODDS_TTL_MIN en Vercel (ej. 15) para momios más frescos.
const TTL_MIN = Number(process.env.ODDS_TTL_MIN) || 360;

const _cache = new Map(); // sportKey -> { at, value }

async function fetchSport(sportKey) {
  if (!KEY) return null;
  const hit = _cache.get(sportKey);
  if (hit && Date.now() - hit.at < TTL_MIN * 60e3) return hit.value;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
      `?apiKey=${KEY}&regions=eu&markets=h2h,totals&oddsFormat=american`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error('respuesta inesperada');
    _cache.set(sportKey, { at: Date.now(), value: j });
    return j;
  } catch (e) {
    console.error('theoddsapi', sportKey, e.message);
    return hit ? hit.value : null; // stale > nada
  }
}

/* ---- utilidades ---- */
function amToProb(am) {
  const n = Number(String(am).replace('+', ''));
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
function probToAm(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p > 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}
function median(arr) {
  const a = arr.filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
/* mediana de momios americanos vía probabilidades implícitas */
function medAm(ams) {
  return probToAm(median(ams.map(amToProb)));
}

/* Casas de INTERCAMBIO (exchanges, no sportsbooks): el precio que
   publican es de la orden más agresiva del libro, no una línea de
   casa — con poca liquidez (común en MLB/Liga MX desde Europa)
   se dispara a extremos (ej. -100000) y arruina la mediana. */
const EXCHANGE_BOOKS = new Set(['betfair_ex_eu', 'betfair_ex_uk', 'betfair_ex_au', 'matchbook', 'smarkets']);

/* Consenso de UN evento del API. threeWay = fútbol (con empate). */
function consensus(ev, threeWay) {
  const mlH = [], mlA = [], mlD = [], totLines = [], tOv = [], tUn = [];
  for (const bk of (ev.bookmakers || [])) {
    if (EXCHANGE_BOOKS.has(bk.key)) continue;
    for (const mk of (bk.markets || [])) {
      const o = mk.outcomes || [];
      if (mk.key === 'h2h') {
        const h = o.find(x => x.name === ev.home_team);
        const a = o.find(x => x.name === ev.away_team);
        const d = o.find(x => x.name === 'Draw');
        if (h) mlH.push(h.price);
        if (a) mlA.push(a.price);
        if (d) mlD.push(d.price);
      } else if (mk.key === 'totals') {
        const ov = o.find(x => x.name === 'Over');
        const un = o.find(x => x.name === 'Under');
        if (ov && ov.point != null) { totLines.push(Number(ov.point)); tOv.push(ov.price); }
        if (un) tUn.push(un.price);
      }
    }
  }
  return {
    books: (ev.bookmakers || []).filter(bk => !EXCHANGE_BOOKS.has(bk.key)).length,
    commence: ev.commence_time,
    home_team: ev.home_team,
    away_team: ev.away_team,
    ml_home: medAm(mlH),
    ml_away: medAm(mlA),
    ml_draw: threeWay ? medAm(mlD) : null,
    total_line: median(totLines),
    total_over_odds: medAm(tOv),
    total_under_odds: medAm(tUn),
  };
}

/* ============================================================
   LIGA MX — mapeo de nombres de The Odds API a nuestras abbr.
   Nombres típicos del API: "Club América", "Cruz Azul",
   "Guadalajara Chivas", "Atlético San Luis", "Club Tijuana",
   "Santos Laguna", "Tigres UANL", "Pumas UNAM", "FC Juárez"…
   Matching por palabra clave sobre el nombre normalizado.
   ============================================================ */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MX_KEYWORDS = [
  ['america', 'AME'], ['cruz azul', 'CAZ'], ['chivas', 'GDL'], ['guadalajara', 'GDL'],
  ['tijuana', 'TIJ'], ['san luis', 'ASL'], ['juarez', 'JUA'], ['santos', 'SAN'],
  ['monterrey', 'MTY'], ['tigres', 'UANL'], ['pumas', 'UNAM'], ['unam', 'UNAM'],
  ['toluca', 'TOL'], ['leon', 'LEO'], ['pachuca', 'PAC'], ['puebla', 'PUE'],
  ['queretaro', 'QRO'], ['necaxa', 'NCX'], ['atlas', 'ATS'], ['atlante', 'ATL'],
];
function mxAbbr(name) {
  const n = norm(name);
  for (const [kw, abbr] of MX_KEYWORDS) if (n.includes(kw)) return abbr;
  return null;
}

/* Momios de consenso de Liga MX, ya con nuestras abbr.
   Regresa lista o null (sin key / API caído). */
/* Solo partidos que NO han iniciado: una vez arrancan, las casas
   pasan a precios EN VIVO (reflejan el marcador, no la previa) y
   contaminarían el consenso pre-partido. */
const isPreGame = ev => new Date(ev.commence_time).getTime() > Date.now();

async function getLigaMxOdds() {
  const events = await fetchSport('soccer_mexico_ligamx');
  if (!events) return null;
  return events.filter(isPreGame)
    .map(ev => ({ ...consensus(ev, true), home: mxAbbr(ev.home_team), away: mxAbbr(ev.away_team) }))
    .filter(e => e.home && e.away);
}

/* Busca el evento de consenso para un juego (abbr + fecha ±36 h). */
function findMxOdds(list, homeAbbr, awayAbbr, dateISO) {
  if (!list) return null;
  const t = new Date(dateISO).getTime();
  return list
    .filter(e => e.home === homeAbbr && e.away === awayAbbr &&
      Math.abs(new Date(e.commence).getTime() - t) < 36 * 3600e3)
    .sort((x, y) => Math.abs(new Date(x.commence) - t) - Math.abs(new Date(y.commence) - t))[0] || null;
}

/* ============================================================
   MLB — nombre completo del API ("Los Angeles Dodgers") → abbr.
   ============================================================ */
const MLB_NAMES = {
  'arizona diamondbacks': 'AZ', 'atlanta braves': 'ATL', 'baltimore orioles': 'BAL',
  'boston red sox': 'BOS', 'chicago cubs': 'CHC', 'chicago white sox': 'CWS',
  'cincinnati reds': 'CIN', 'cleveland guardians': 'CLE', 'colorado rockies': 'COL',
  'detroit tigers': 'DET', 'houston astros': 'HOU', 'kansas city royals': 'KC',
  'los angeles angels': 'LAA', 'los angeles dodgers': 'LAD', 'miami marlins': 'MIA',
  'milwaukee brewers': 'MIL', 'minnesota twins': 'MIN', 'new york mets': 'NYM',
  'new york yankees': 'NYY', 'oakland athletics': 'ATH', 'athletics': 'ATH',
  'philadelphia phillies': 'PHI', 'pittsburgh pirates': 'PIT', 'san diego padres': 'SD',
  'san francisco giants': 'SF', 'seattle mariners': 'SEA', 'st louis cardinals': 'STL',
  'st. louis cardinals': 'STL', 'tampa bay rays': 'TB', 'texas rangers': 'TEX',
  'toronto blue jays': 'TOR', 'washington nationals': 'WSH',
};
function mlbAbbr(name) {
  return MLB_NAMES[norm(name).replace(/\s+/g, ' ').trim()] || null;
}

/* Momios de consenso de MLB con el MISMO shape que produce
   lib/mlb/market.js (para que el modelo no cambie). */
function devigPair(pA, pB) {
  if (pA == null || pB == null) return [pA, pB];
  const s = pA + pB;
  return s > 0 ? [pA / s, pB / s] : [pA, pB];
}
async function getMlbOdds() {
  const events = await fetchSport('baseball_mlb');
  if (!events) return null;
  const out = [];
  for (const ev of events.filter(isPreGame)) {
    const c = consensus(ev, false);
    const home = mlbAbbr(ev.home_team), away = mlbAbbr(ev.away_team);
    if (!home || !away) continue;
    const [pH, pA] = devigPair(amToProb(c.ml_home), amToProb(c.ml_away));
    out.push({
      home, away,
      date: ev.commence_time,
      total: c.total_line,
      ml_home: c.ml_home, ml_away: c.ml_away,
      ml_home_prob: pH, ml_away_prob: pA,
      provider: `consenso ${c.books} casas`,
    });
  }
  return out;
}

const hasKey = () => !!KEY;

module.exports = { getLigaMxOdds, findMxOdds, getMlbOdds, hasKey, amToProb, probToAm, median };
