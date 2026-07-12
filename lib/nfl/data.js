/* ============================================================
   NFL — capa de datos. Solo backend.
   - ESPN site API (gratis, sin key): calendario, resultados,
     momios de referencia (spread/total del scoreboard).
   - Open-Meteo (gratis, sin key): clima por estadio si el juego
     está dentro de la ventana de pronóstico (~16 días).
   Caché in-memory con TTL, mismo patrón que lib/mlb/statsapi.js.
   ============================================================ */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

const _cache = new Map(); // url -> { at, ttl, value }

async function fetchJson(url, ttlMs = 10 * 60 * 1000) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ricky-picks/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
      const j = await r.json();
      _cache.set(url, { at: Date.now(), ttl: ttlMs, value: j });
      return j;
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---- Un juego del scoreboard de ESPN a nuestro formato ---- */
function parseEvent(ev) {
  const c = (ev.competitions || [])[0] || {};
  const comp = c.competitors || [];
  const homeC = comp.find(x => x.homeAway === 'home') || {};
  const awayC = comp.find(x => x.homeAway === 'away') || {};
  const side = x => ({
    abbr: x.team ? x.team.abbreviation : null,
    name: x.team ? (x.team.shortDisplayName || x.team.name) : null,
    full: x.team ? x.team.displayName : null,   // "Kansas City Chiefs" (match con The Odds API)
    record: (x.records && x.records[0] && x.records[0].summary) || '',
    score: x.score != null ? Number(x.score) : null,
  });
  const odds = (c.odds && c.odds[0]) || null;
  const status = (ev.status && ev.status.type) || {};
  return {
    id: ev.id,
    date: ev.date,                       // ISO UTC
    week: ev.week && ev.week.number,
    venue: (c.venue && c.venue.fullName) || '',
    indoor: !!(c.venue && c.venue.indoor),
    neutral: !!c.neutralSite,
    state: status.state || 'pre',        // pre | in | post
    detail: status.shortDetail || '',
    home: side(homeC),
    away: side(awayC),
    // Momios de referencia del scoreboard (ESPN BET):
    //   details "SEA -3.5" (spread con el favorito), overUnder 44.5
    market: odds ? {
      details: odds.details || null,
      over_under: odds.overUnder != null ? Number(odds.overUnder) : null,
      spread: odds.spread != null ? Number(odds.spread) : null, // línea del local
      home_ml: odds.homeTeamOdds && odds.homeTeamOdds.moneyLine != null ? Number(odds.homeTeamOdds.moneyLine) : null,
      away_ml: odds.awayTeamOdds && odds.awayTeamOdds.moneyLine != null ? Number(odds.awayTeamOdds.moneyLine) : null,
    } : null,
  };
}

/* Calendario/resultados de una semana de temporada regular. */
async function getWeek(year, week) {
  const url = `${ESPN}/scoreboard?dates=${year}&seasontype=2&week=${week}`;
  // Semana en curso: TTL corto. Semanas pasadas quedan cacheadas más tiempo.
  const j = await fetchJson(url, 5 * 60 * 1000);
  return (j.events || []).map(parseEvent);
}

/* Semana "actual" según ESPN (antes del kickoff regresa la 1). */
async function getCurrentWeek() {
  try {
    const j = await fetchJson(`${ESPN}/scoreboard`, 10 * 60 * 1000);
    const w = j.week && j.week.number;
    const type = j.leagues && j.leagues[0] && j.leagues[0].season && j.leagues[0].season.type && j.leagues[0].season.type.type;
    // Fuera de temporada regular (pre/post), default semana 1.
    if (type !== 2 || !w) return 1;
    return Math.min(Math.max(1, w), 18);
  } catch (e) { return 1; }
}

/* Resultados terminados de las semanas 1..upto (para actualizar ratings). */
async function getSeasonResults(year, upto) {
  const out = [];
  const jobs = [];
  for (let w = 1; w <= upto; w++) jobs.push(getWeek(year, w));
  const weeks = await Promise.all(jobs);
  for (const games of weeks) {
    for (const g of games) {
      if (g.state === 'post' && g.home.score != null && g.away.score != null) out.push(g);
    }
  }
  return out;
}

/* ---- Clima (Open-Meteo) — solo estadios abiertos y sede local ---- */
async function getWeather(lat, lon, kickoffISO) {
  try {
    const kick = new Date(kickoffISO);
    const horizon = (kick - Date.now()) / 86400000;
    if (!isFinite(horizon) || horizon < -0.5 || horizon > 15.5) return null; // fuera de ventana
    const day = kickoffISO.slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,wind_speed_10m,precipitation_probability&timezone=UTC` +
      `&start_date=${day}&end_date=${day}&wind_speed_unit=mph&temperature_unit=fahrenheit`;
    const j = await fetchJson(url, 60 * 60 * 1000);
    const hours = (j.hourly && j.hourly.time) || [];
    const hourKey = kickoffISO.slice(0, 13) + ':00';
    let i = hours.indexOf(hourKey);
    if (i < 0) i = Math.max(0, hours.length - 1);
    return {
      temp_f: j.hourly.temperature_2m ? j.hourly.temperature_2m[i] : null,
      wind_mph: j.hourly.wind_speed_10m ? j.hourly.wind_speed_10m[i] : null,
      precip_pct: j.hourly.precipitation_probability ? j.hourly.precipitation_probability[i] : null,
    };
  } catch (e) { return null; }
}

module.exports = { fetchJson, getWeek, getCurrentWeek, getSeasonResults, getWeather };
