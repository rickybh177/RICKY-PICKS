/* ============================================================
   CAPA DE DATOS — MLB StatsAPI (gratis, sin API key).
   Solo backend. Caché in-memory con TTL para no golpear la API
   en cada request del mismo lambda.
   ============================================================ */

const BASE = 'https://statsapi.mlb.com/api/v1';

const _cache = new Map(); // url -> { at, ttl, value }

async function fetchJson(url, ttlMs = 10 * 60 * 1000) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ricky-picks/1.0' } });
      if (!r.ok) throw new Error(`StatsAPI ${r.status}: ${url}`);
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

/* Calendario del día con abridores probables, lineups y clima. */
async function getSchedule(dateISO) {
  const url = `${BASE}/schedule?sportId=1&date=${dateISO}` +
    `&hydrate=probablePitcher,lineups,weather,venue,team`;
  const j = await fetchJson(url, 5 * 60 * 1000); // lineups cambian: TTL corto
  const day = (j.dates || []).find(d => d.date === dateISO);
  return day ? (day.games || []) : [];
}

/* Stats de jugadores EN BULK: handedness + temporada + splits vl/vr,
   bateo y pitcheo, en una sola llamada por chunk de 40 ids. */
async function getPeople(personIds, season) {
  const ids = [...new Set(personIds)].filter(Boolean);
  const out = new Map();
  const CHUNK = 40;
  const hydrate = `stats(group=%5Bhitting,pitching%5D,type=%5BstatSplits,season%5D,sitCodes=%5Bvl,vr%5D,season=${season})`;
  const jobs = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    jobs.push(fetchJson(`${BASE}/people?personIds=${chunk.join(',')}&hydrate=${hydrate}`, 60 * 60 * 1000));
  }
  const results = await Promise.all(jobs);
  for (const j of results) {
    for (const p of (j.people || [])) {
      const person = {
        id: p.id,
        name: p.fullName,
        bats: (p.batSide && p.batSide.code) || 'R',    // L / R / S
        throws: (p.pitchHand && p.pitchHand.code) || 'R',
        hitting: { season: null, vl: null, vr: null },
        pitching: { season: null, vl: null, vr: null },
      };
      for (const s of (p.stats || [])) {
        const group = s.group && s.group.displayName; // hitting | pitching
        const type = s.type && s.type.displayName;    // season | statSplits
        if (!person[group]) continue;
        for (const sp of (s.splits || [])) {
          if (type === 'season') person[group].season = sp.stat;
          else if (sp.split && (sp.split.code === 'vl' || sp.split.code === 'vr')) {
            person[group][sp.split.code] = sp.stat;
          }
        }
      }
      out.set(p.id, person);
    }
  }
  return out;
}

/* Split de equipo (ej. bullpen con sitCode 'rp', o bateo del equipo vl/vr). */
async function getTeamSplit(teamId, group, sitCodes, season) {
  const url = `${BASE}/teams/${teamId}/stats?stats=statSplits&group=${group}` +
    `&season=${season}&sitCodes=${sitCodes}`;
  const j = await fetchJson(url, 60 * 60 * 1000);
  const res = {};
  for (const s of (j.stats || [])) {
    for (const sp of (s.splits || [])) {
      const code = sp.split && sp.split.code;
      if (code) res[code] = sp.stat;
    }
  }
  return res;
}

/* Baseline de la liga: agregado de bateo de los 30 equipos. */
async function getLeagueHitting(season) {
  const url = `${BASE}/teams/stats?stats=season&group=hitting&season=${season}&sportIds=1`;
  const j = await fetchJson(url, 6 * 60 * 60 * 1000);
  const tot = {};
  const KEYS = ['plateAppearances', 'hits', 'doubles', 'triples', 'homeRuns',
    'baseOnBalls', 'hitByPitch', 'strikeOuts'];
  for (const s of (j.stats || [])) {
    for (const sp of (s.splits || [])) {
      for (const k of KEYS) tot[k] = (tot[k] || 0) + (Number(sp.stat[k]) || 0);
    }
  }
  return tot;
}

module.exports = { fetchJson, getSchedule, getPeople, getTeamSplit, getLeagueHitting, BASE };
