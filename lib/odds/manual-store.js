/* ============================================================
   MOMIOS MANUALES compartidos (Supabase) — los 3 modelos.

   El dueño captura los momios de SU casa (Playdoit) desde
   /admin-odds.html → api/odds-ingest.js → tabla `manual_odds`.
   Los modelos leen de aquí en cada corrida (caché 60s) y esos
   momios MANDAN sobre cualquier fuente automática: son los
   precios que de verdad se pueden tomar.

   Por qué así y no un robot: Playdoit bloquea peticiones desde
   servidores (WAF + feed Altenar ofuscado, investigado 18-jul
   para MX) y NUNCA usamos credenciales del dueño. La captura
   sale del navegador del dueño; el almacén la comparte con
   TODOS los usuarios al instante.

   game_key: 'YYYY-MM-DD:VISITA@LOCAL'. La fecha aceptada es la
   de México o la de UTC (un juego de noche cae al día siguiente
   en UTC): keysForGame genera ambas y el lookup prueba las dos.
   ============================================================ */
const { getAdmin } = require('../supabaseAdmin');

const MX_TZ = 'America/Mexico_City';
const TTL_MS = 60 * 1000;
const _cache = new Map(); // sport -> { at, map }

/* Claves candidatas de un juego (día UTC y día hora-de-México). */
function keysForGame(dateISO, awayAbbr, homeAbbr) {
  if (!dateISO || !awayAbbr || !homeAbbr) return [];
  const days = new Set();
  days.add(String(dateISO).slice(0, 10));
  try {
    days.add(new Date(dateISO).toLocaleDateString('en-CA', { timeZone: MX_TZ }));
  } catch (e) {}
  return [...days].map(d => `${d}:${awayAbbr}@${homeAbbr}`);
}

/* Mapa game_key -> { source, updated_at, ...odds } de un deporte.
   Nunca truena: sin Supabase o sin tabla regresa {} (los modelos
   siguen con sus fuentes automáticas). */
async function getManualMap(sport) {
  const hit = _cache.get(sport);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  let map = {};
  try {
    const admin = getAdmin();
    const { data, error } = await admin
      .from('manual_odds')
      .select('game_key, source, odds, updated_at')
      .eq('sport', sport);
    if (!error && Array.isArray(data)) {
      for (const r of data) {
        map[r.game_key] = { source: r.source, updated_at: r.updated_at, ...(r.odds || {}) };
      }
    }
  } catch (e) { /* sin credenciales/tabla: mapa vacío */ }
  _cache.set(sport, { at: Date.now(), map });
  return map;
}

/* Busca la entrada de un juego probando sus claves candidatas. */
function lookupManual(map, dateISO, awayAbbr, homeAbbr) {
  if (!map) return null;
  for (const k of keysForGame(dateISO, awayAbbr, homeAbbr)) {
    if (map[k]) return map[k];
  }
  return null;
}

async function saveManualOdds(sport, entries) {
  const admin = getAdmin();
  const now = new Date().toISOString();
  const rows = entries.map(e => ({
    sport,
    game_key: e.game_key,
    source: e.source || 'Playdoit',
    odds: e.odds || {},
    updated_at: now,
  }));
  const { error } = await admin.from('manual_odds').upsert(rows, { onConflict: 'sport,game_key' });
  if (error) throw error;
  _cache.delete(sport);
  return rows.length;
}

async function deleteManualOdds(sport, gameKey) {
  const admin = getAdmin();
  const { error } = await admin.from('manual_odds').delete().eq('sport', sport).eq('game_key', gameKey);
  if (error) throw error;
  _cache.delete(sport);
}

async function listManualOdds(sport) {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('manual_odds')
    .select('game_key, source, odds, updated_at')
    .eq('sport', sport)
    .order('game_key');
  if (error) throw error;
  return data || [];
}

module.exports = { getManualMap, lookupManual, keysForGame, saveManualOdds, deleteManualOdds, listManualOdds };
