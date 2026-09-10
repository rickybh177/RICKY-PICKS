/* ============================================================
   NFL — momios reales y utilidades de probabilidad.

   FUENTE ÚNICA (decisión del dueño 4-ago-2026): The Odds API —
   consenso de varias casas US (mediana de línea y precio) para
   spread, total y moneyline. La pretemporada vive en un sport
   key aparte (americanfootball_nfl_preseason). Sin key o sin
   cobertura, el juego queda SIN mercado y el modelo lo dice
   ("aún sin momios", tope MAYBE) — no se rellena con momios de
   referencia que no se pueden apostar.

   El edge se calcula contra probabilidades SIN vig (devig).
   ============================================================ */
const { fetchJson } = require('./data');

const KEY = process.env.ODDS_API_KEY || '';

/* americano -> prob implícita (con vig) */
function amToProb(am) {
  const n = Number(am);
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
/* prob -> momio americano justo */
function probToAm(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p > 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}
/* quitar el vig a un par de probabilidades implícitas */
function devigPair(pA, pB) {
  if (pA == null || pB == null) return [pA, pB];
  const s = pA + pB;
  return s > 0 ? [pA / s, pB / s] : [pA, pB];
}
function median(arr) {
  const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* Consenso multi-casas de The Odds API.
   seasontype 1 = pretemporada (sport key propio); 2 = regular.
   Regresa Map(clave "AWAY|HOME|iso-dia") -> {spread, total, ...} */
async function getOddsApiLines(seasontype) {
  if (!KEY) return null;
  const sportKey = Number(seasontype) === 1
    ? 'americanfootball_nfl_preseason'
    : 'americanfootball_nfl';
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
      `?apiKey=${KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    // Plan gratis de The Odds API: 500 créditos/mes compartidos con Liga
    // MX y MLB. Caché de 6h para no agotarlo (ver lib/odds/theoddsapi.js).
    const events = await fetchJson(url, 6 * 3600 * 1000);
    if (!Array.isArray(events)) return null;
    const out = new Map();
    for (const ev of events) {
      const spreads = [], totals = [], mlHome = [], mlAway = [];
      const spreadPriceH = [], spreadPriceA = [], totalOver = [], totalUnder = [];
      for (const bk of (ev.bookmakers || [])) {
        for (const mk of (bk.markets || [])) {
          const o = mk.outcomes || [];
          if (mk.key === 'spreads') {
            const h = o.find(x => x.name === ev.home_team), a = o.find(x => x.name === ev.away_team);
            if (h && h.point != null) { spreads.push(Number(h.point)); spreadPriceH.push(amToProb(h.price)); }
            if (a && a.price != null) spreadPriceA.push(amToProb(a.price));
          } else if (mk.key === 'totals') {
            const ov = o.find(x => x.name === 'Over'), un = o.find(x => x.name === 'Under');
            if (ov && ov.point != null) { totals.push(Number(ov.point)); totalOver.push(amToProb(ov.price)); }
            if (un && un.price != null) totalUnder.push(amToProb(un.price));
          } else if (mk.key === 'h2h') {
            const h = o.find(x => x.name === ev.home_team), a = o.find(x => x.name === ev.away_team);
            if (h) mlHome.push(amToProb(h.price));
            if (a) mlAway.push(amToProb(a.price));
          }
        }
      }
      const key = `${ev.away_team}|${ev.home_team}|${(ev.commence_time || '').slice(0, 10)}`;
      out.set(key, {
        odds_event_id: ev.id, // para pedir los props de jugador de ESTE evento
        books: (ev.bookmakers || []).length,
        spread: median(spreads),               // línea del local
        spread_ph: median(spreadPriceH), spread_pa: median(spreadPriceA),
        total: median(totals),
        total_pov: median(totalOver), total_pun: median(totalUnder),
        ml_ph: median(mlHome), ml_pa: median(mlAway),
      });
    }
    return out;
  } catch (e) { return null; }
}

/* Mercado de un juego: SOLO The Odds API (matcheo por nombres
   completos + día). Devuelve probabilidades implícitas CRUDAS
   (con vig): el precio real que pagarías. El devig (prob "limpia"
   del mercado) se hace en model.js, porque el EV necesita ambas.
   Sin match → null: el juego se muestra sin momios, sin inventar. */
function marketFor(g, oddsMap, fullNames) {
  if (!oddsMap || !fullNames) return null;
  const key = `${fullNames.away}|${fullNames.home}|${(g.date || '').slice(0, 10)}`;
  const m = oddsMap.get(key);
  if (m && (m.spread != null || m.total != null || m.ml_ph != null)) {
    return {
      source: 'consenso ' + m.books + ' casas',
      odds_event_id: m.odds_event_id,
      spread: m.spread, total: m.total,
      ml_home_imp: m.ml_ph, ml_away_imp: m.ml_pa,
      spread_home_imp: m.spread_ph, spread_away_imp: m.spread_pa,
      total_over_imp: m.total_pov, total_under_imp: m.total_pun,
    };
  }
  return null;
}

/* ---- PROPS DE JUGADOR (bajo demanda, por evento) ----
   Cada mercado cuesta 1 crédito por evento, así que NO se piden en
   la construcción de la semana: solo cuando alguien abre los props
   de un juego, y el resultado se comparte 4h entre todas las
   lambdas vía el KV de Supabase Storage (guardián: con menos de
   2,000 créditos restantes el caché dura 8× más). */
const { kvGet, kvPut } = require('../odds/theoddsapi');
const PROP_MARKETS = [
  'player_pass_yds', 'player_pass_tds', 'player_pass_completions',
  'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_anytime_td',
];
const PROPS_TTL_MS = 4 * 3600 * 1000;
const CREDIT_RESERVE = 2000;

/* Nombre normalizado para casar ESPN ↔ casas ("A.J. Brown", "Jr.") */
function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/* Map nombreNormalizado -> { pass_yds:{line, over_imp, under_imp, books}, …, anytime_td:{yes_imp, books} } */
function parseProps(ev) {
  const acc = {}; // name -> market -> { lines:[], over:[], under:[], yes:[] }
  for (const bk of ev.bookmakers || []) {
    for (const mk of bk.markets || []) {
      const key = mk.key.replace(/^player_/, '');
      for (const o of mk.outcomes || []) {
        const name = normName(o.description);
        if (!name) continue;
        acc[name] = acc[name] || {};
        const m = (acc[name][key] = acc[name][key] || { lines: [], over: [], under: [], yes: [] });
        if (key === 'anytime_td') { if (o.name === 'Yes') m.yes.push(amToProb(o.price)); continue; }
        if (o.name === 'Over') { if (o.point != null) m.lines.push(Number(o.point)); m.over.push(amToProb(o.price)); }
        else if (o.name === 'Under') m.under.push(amToProb(o.price));
      }
    }
  }
  const out = {};
  for (const name in acc) {
    out[name] = {};
    for (const key in acc[name]) {
      const m = acc[name][key];
      if (key === 'anytime_td') { if (m.yes.length) out[name][key] = { yes_imp: median(m.yes), books: m.yes.length }; continue; }
      if (!m.lines.length) continue;
      out[name][key] = { line: median(m.lines), over_imp: median(m.over), under_imp: median(m.under), books: m.lines.length };
    }
  }
  return out;
}

async function getEventProps(oddsEventId) {
  if (!KEY || !oddsEventId) return null;
  const cacheKey = `nfl-props-${oddsEventId}`;
  const hit = await kvGet(cacheKey);
  const ttlOf = e => (e && e.remaining != null && e.remaining < CREDIT_RESERVE ? PROPS_TTL_MS * 8 : PROPS_TTL_MS);
  if (hit && hit.at && Date.now() - hit.at < ttlOf(hit)) return hit.value;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${oddsEventId}/odds` +
      `?apiKey=${KEY}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american`;
    const r = await fetch(url);
    const remaining = Number(r.headers.get('x-requests-remaining'));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ev = await r.json();
    const value = { books: (ev.bookmakers || []).length, players: parseProps(ev) };
    await kvPut(cacheKey, { at: Date.now(), remaining: Number.isFinite(remaining) ? remaining : null, value });
    return value;
  } catch (e) {
    console.error('nfl props odds', oddsEventId, e.message);
    return hit ? hit.value : null; // mejor un precio de hace horas que ninguno, marcado como tal por el llamador
  }
}

module.exports = { getOddsApiLines, marketFor, getEventProps, normName, amToProb, probToAm, devigPair, median };
