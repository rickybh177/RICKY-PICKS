/* ============================================================
   NHL — capa de datos. Solo backend.
   ESPN site API (gratis, sin key), mismo espejo y User-Agent que
   lib/nba/data.js (site.api.espn.com regresa 403 a IPs de
   datacenter; site.web.api.espn.com sirve lo mismo y no bloquea):
   - scoreboard?dates=YYYYMMDD → calendario, marcadores, goles por
     periodo (linescores: 3 periodos + tiempo extra + penales), el
     PORTERO PROBABLE de cada equipo (probables: "Confirmed" /
     "Expected") y las atajadas del día (statistics).
   - summary?event=ID → boxscore: tiros a puerta, tiros fallados y
     bloqueados, power play, porteros (tiros recibidos, goles, minutos)
     y la jugada por jugada, de donde salen los goles a PUERTA VACÍA
     (strength "Empty Net").
   - core API …/competitions/ID/odds → línea de APERTURA y CIERRE
     histórica (moneyline, línea de gol ±1.5 y total) por casa: con
     esto el backtest se mide contra el mercado real.
   Caché in-memory con TTL (los juegos terminados no cambian).
   ============================================================ */

const ESPN = 'https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl';
const ESPN_FALLBACK = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.espn.com/',
};
const { abbrOfId } = require('./teams');

const _cache = new Map(); // url -> { at, ttl, value }

/* cache:false → no guarda en memoria (los scripts de histórico bajan
   miles de summaries de ~450 KB; guardarlos todos revienta la RAM) */
async function fetchJson(url, ttlMs = 10 * 60 * 1000, { cache = true } = {}) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    const tryUrl = i === 2 && url.startsWith(ESPN) ? url.replace(ESPN, ESPN_FALLBACK) : url;
    try {
      const r = await fetch(tryUrl, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${tryUrl}`);
      const j = await r.json();
      if (cache) _cache.set(url, { at: Date.now(), ttl: ttlMs, value: j });
      return j;
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/* "62:44" → 62.73 minutos */
const toiMin = v => { const m = /^(\d+):(\d+)$/.exec(String(v || '')); return m ? +(Number(m[1]) + Number(m[2]) / 60).toFixed(2) : (num(v) || 0); };

/* ---- Un juego del scoreboard a nuestro formato ---- */
function parseEvent(ev) {
  const c = (ev.competitions || [])[0] || {};
  const comp = c.competitors || [];
  const homeC = comp.find(x => x.homeAway === 'home') || {};
  const awayC = comp.find(x => x.homeAway === 'away') || {};
  const side = x => {
    const id = x.team ? String(x.team.id) : null;
    const st = {};
    for (const s of x.statistics || []) st[s.name] = s.displayValue;
    const pr = (x.probables || []).find(p => p.athlete) || null;
    return {
      espnId: id,
      abbr: abbrOfId(id),                       // canónica (ESPN alterna UTA / UTAH)
      name: x.team ? (x.team.shortDisplayName || x.team.name) : null,
      full: x.team ? x.team.displayName : null,
      record: (x.records && x.records[0] && x.records[0].summary) || '',
      score: x.score != null && x.score !== '' ? Number(x.score) : null,
      // goles por periodo: [1º, 2º, 3º, (tiempo extra), (penales)]
      p: Array.isArray(x.linescores) ? x.linescores.map(l => num(l.value)) : null,
      saves: num(st.saves),
      goalie: pr ? { id: String(pr.athlete.id || pr.playerId || ''), name: pr.athlete.displayName || pr.athlete.fullName || '', status: (pr.status && pr.status.name) || '' } : null,
    };
  };
  const status = (ev.status && ev.status.type) || {};
  return {
    id: String(ev.id),
    date: ev.date,                          // ISO UTC
    seasontype: ev.season && ev.season.type, // 1 pre | 2 regular | 3 playoffs
    seasonYear: ev.season && ev.season.year, // 2026 = temporada 2025-26
    venue: (c.venue && c.venue.fullName) || '',
    neutral: !!c.neutralSite,
    state: status.state || 'pre',            // pre | in | post
    detail: status.shortDetail || '',
    home: side(homeC),
    away: side(awayC),
  };
}

/* ¿Es un juego de la liga de verdad? Fuera el All-Star, el 4 Nations
   y los Olímpicos (equipos con ids que no son de la NHL) y la
   pretemporada. */
function isLeagueGame(g) {
  return !!(g.home.abbr && g.away.abbr && g.seasontype !== 1 && g.home.abbr !== g.away.abbr);
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
  const seen = new Set();
  return out.flat().filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)));
}

/* ---- boxscore de un juego (summary) → compacto ----
   Por equipo (llave: abbr canónica):
     sog      tiros a puerta            miss  tiros fallados (fuera)
     blk      tiros que ESTE equipo bloqueó (son intentos del rival)
     ppg/ppo  goles y oportunidades de power play
     en       goles a puerta vacía que METIÓ (periodos 1-3)
     goalies  [{id, name, ga, sa, toi}] en orden de minutos jugados */
function parseSummary(j) {
  const h = j.header || {};
  const comp = (h.competitions || [])[0] || {};
  const comps = comp.competitors || [];
  const homeC = comps.find(c => c.homeAway === 'home') || {};
  const awayC = comps.find(c => c.homeAway === 'away') || {};
  const home = homeC.team && abbrOfId(homeC.team.id);
  const away = awayC.team && abbrOfId(awayC.team.id);

  const team = {};
  for (const t of (j.boxscore && j.boxscore.teams) || []) {
    const ab = t.team && abbrOfId(t.team.id);
    if (!ab) continue;
    const s = {};
    for (const st of t.statistics || []) s[st.name] = st.displayValue;
    team[ab] = {
      sog: num(s.shotsTotal), blk: num(s.blockedShots), hits: num(s.hits),
      ppg: num(s.powerPlayGoals), ppo: num(s.powerPlayOpportunities),
      fo: num(s.faceoffPercent), pim: num(s.penaltyMinutes),
      miss: null, en: 0, goalies: [],
    };
  }
  for (const t of (j.boxscore && j.boxscore.players) || []) {
    const ab = t.team && abbrOfId(t.team.id);
    if (!ab || !team[ab]) continue;
    let miss = 0, hasMiss = false;
    for (const st of t.statistics || []) {
      const keys = st.keys || [];
      if (st.name === 'goalies') {
        const iGa = keys.indexOf('goalsAgainst'), iSa = keys.indexOf('shotsAgainst'), iToi = keys.indexOf('timeOnIce');
        for (const a of st.athletes || []) {
          const s = a.stats || [];
          if (!a.athlete || !s.length) continue;
          const toi = toiMin(s[iToi]);
          if (toi <= 0) continue;
          team[ab].goalies.push({ id: String(a.athlete.id), name: a.athlete.displayName, ga: num(s[iGa]) || 0, sa: num(s[iSa]) || 0, toi });
        }
      } else if (st.name === 'forwards' || st.name === 'defenses') {
        const iM = keys.indexOf('shotsMissed');
        if (iM >= 0) for (const a of st.athletes || []) { const v = num((a.stats || [])[iM]); if (v != null) { miss += v; hasMiss = true; } }
      }
    }
    team[ab].goalies.sort((x, y) => y.toi - x.toi);
    team[ab].miss = hasMiss ? miss : null;
  }
  // goles a puerta vacía en tiempo reglamentario
  for (const p of j.plays || []) {
    if (!p.scoringPlay || !p.strength || !/empty/i.test(p.strength.text || '')) continue;
    if (!p.period || p.period.number > 3) continue;
    const ab = p.team && abbrOfId(p.team.id);
    if (ab && team[ab]) team[ab].en++;
  }
  return {
    eventId: String(h.id || ''),
    date: comp.date || null,
    home, away,
    hasPlays: Array.isArray(j.plays) && j.plays.length > 0,
    team,
  };
}
async function getSummary(eventId, ttlMs = 24 * 3600 * 1000, opts) {
  const j = await fetchJson(`${ESPN}/summary?event=${eventId}`, ttlMs, opts);
  return parseSummary(j);
}

/* ---- línea de APERTURA y CIERRE histórica (core API) ----
   Casas en orden de preferencia (las "Live Odds" son en vivo: fuera).
   ESPN BET (58) cubre 2023-25 y DraftKings (100) desde 2025-26.
   Devuelve { ml_home, ml_away, pl (línea de gol del LOCAL: −1.5 /
   +1.5), pl_home_odds, pl_away_odds, total, over_odds, under_odds,
   open_*, provider } o null. */
const PROVIDER_PRIORITY = ['58', '100', '40', '45', '47', '52', '57', '41', '36', '48', '50', '53', '1001'];
function parseCloseOdds(j) {
  const items = (j.items || []).filter(it => it.provider && !/live/i.test(it.provider.name || ''));
  if (!items.length) return null;
  items.sort((a, b) => {
    const pa = PROVIDER_PRIORITY.indexOf(String(a.provider.id)), pb = PROVIDER_PRIORITY.indexOf(String(b.provider.id));
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  const am = o => (o && o.american != null ? num(String(o.american).replace('+', '')) : null);
  /* la línea viene como texto en `american` / `alternateDisplayValue`
     ("6.5"); `value` a veces es el PRECIO decimal (lección de NBA) */
  const lineOf = o => (o ? (num(o.american) != null ? num(o.american) : num(o.alternateDisplayValue)) : null);
  /* en 2022-23 esos campos traen el PRECIO (-120) y no la línea: se
     descarta lo que no parezca una línea de hockey */
  const okTotal = v => (v != null && v >= 4 && v <= 9.5 ? v : null);
  const okPl = v => (v != null && Math.abs(v) >= 1 && Math.abs(v) <= 3.5 ? v : null);
  for (const it of items) {
    const ho = it.homeTeamOdds || {}, ao = it.awayTeamOdds || {};
    const hc = ho.close || {}, ac = ao.close || {}, tc = it.close || {};
    const hOpen = ho.open || {}, aOpen = ao.open || {}, tOpen = it.open || {};
    const mlH = hc.moneyLine ? am(hc.moneyLine) : (ho.moneyLine != null ? num(ho.moneyLine) : null);
    const mlA = ac.moneyLine ? am(ac.moneyLine) : (ao.moneyLine != null ? num(ao.moneyLine) : null);
    const total = okTotal(lineOf(tc.total)) != null ? okTotal(lineOf(tc.total)) : okTotal(it.overUnder != null ? num(it.overUnder) : null);
    if (mlH == null || mlA == null) continue;
    return {
      ml_home: mlH, ml_away: mlA,
      pl: hc.pointSpread ? okPl(lineOf(hc.pointSpread)) : null,
      pl_home_odds: hc.spread ? am(hc.spread) : (ho.spreadOdds != null ? num(ho.spreadOdds) : null),
      pl_away_odds: ac.spread ? am(ac.spread) : (ao.spreadOdds != null ? num(ao.spreadOdds) : null),
      total,
      over_odds: tc.over ? am(tc.over) : (it.overOdds != null ? num(it.overOdds) : null),
      under_odds: tc.under ? am(tc.under) : (it.underOdds != null ? num(it.underOdds) : null),
      open_ml_home: hOpen.moneyLine ? am(hOpen.moneyLine) : null,
      open_ml_away: aOpen.moneyLine ? am(aOpen.moneyLine) : null,
      open_total: okTotal(lineOf(tOpen.total)),
      provider: it.provider.name,
    };
  }
  return null;
}
async function getCloseOddsRaw(eventId) {
  return fetchJson(`${CORE}/events/${eventId}/competitions/${eventId}/odds`, 24 * 3600 * 1000, { cache: false });
}
async function getCloseOdds(eventId) {
  try { return parseCloseOdds(await getCloseOddsRaw(eventId)); } catch (e) { return null; }
}

module.exports = { fetchJson, parseEvent, isLeagueGame, getDay, getRange, getSummary, parseSummary, getCloseOdds, getCloseOddsRaw, parseCloseOdds, ymd, addDays };
