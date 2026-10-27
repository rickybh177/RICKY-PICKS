/* ============================================================
   NBA — capa de datos. Solo backend.
   ESPN site API (gratis, sin key), mismo espejo y User-Agent que
   lib/nfl/data.js (site.api.espn.com regresa 403 a IPs de
   datacenter; site.web.api.espn.com sirve lo mismo y no bloquea):
   - scoreboard?dates=YYYYMMDD → calendario, marcadores y parciales
     por cuarto (linescores) de un día.
   - summary?event=ID → boxscore: estadísticas de equipo (para el
     ritmo: posesiones) y de cada jugador (minutos, puntos, rebotes,
     asistencias, triples…), con quién no jugó.
   - injuries → reporte de lesiones vigente de los 30 equipos.
   - core API …/competitions/ID/odds → línea de CIERRE histórica
     (spread, total, moneyline) por casa: con esto el backtest se
     mide contra el mercado real, no contra una línea inventada.
   Caché in-memory con TTL (los juegos terminados no cambian).
   ============================================================ */

const ESPN = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_FALLBACK = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.espn.com/',
};
const { TEAMS } = require('./teams');
const VALID_IDS = new Set(Object.values(TEAMS).map(t => String(t.espnId)));
const ID_TO_ABBR = {};
for (const ab in TEAMS) ID_TO_ABBR[String(TEAMS[ab].espnId)] = ab;

const _cache = new Map(); // url -> { at, ttl, value }

async function fetchJson(url, ttlMs = 10 * 60 * 1000) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    const tryUrl = i === 2 && url.startsWith(ESPN) ? url.replace(ESPN, ESPN_FALLBACK) : url;
    try {
      const r = await fetch(tryUrl, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${tryUrl}`);
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

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/* "39-83" → [39, 83] */
const pair = v => { const [a, b] = String(v || '0-0').split('-'); return [num(a) || 0, num(b) || 0]; };

/* ---- Un juego del scoreboard a nuestro formato ---- */
function parseEvent(ev) {
  const c = (ev.competitions || [])[0] || {};
  const comp = c.competitors || [];
  const homeC = comp.find(x => x.homeAway === 'home') || {};
  const awayC = comp.find(x => x.homeAway === 'away') || {};
  const side = x => ({
    espnId: x.team ? String(x.team.id) : null,
    abbr: x.team ? x.team.abbreviation : null,
    name: x.team ? (x.team.shortDisplayName || x.team.name) : null,
    full: x.team ? x.team.displayName : null,
    record: (x.records && x.records[0] && x.records[0].summary) || '',
    score: x.score != null ? Number(x.score) : null,
    // parciales por periodo (4 cuartos + prórrogas)
    q: Array.isArray(x.linescores) ? x.linescores.map(l => num(l.value)) : null,
  });
  const status = (ev.status && ev.status.type) || {};
  return {
    id: String(ev.id),
    date: ev.date,                          // ISO UTC
    seasontype: ev.season && ev.season.type, // 1 pre | 2 regular | 3 playoffs | 5 play-in
    seasonYear: ev.season && ev.season.year, // 2026 = temporada 2025-26
    venue: (c.venue && c.venue.fullName) || '',
    neutral: !!c.neutralSite,
    state: status.state || 'pre',            // pre | in | post
    detail: status.shortDetail || '',
    home: side(homeC),
    away: side(awayC),
  };
}

/* ¿Es un juego de la liga de verdad? Fuera el All-Star (equipos con
   ids inventados) y cualquier exhibición. */
function isLeagueGame(g) {
  return g.home.espnId && g.away.espnId && VALID_IDS.has(g.home.espnId) && VALID_IDS.has(g.away.espnId)
    && g.seasontype !== 1 && g.home.abbr !== g.away.abbr;
}

/* Juegos de UN día (YYYYMMDD, fecha de ESPN = hora del Este). */
async function getDay(yyyymmdd, ttlMs) {
  const url = `${ESPN}/scoreboard?dates=${yyyymmdd}&limit=100`;
  const j = await fetchJson(url, ttlMs != null ? ttlMs : 5 * 60 * 1000);
  return (j.events || []).map(parseEvent).filter(isLeagueGame);
}

function ymd(d) {
  const x = new Date(d);
  return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
}
function addDays(d, n) { return new Date(new Date(d).getTime() + n * 86400000); }

/* Juegos de un rango de días [from, to] (Date o ISO). Días pasados con
   TTL largo (ya no cambian), hoy/mañana con TTL corto. */
async function getRange(from, to, { concurrency = 6 } = {}) {
  const days = [];
  for (let d = new Date(from); d <= new Date(to); d = addDays(d, 1)) days.push(ymd(d));
  const todayYmd = ymd(new Date());
  const out = new Array(days.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, days.length) }, async () => {
    while (i < days.length) {
      const k = i++;
      const ttl = days[k] < todayYmd - 1 ? 24 * 3600 * 1000 : 5 * 60 * 1000;
      try { out[k] = await getDay(days[k], ttl); } catch (e) { out[k] = []; }
    }
  }));
  return out.flat();
}

/* ---- boxscore de un juego (summary) → compacto ---- */
const STAT_KEYS = {
  min: 'minutes', pts: 'points', fg: 'fieldGoalsMade-fieldGoalsAttempted', tp: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  ft: 'freeThrowsMade-freeThrowsAttempted', reb: 'rebounds', ast: 'assists', tov: 'turnovers', stl: 'steals', blk: 'blocks',
  oreb: 'offensiveRebounds', dreb: 'defensiveRebounds', pf: 'fouls',
};
function parseSummary(j) {
  const h = j.header || {};
  const comp = (h.competitions || [])[0] || {};
  const comps = comp.competitors || [];
  const homeC = comps.find(c => c.homeAway === 'home') || {};
  const awayC = comps.find(c => c.homeAway === 'away') || {};
  const home = homeC.team && homeC.team.abbreviation;
  const away = awayC.team && awayC.team.abbreviation;

  // estadísticas de equipo → posesiones (FGA − OREB + TOV + 0.44·FTA)
  const team = {};
  for (const t of (j.boxscore && j.boxscore.teams) || []) {
    const ab = t.team && t.team.abbreviation;
    const s = {};
    for (const st of t.statistics || []) s[st.name] = st.displayValue;
    const [fgm, fga] = pair(s['fieldGoalsMade-fieldGoalsAttempted']);
    const [tpm, tpa] = pair(s['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
    const [ftm, fta] = pair(s['freeThrowsMade-freeThrowsAttempted']);
    const oreb = num(s.offensiveRebounds) || 0;
    const tov = num(s.totalTurnovers) != null ? num(s.totalTurnovers) : (num(s.turnovers) || 0);
    team[ab] = {
      fgm, fga, tpm, tpa, ftm, fta, oreb, dreb: num(s.defensiveRebounds) || 0, reb: num(s.totalRebounds) || 0,
      ast: num(s.assists) || 0, tov,
      poss: +(fga - oreb + tov + 0.44 * fta).toFixed(1),
    };
  }

  const players = [];
  for (const t of (j.boxscore && j.boxscore.players) || []) {
    const ab = t.team && t.team.abbreviation;
    const st = (t.statistics || [])[0];
    if (!st) continue;
    const keys = st.keys || [];
    const ix = {};
    for (const k in STAT_KEYS) ix[k] = keys.indexOf(STAT_KEYS[k]);
    const get = (arr, k) => (ix[k] >= 0 ? arr[ix[k]] : null);
    for (const a of st.athletes || []) {
      const ath = a.athlete || {};
      if (!ath.id) continue;
      const s = a.stats || [];
      const dnp = !!a.didNotPlay || !s.length;
      const [fgm, fga] = pair(get(s, 'fg'));
      const [tpm, tpa] = pair(get(s, 'tp'));
      const [ftm, fta] = pair(get(s, 'ft'));
      players.push({
        id: String(ath.id), name: ath.displayName, team: ab,
        pos: (ath.position && ath.position.abbreviation) || null,
        starter: !!a.starter, dnp, reason: dnp ? (a.reason || null) : null,
        min: dnp ? 0 : (num(get(s, 'min')) || 0),
        pts: dnp ? 0 : (num(get(s, 'pts')) || 0),
        reb: dnp ? 0 : (num(get(s, 'reb')) || 0),
        ast: dnp ? 0 : (num(get(s, 'ast')) || 0),
        tpm, tpa, fgm, fga, ftm, fta,
        oreb: dnp ? 0 : (num(get(s, 'oreb')) || 0), dreb: dnp ? 0 : (num(get(s, 'dreb')) || 0),
        stl: dnp ? 0 : (num(get(s, 'stl')) || 0), blk: dnp ? 0 : (num(get(s, 'blk')) || 0),
        tov: dnp ? 0 : (num(get(s, 'tov')) || 0), pf: dnp ? 0 : (num(get(s, 'pf')) || 0),
      });
    }
  }
  return {
    eventId: String(h.id || ''),
    date: comp.date || null,
    home, away,
    homeScore: homeC.score != null ? Number(homeC.score) : null,
    awayScore: awayC.score != null ? Number(awayC.score) : null,
    team, players,
  };
}
async function getSummary(eventId, ttlMs = 24 * 3600 * 1000) {
  const j = await fetchJson(`${ESPN}/summary?event=${eventId}`, ttlMs);
  return parseSummary(j);
}

/* ---- línea de CIERRE histórica (core API) ----
   Casas en orden de preferencia (las "Live Odds" son en vivo: fuera).
   Devuelve { spread (línea del LOCAL), total, ml_home, ml_away,
   spread_home_odds, spread_away_odds, over_odds, under_odds, provider }
   o null. */
const PROVIDER_PRIORITY = ['58', '40', '45', '47', '36', '52', '57', '48', '41', '50', '53', '1001'];
function parseCloseOdds(j, homeAbbr, awayAbbr) {
  const items = (j.items || []).filter(it => it.provider && !/live/i.test(it.provider.name || ''));
  if (!items.length) return null;
  items.sort((a, b) => {
    const pa = PROVIDER_PRIORITY.indexOf(String(a.provider.id)), pb = PROVIDER_PRIORITY.indexOf(String(b.provider.id));
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  const am = o => (o && o.american != null ? num(String(o.american).replace('+', '')) : null);
  for (const it of items) {
    const ho = it.homeTeamOdds || {}, ao = it.awayTeamOdds || {};
    const hc = ho.close || {}, ac = ao.close || {}, tc = it.close || {};
    // spread del local: cierre si existe; si no, el "details" ("ORL -6.5")
    let spread = hc.pointSpread ? am(hc.pointSpread) : null;
    if (spread == null && it.details && it.spread != null) {
      const m = /^([A-Z]+)\s+([+-]?\d+(\.\d+)?)/.exec(String(it.details).trim());
      if (m) {
        const v = Number(m[2]);
        if (m[1] === homeAbbr) spread = v;
        else if (m[1] === awayAbbr) spread = -v;
      }
    }
    /* la línea del total viene como texto en `american` /
       `alternateDisplayValue` ("233.5"); `value` a veces es el PRECIO
       (1.909), no la línea */
    const lineOf = o => (o ? (num(o.american) != null ? num(o.american) : num(o.alternateDisplayValue) != null ? num(o.alternateDisplayValue) : (o.value != null && o.value > 60 ? num(o.value) : null)) : null);
    const total = lineOf(tc.total) != null ? lineOf(tc.total) : (it.overUnder != null ? num(it.overUnder) : null);
    const mlH = hc.moneyLine ? am(hc.moneyLine) : (ho.moneyLine != null ? num(ho.moneyLine) : null);
    const mlA = ac.moneyLine ? am(ac.moneyLine) : (ao.moneyLine != null ? num(ao.moneyLine) : null);
    if (spread == null && total == null && mlH == null) continue;
    // APERTURA (para medir si el modelo anticipa el movimiento de la línea)
    const hoOpen = ho.open || {}, aoOpen = ao.open || {}, tOpen = it.open || {};
    const openSpread = hoOpen.pointSpread ? am(hoOpen.pointSpread) : null;
    const openTotal = lineOf(tOpen.total);
    return {
      spread, total, ml_home: mlH, ml_away: mlA,
      open_spread: openSpread, open_total: openTotal,
      open_ml_home: hoOpen.moneyLine ? am(hoOpen.moneyLine) : null, open_ml_away: aoOpen.moneyLine ? am(aoOpen.moneyLine) : null,
      spread_home_odds: hc.spread ? am(hc.spread) : (ho.spreadOdds != null ? num(ho.spreadOdds) : null),
      spread_away_odds: ac.spread ? am(ac.spread) : (ao.spreadOdds != null ? num(ao.spreadOdds) : null),
      over_odds: tc.over ? am(tc.over) : (it.overOdds != null ? num(it.overOdds) : null),
      under_odds: tc.under ? am(tc.under) : (it.underOdds != null ? num(it.underOdds) : null),
      provider: it.provider.name,
    };
  }
  return null;
}
async function getCloseOddsRaw(eventId) {
  return fetchJson(`${CORE}/events/${eventId}/competitions/${eventId}/odds`, 24 * 3600 * 1000);
}
async function getCloseOdds(eventId, homeAbbr, awayAbbr) {
  try { return parseCloseOdds(await getCloseOddsRaw(eventId), homeAbbr, awayAbbr); } catch (e) { return null; }
}

/* ---- lesiones vigentes → Map abbr → [{id, name, status, comment}] ----
   status: Out | Doubtful | Questionable | Day-To-Day | Probable… */
async function getInjuries() {
  const out = new Map();
  try {
    const j = await fetchJson(`${ESPN}/injuries`, 30 * 60 * 1000);
    for (const t of j.injuries || []) {
      /* el reporte viene por id de equipo ('1' = ATL), sin abreviatura */
      const ab = t.abbreviation || (t.team && t.team.abbreviation) || ID_TO_ABBR[String(t.id)];
      if (!ab) continue;
      const list = [];
      for (const i of t.injuries || []) {
        const a = i.athlete || {};
        /* el atleta no trae `id` directo: viene dentro del link a su
           ficha (…/player/_/id/4712863/…); si no, se casa por nombre */
        let id = a.id ? String(a.id) : null;
        if (!id) for (const l of a.links || []) { const m = /\/id\/(\d+)/.exec(l.href || ''); if (m) { id = m[1]; break; } }
        list.push({ id, name: a.displayName || '', status: i.status || '', comment: i.shortComment || '', date: i.date || null });
      }
      out.set(ab, list);
    }
  } catch (e) { /* sin reporte: el modelo sigue, sin ajuste de ausencias */ }
  return out;
}

module.exports = { fetchJson, parseEvent, isLeagueGame, getDay, getRange, getSummary, parseSummary, getCloseOdds, getCloseOddsRaw, parseCloseOdds, getInjuries, ymd, addDays };
