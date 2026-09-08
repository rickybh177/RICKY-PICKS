#!/usr/bin/env node
/* ============================================================
   EUROPA — histórico partido por partido para scripts (priors y
   backtest). Solo scripts; nunca en runtime.

   Baja temporadas completas del scoreboard de ESPN en pedazos
   MENSUALES (limit=200) y cachea en disco los juegos TERMINADOS
   por liga+temporada en os.tmpdir()/ricky-euro-history:
     <liga>-<año>.json          juegos de la temporada (año = ESPN
                                season.year: 2026 = 2026-27)
     stats/<liga>/<evento>.json summary parseado (tiros, tiros a
                                puerta, córneres, posesión)
   Las temporadas pasadas no se vuelven a pedir; la temporada en
   curso se refresca si el archivo tiene más de 6 h.

   Con --stats baja también el summary de cada partido (8 a la vez,
   con reintentos y pausa si ESPN se pone exigente). Si un summary
   falla o no trae boxscore, el juego queda con estadísticas null y
   se sigue: el fit acepta juegos con y sin tiros.

   Filtro anti-fuga: solo eventos cuyo season.slug es el de la liga
   ("2024-25-laliga", "2022-23-german-bundesliga"); si ESPN colara
   copas, amistosos o playoffs de descenso, se descartan y se avisa.
   Rescate: partidos viejos que ESPN dejó como "Scheduled" pero ya
   traen marcador se cuentan como jugados (ver stuckButPlayed).

   También baja y cachea los MOMIOS DE CIERRE de football-data.co.uk
   (fd-<temporada>-<división>.csv, ej. fd-2526-E0.csv) para que el
   backtest mida los veredictos con EV contra precios reales; ver
   getClosingOdds más abajo.

   Uso:  node scripts/euro-history.js <epl|laliga|bundesliga|ucl|all|fit|a,b,c> [--stats]
   API:  const { getHistory, getClosingOdds, CACHE_DIR } = require('./euro-history');
         const games = await getHistory('epl', { withStats: true });
         const { rows } = await getClosingOdds('epl', 2025, { book: 'avg' });
   ============================================================ */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { LEAGUES, TEAMS } = require('../lib/euro/leagues');
const { fetchJson, parseMatchStats, getRangeChunked } = require('../lib/euro/data');

const CACHE_DIR = path.join(os.tmpdir(), 'ricky-euro-history');
const CURRENT_TTL_MS = 6 * 3600 * 1000;   // refresco de la temporada en curso
const STATS_CONCURRENCY = 8;
const ESPN_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';

/* Sufijo del season.slug de ESPN por liga (después de "YYYY-YY-").
   Verificado en el scoreboard: la copa y los amistosos viven en otros
   códigos de liga, pero el filtro es barato y evita sorpresas. */
const SLUG_SUFFIX = {
  epl: 'english-premier-league',
  laliga: 'laliga',
  bundesliga: 'german-bundesliga',
  seriea: 'italian-serie-a',
  ligue1: 'ligue-1',                 // ESPN: "2025-26-ligue-1" (no "french-ligue-1")
};
/* Slugs SIN año que ESPN usa en algunas temporadas viejas (la Serie A
   2022-23 viene como "regular-season"); se aceptan si season.year
   coincide con la temporada. */
const EXTRA_SLUGS = {
  seriea: ['regular-season'],
};

const seasonFile = (leagueId, year) => path.join(CACHE_DIR, `${leagueId}-${year}.json`);
const statsFile = (leagueId, eventId) => path.join(CACHE_DIR, 'stats', leagueId, `${eventId}.json`);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* Temporadas (año ESPN) que cubre el histórico: de histStart a hoy.
   Una temporada europea va del 1-jul al 30-jun del año siguiente. */
function seasonYears(cfg) {
  const first = Number(cfg.histStart.slice(0, 4));
  const now = new Date();
  const cur = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const years = [];
  for (let y = first; y <= cur; y++) years.push(y);
  return years;
}

/* Fila compacta de un juego terminado (sin estadísticas). */
function row(g) {
  const side = s => ({ id: s.id, abbr: s.abbr, name: s.name, score: s.score });
  return {
    id: g.id, date: g.date, seasonYear: g.seasonYear, seasonSlug: g.seasonSlug,
    venueCity: g.venueCity || '',
    neutral: !!g.neutral,                       // final europea en sede neutral
    home: side(g.home), away: side(g.away),
  };
}

/* Juegos terminados de UNA temporada, con caché en disco. Devuelve
   { games, dropped } donde dropped son eventos con otro slug. */
async function getSeasonGames(leagueId, year, { log = () => {} } = {}) {
  const cfg = LEAGUES[leagueId];
  const file = seasonFile(leagueId, year);
  const isCurrent = year === seasonYears(cfg)[seasonYears(cfg).length - 1];
  const cached = readJson(file);
  if (cached && Array.isArray(cached.games)) {
    let fresh = true;
    if (isCurrent) {
      try { fresh = Date.now() - fs.statSync(file).mtimeMs < CURRENT_TTL_MS; } catch (e) { fresh = false; }
    }
    if (fresh) return { games: cached.games, dropped: cached.dropped || [], rescued: cached.rescued || 0, fromCache: true };
  }

  const from = year === Number(cfg.histStart.slice(0, 4)) ? cfg.histStart : `${year}-07-01`;
  const seasonEnd = `${year + 1}-06-30`;
  const to = seasonEnd < todayISO() ? seasonEnd : todayISO();
  log(`  ${leagueId} ${year}-${String(year + 1).slice(2)}: bajando ${from} → ${to}…`);
  const evs = await getRangeChunked(leagueId, from, to);

  const games = [], dropped = [];
  let rescued = 0;
  const suffix = SLUG_SUFFIX[leagueId];
  for (const g of evs) {
    if (!g.completed && !stuckButPlayed(g)) continue;
    if (g.home.score == null || g.away.score == null) continue;
    if (!g.home.id || !g.away.id) continue;
    if (!g.completed) rescued++;
    /* Ligas con slugCheck:false (copas europeas y ligas que solo
       entran al ajuste conjunto de la Champions): el código ESPN ya
       es la competencia entera y sus slugs no llevan año
       ("league-phase", "round-of-16") o son de calendario anual
       (Noruega juega mar→nov). Ahí se acepta todo lo terminado y el
       archivo de temporada es solo un cubo por rango de fechas. */
    if (cfg.slugCheck !== false) {
      const slugOk = g.seasonSlug === `${year}-${String(year + 1).slice(2)}-${suffix}`
        || (EXTRA_SLUGS[leagueId] || []).includes(g.seasonSlug);
      if (!slugOk || g.seasonYear !== year) { dropped.push({ id: g.id, date: g.date, slug: g.seasonSlug }); continue; }
    }
    games.push(row(g));
  }
  games.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (rescued) log(`  ${leagueId} ${year}: ${rescued} juegos con marcador pero "Scheduled" en ESPN, rescatados`);
  if (games.length) writeJson(file, { games, dropped, rescued, at: new Date().toISOString() });
  return { games, dropped, rescued, fromCache: false };
}

/* ESPN deja algunos partidos viejos como "Scheduled" (completed=false,
   sin boxscore) aunque el scoreboard ya trae el marcador real: pasó con
   5 juegos de la J21 de LaLiga 2022-23. Se rescatan si el juego es de
   hace más de 7 días y el marcador no es 0-0 (un 0-0 "por jugar" es
   indistinguible de un partido no disputado). Quedan sin estadísticas. */
function stuckButPlayed(g) {
  if (g.state !== 'pre') return false;
  if (new Date(g.date).getTime() > Date.now() - 7 * 86400000) return false;
  const h = g.home.score, a = g.away.score;
  return Number.isInteger(h) && Number.isInteger(a) && h + a > 0;
}

/* ---- summaries (con caché por evento en disco) ----
   Guardamos { home, away } parseado, o { missing: true } cuando ESPN
   no tiene boxscore para ese partido (así no se vuelve a pedir).
   Los errores de red NO se guardan: se reintenta en la próxima corrida. */
async function fetchStats(leagueId, eventId) {
  const file = statsFile(leagueId, eventId);
  const cached = readJson(file);
  if (cached) return cached.missing ? null : cached;
  const url = `${ESPN_BASE}/${LEAGUES[leagueId].espn}/summary?event=${eventId}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await fetchJson(url, 0);           // sin caché en memoria: pesa mucho
      const stats = parseMatchStats(j);
      writeJson(file, stats || { missing: true, at: new Date().toISOString() });
      return stats;
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (attempt + 1));           // ESPN exigente: esperar y reintentar
    }
  }
  throw lastErr;
}

const STAT_KEYS = ['shots', 'sot', 'corners', 'possession'];
function mergeStats(game, stats) {
  for (const side of ['home', 'away']) {
    const s = stats && stats[side];
    for (const k of STAT_KEYS) game[side][k] = s && s[k] != null ? s[k] : null;
  }
  return game;
}

/* Histórico completo de la liga (histStart → hoy), ordenado por fecha.
   withStats: agrega tiros/tiros a puerta/córneres/posesión por lado
   (null cuando no hay summary). */
async function getHistory(leagueId, { withStats = false, log = () => {} } = {}) {
  const cfg = LEAGUES[leagueId];
  if (!cfg) throw new Error(`Liga desconocida: ${leagueId}`);
  const all = [];
  const perSeason = {};
  for (const year of seasonYears(cfg)) {
    const { games, dropped, rescued, fromCache } = await getSeasonGames(leagueId, year, { log });
    perSeason[year] = { games: games.length, dropped: dropped.length, rescued: rescued || 0, fromCache };
    all.push(...games.map(g => JSON.parse(JSON.stringify(g)))); // copia: el caché no se muta
  }
  all.sort((a, b) => new Date(a.date) - new Date(b.date));

  let coverage = null;
  if (withStats) {
    let ok = 0, missing = 0, failed = 0, streak = 0;
    await mapLimit(all, STATS_CONCURRENCY, async g => {
      let stats = null;
      try {
        stats = await fetchStats(leagueId, g.id);
        streak = 0;
        if (stats) ok++; else missing++;
      } catch (e) {
        failed++; streak++;
        if (streak >= 10) { log(`  ${leagueId}: ${streak} fallos seguidos, pausa de 15 s…`); await sleep(15000); streak = 0; }
      }
      mergeStats(g, stats);
    });
    coverage = { ok, missing, failed, pct: all.length ? +(100 * ok / all.length).toFixed(1) : 0 };
  } else {
    for (const g of all) mergeStats(g, null);
  }
  return Object.assign(all, { perSeason, coverage });
}

/* ============================================================
   MOMIOS DE CIERRE — football-data.co.uk (solo backtest)

   Un CSV por liga y temporada con el 1X2 y el O/U 2.5 de varias
   casas, en decimal, tal como cerraron (columnas *C*: B365CH,
   PSCH, AvgCH, AvgC>2.5…) y como abrieron (sin la C). Fuentes:
     avg      → AvgC (promedio de todas las casas: lo más parecido
                al consenso multi-casas que usa el runtime)
     pinnacle → PSC / PC (la casa "sharp"; en 2025-26 solo cubre
                la mitad de la temporada)
     b365     → B365C (casa blanda, parecida a las mexicanas)
   Si falta el cierre de esa fuente se usa su apertura y se avisa
   en srcCount. La temporada se pide con el año ESPN (2025 =
   2025-26) y el CSV se cachea en CACHE_DIR; el de la temporada en
   curso se refresca cada 6 h como el scoreboard.

   OJO con el host: www.football-data.co.uk contesta 503 desde
   aquí; el dominio pelado sirve los CSV sin problema.
   ============================================================ */
const FD_BASE = 'https://football-data.co.uk/mmz4281';
const FD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const FD_DIV = { epl: 'E0', laliga: 'SP1', bundesliga: 'D1', seriea: 'I1', ligue1: 'F1' };

/* nombre de football-data → id de ESPN (string). Cubre las
   plantillas 2022-23 a 2026-27 de las tres ligas. Un nombre que no
   esté aquí se reporta en `unknown` y sus filas se descartan: nunca
   se adivina un equipo. */
const FD_NAMES = {
  epl: {
    'Arsenal': '359', 'Aston Villa': '362', 'Bournemouth': '349', 'Brentford': '337', 'Brighton': '331',
    'Burnley': '379', 'Chelsea': '363', 'Coventry': '388', 'Crystal Palace': '384', 'Everton': '368',
    'Fulham': '370', 'Hull': '306', 'Ipswich': '373', 'Leeds': '357', 'Leicester': '375', 'Liverpool': '364',
    'Luton': '301', 'Man City': '382', 'Man United': '360', 'Newcastle': '361', "Nott'm Forest": '393',
    'Sheffield United': '398', 'Southampton': '376', 'Sunderland': '366', 'Tottenham': '367',
    'West Ham': '371', 'Wolves': '380',
  },
  laliga: {
    'Alaves': '96', 'Almeria': '6832', 'Ath Bilbao': '93', 'Ath Madrid': '1068', 'Barcelona': '83',
    'Betis': '244', 'Cadiz': '3842', 'Celta': '85', 'Elche': '3751', 'Espanol': '88', 'Getafe': '2922',
    'Girona': '9812', 'Granada': '3747', 'La Coruna': '90', 'Las Palmas': '98', 'Leganes': '17534',
    'Levante': '1538', 'Malaga': '99', 'Mallorca': '84', 'Osasuna': '97', 'Oviedo': '92',
    'Real Madrid': '86', 'Santander': '87', 'Sevilla': '243', 'Sociedad': '89', 'Valencia': '94',
    'Valladolid': '95', 'Vallecano': '101', 'Villarreal': '102',
  },
  bundesliga: {
    'Augsburg': '3841', 'Bayern Munich': '132', 'Bochum': '121', 'Darmstadt': '3812', 'Dortmund': '124',
    'Ein Frankfurt': '125', 'Elversberg': '10388', 'FC Koln': '122', 'Freiburg': '126', 'Hamburg': '127',
    'Heidenheim': '6418', 'Hertha': '129', 'Hoffenheim': '7911', 'Holstein Kiel': '7884',
    'Leverkusen': '131', "M'gladbach": '268', 'Mainz': '2950', 'Paderborn': '3307', 'RB Leipzig': '11420',
    'Schalke 04': '133', 'St Pauli': '270', 'Stuttgart': '134', 'Union Berlin': '598',
    'Werder Bremen': '137', 'Wolfsburg': '138',
  },
};

/* prefijos de columna por fuente: [cierre, apertura] */
const FD_SOURCES = {
  avg: { x2: ['AvgC', 'Avg'], tot: ['AvgC', 'Avg'] },
  pinnacle: { x2: ['PSC', 'PS'], tot: ['PC', 'P'] },
  b365: { x2: ['B365C', 'B365'], tot: ['B365C', 'B365'] },
};

const fdSeasonCode = year => `${String(year).slice(2)}${String(year + 1).slice(2)}`;
const fdFile = (year, div) => path.join(CACHE_DIR, `fd-${fdSeasonCode(year)}-${div}.csv`);

/* CSV mínimo con comillas (football-data no las usa, pero cuesta nada) */
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
/* dd/mm/yyyy (o dd/mm/yy) → YYYY-MM-DD */
function fdDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2]}-${m[1]}`;
}

function parseFdCsv(text, leagueId, book) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const col = {};
  splitCsv(lines[0]).forEach((h, i) => { col[h.trim()] = i; });
  for (const k of ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG']) {
    if (col[k] == null) throw new Error(`CSV sin columna ${k}`);
  }
  const src = FD_SOURCES[book] || FD_SOURCES.avg;
  const names = FD_NAMES[leagueId] || {};
  const pick = (c, cols) => {
    for (const name of cols) {
      const i = col[name];
      if (i == null || c[i] == null || c[i] === '') continue;
      const v = Number(c[i]);
      if (isFinite(v) && v > 1) return { v, src: name };
    }
    return null;
  };
  const rows = [], unknown = new Set(), srcCount = {};
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    if (c.length < 7) continue;
    const hn = c[col.HomeTeam].trim(), an = c[col.AwayTeam].trim();
    const home = names[hn], away = names[an];
    if (!home) unknown.add(hn);
    if (!away) unknown.add(an);
    if (!home || !away) continue;
    const fthg = Number(c[col.FTHG]), ftag = Number(c[col.FTAG]);
    if (!Number.isInteger(fthg) || !Number.isInteger(ftag)) continue;
    const h = pick(c, src.x2.map(p => p + 'H'));
    const d = pick(c, src.x2.map(p => p + 'D'));
    const a = pick(c, src.x2.map(p => p + 'A'));
    const ov = pick(c, src.tot.map(p => p + '>2.5'));
    const un = pick(c, src.tot.map(p => p + '<2.5'));
    const complete = h && d && a;
    rows.push({
      date: fdDate(c[col.Date]), time: col.Time != null ? c[col.Time] : null,
      home, away, fthg, ftag,
      h: complete ? h.v : null, d: complete ? d.v : null, a: complete ? a.v : null,
      over25: ov && un ? ov.v : null, under25: ov && un ? un.v : null,
    });
    const tag = complete ? h.src.replace(/H$/, '') : 'sin 1X2';
    srcCount[tag] = (srcCount[tag] || 0) + 1;
  }
  return { rows, unknown: [...unknown].sort(), srcCount };
}

/* Cierres de UNA temporada (año ESPN) de una liga. Devuelve
   { rows, unknown, srcCount, file, book }; rows = [{ date, time,
   home, away, fthg, ftag, h, d, a, over25, under25 }] en decimal. */
async function getClosingOdds(leagueId, seasonYear, { book = 'avg', log = () => {} } = {}) {
  const cfg = LEAGUES[leagueId];
  const div = FD_DIV[leagueId];
  if (!cfg || !div) throw new Error(`Sin división de football-data para ${leagueId}`);
  if (!FD_SOURCES[book]) throw new Error(`Fuente de cierres desconocida: ${book} (avg | pinnacle | b365)`);
  const file = fdFile(seasonYear, div);
  const isCurrent = seasonYear === seasonYears(cfg)[seasonYears(cfg).length - 1];
  let text = null;
  try {
    const fresh = !isCurrent || Date.now() - fs.statSync(file).mtimeMs < CURRENT_TTL_MS;
    if (fresh) text = fs.readFileSync(file, 'utf8');
  } catch (e) { text = null; }
  if (!text) {
    const url = `${FD_BASE}/${fdSeasonCode(seasonYear)}/${div}.csv`;
    log(`  ${leagueId} ${seasonYear}-${String(seasonYear + 1).slice(2)}: bajando cierres ${url}…`);
    const r = await fetch(url, { headers: { 'User-Agent': FD_UA, 'Accept': 'text/csv,*/*' } });
    if (!r.ok) throw new Error(`football-data HTTP ${r.status}`);
    text = await r.text();
    // el sitio a veces contesta 200 con una página HTML de "temporalmente no disponible"
    if (!/^﻿?Div,/.test(text)) throw new Error('football-data devolvió HTML en vez de CSV');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { ...parseFdCsv(text, leagueId, book), file, book };
}

/* ---- CLI ---- */
if (require.main === module) {
  const args = process.argv.slice(2);
  const withStats = args.includes('--stats');
  const which = args.find(a => !a.startsWith('--')) || 'all';
  /* all = ligas a la venta (enabled); fit = las que solo alimentan el
     ajuste conjunto de la Champions (fitOnly: ligas domésticas de los
     36 clubes + Europa League + Conference); o una lista con comas. */
  const ids = which === 'all'
    ? Object.keys(LEAGUES).filter(k => LEAGUES[k].enabled)
    : which === 'fit'
      ? Object.keys(LEAGUES).filter(k => LEAGUES[k].fitOnly)
      : which.split(',');
  for (const id of ids) if (!LEAGUES[id]) { console.error(`Liga desconocida: ${id}`); process.exit(1); }

  (async () => {
    console.log(`Caché en ${CACHE_DIR}`);
    for (const id of ids) {
      const cfg = LEAGUES[id];
      console.log(`\n== ${cfg.name} (${cfg.espn}) ==`);
      const games = await getHistory(id, { withStats, log: m => console.log(m) });
      for (const [year, s] of Object.entries(games.perSeason)) {
        const label = `${year}-${String(Number(year) + 1).slice(2)}`;
        const seasonGames = games.filter(g => g.seasonYear === Number(year));
        const teams = new Set(); const perTeam = {};
        for (const g of seasonGames) for (const t of [g.home.id, g.away.id]) { teams.add(t); perTeam[t] = (perTeam[t] || 0) + 1; }
        // fuga de copa/playoff: un equipo con <5 juegos en una temporada COMPLETA no es de la liga
        const complete = `${Number(year) + 1}-06-30` < todayISO();
        const few = complete ? Object.entries(perTeam).filter(([, n]) => n < 5).map(([t, n]) => `${t}:${n}`) : [];
        const bad = seasonGames.filter(g => !Number.isInteger(g.home.score) || !Number.isInteger(g.away.score)).length;
        const withS = withStats ? seasonGames.filter(g => g.home.sot != null || g.home.corners != null).length : null;
        console.log(`  ${label}: ${s.games} juegos · ${teams.size} equipos${s.fromCache ? ' (caché)' : ''}`
          + (s.dropped ? ` · ${s.dropped} descartados por slug` : '')
          + (s.rescued ? ` · ${s.rescued} rescatados (sin stats)` : '')
          + (bad ? ` · ${bad} SIN marcador válido` : '')
          + (few.length ? ` · equipos con <5 juegos: ${few.join(' ')}` : '')
          + (withStats ? ` · stats ${withS}/${s.games}` : ''));
      }
      if (games.coverage) {
        const c = games.coverage;
        console.log(`  summaries: ${c.ok} con stats · ${c.missing} sin boxscore · ${c.failed} fallidos → cobertura ${c.pct}%`);
      }
      // equipos 2026-27 sin historia (recién ascendidos según el catálogo)
      const hist = new Set(games.filter(g => g.seasonYear < Number(cfg.seasonStart.slice(0, 4))).flatMap(g => [g.home.id, g.away.id]));
      const roster = TEAMS[id] || {};
      const nuevos = Object.keys(roster).filter(t => !hist.has(t)).map(t => roster[t].name);
      if (Object.keys(roster).length) console.log(`  sin historia en la ventana (ascendidos): ${nuevos.length ? nuevos.join(', ') : 'ninguno'}`);
      console.log(`  total: ${games.length} juegos`);
    }
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { getHistory, getSeasonGames, getClosingOdds, CACHE_DIR, SLUG_SUFFIX, FD_NAMES };
