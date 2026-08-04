/* ============================================================
   /api/odds-ingest — captura de momios manuales (SOLO ADMIN).

   GET    ?sport=nfl|mx|mlb          → lista lo guardado
   POST   { sport, entries: [{ game_key, source?, odds }] } → upsert
   DELETE { sport, game_key }        → borra una entrada

   Lo consume /admin-odds.html. Los modelos leen la tabla vía
   lib/odds/manual-store.js y estos momios MANDAN sobre ESPN /
   The Odds API. Requiere scripts/manual-odds-schema.sql corrido
   en Supabase (si falta, regresa el error claro de la BD).
   ============================================================ */
const { getUserFromToken } = require('../lib/supabaseAdmin');
const { saveManualOdds, deleteManualOdds, listManualOdds } = require('../lib/odds/manual-store');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];
const IS_DEV = !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const SPORTS = ['nfl', 'mx', 'mlb'];

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // ---- candado: solo admin ----
  let isAdmin = false;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    const user = await getUserFromToken(token);
    if (user && ADMIN_EMAILS.includes(user.email)) isAdmin = true;
  }
  if (IS_DEV) isAdmin = true;
  if (!isAdmin) return res.status(403).json({ error: 'Solo administración.' });

  try {
    if (req.method === 'GET') {
      const sport = req.query && req.query.sport;
      if (!SPORTS.includes(sport)) return res.status(400).json({ error: 'sport inválido.' });
      return res.status(200).json({ sport, entries: await listManualOdds(sport) });
    }

    if (req.method === 'POST') {
      const { sport, entries } = req.body || {};
      if (!SPORTS.includes(sport)) return res.status(400).json({ error: 'sport inválido.' });
      if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'entries vacío.' });
      for (const e of entries) {
        if (!e.game_key || !/^\d{4}-\d{2}-\d{2}:[A-Z]{2,4}@[A-Z]{2,4}$/.test(e.game_key)) {
          return res.status(400).json({ error: `game_key inválido: ${e.game_key}` });
        }
        if (!e.odds || typeof e.odds !== 'object') return res.status(400).json({ error: 'odds debe ser objeto.' });
      }
      const n = await saveManualOdds(sport, entries);
      return res.status(200).json({ ok: true, saved: n });
    }

    if (req.method === 'DELETE') {
      const { sport, game_key } = req.body || {};
      if (!SPORTS.includes(sport) || !game_key) return res.status(400).json({ error: 'Faltan sport/game_key.' });
      await deleteManualOdds(sport, game_key);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('odds-ingest:', e);
    const hint = /manual_odds/.test(String(e.message || ''))
      ? ' ¿Ya corriste scripts/manual-odds-schema.sql en Supabase?'
      : '';
    return res.status(500).json({ error: 'Error guardando momios.' + hint, detail: String(e.message || e) });
  }
};
