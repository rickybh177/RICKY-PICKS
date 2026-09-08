/* ============================================================
   POST /api/swap-model  { drop, add }   (requiere sesión)
   Cambia UN modelo del plan "Tres modelos a elegir": quita `drop`
   y mete `add`, sin tocar el cobro (la suscripción sigue igual en
   la pasarela; solo cambian las filas de acceso).

   Reglas:
   - Solo con tres_mensual vigente (filas activas con ese plan).
   - `drop` debe ser uno de sus tres; `add` un modelo válido que no
     tenga ya.
   - UN cambio por periodo de cobro: se permite si el último cambio
     es anterior a la fecha de la última renovación (updated_at de
     sus filas). Cada renovación abre un cambio nuevo.
   - Si `add` ya lo tiene con algo que dura más (un pase o un
     permanente), no se pisa: se le pide elegir otro.
   La fila nueva copia el updated_at de las demás para que las tres
   venzan juntas con el periodo pagado (grantEntitlement pondría
   "ahora" y regalaría días).
   ============================================================ */
const { getUserFromToken, getAdmin } = require('../lib/supabaseAdmin');
const { PLANS, ALL_MODELS, coverageBeats, entitlementExpiry } = require('../lib/plans');
const { saveSwap, loadSwap, saveChoice } = require('../lib/choices');

const PLAN = 'tres_mensual';
const NOMBRE = { mlb: 'MLB', mx: 'Liga MX', nfl: 'NFL', epl: 'Premier League', laliga: 'LaLiga', bundesliga: 'Bundesliga', ucl: 'Champions League' };

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  const user = await getUserFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const drop = String((body && body.drop) || '').toLowerCase();
  const add = String((body && body.add) || '').toLowerCase();
  if (!ALL_MODELS.includes(drop) || !ALL_MODELS.includes(add) || drop === add) {
    return res.status(400).json({ error: 'Elige qué modelo quitas y cuál metes.' });
  }

  try {
    const admin = getAdmin();
    const { data, error } = await admin
      .from('entitlements')
      .select('plan, product, active, updated_at')
      .eq('user_id', user.id)
      .eq('active', true);
    if (error) throw error;
    const rows = data || [];
    const mine = rows.filter(r => r.plan === PLAN);
    const now = Date.now();
    if (!mine.length || entitlementExpiry(PLAN, mine[0].updated_at) < now) {
      return res.status(400).json({ error: 'Este cambio es para el plan de tres modelos, y no tienes uno vigente.' });
    }
    if (!mine.some(r => r.product === drop)) {
      return res.status(400).json({ error: `${NOMBRE[drop]} no está en tu plan de tres modelos.` });
    }
    if (mine.some(r => r.product === add)) {
      return res.status(400).json({ error: `${NOMBRE[add]} ya está en tu plan.` });
    }
    // un cambio por periodo: el último cambio debe ser anterior a la última renovación
    const renewedAt = Math.max(...mine.map(r => Date.parse(r.updated_at) || 0));
    const swappedAt = await loadSwap(user.id, PLAN);
    if (swappedAt && Date.parse(swappedAt) >= renewedAt) {
      const next = new Date(entitlementExpiry(PLAN, mine[0].updated_at)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
      return res.status(400).json({ error: `Ya hiciste tu cambio de este periodo. El siguiente se abre con tu renovación (${next}).` });
    }
    // el modelo nuevo ya cubierto por algo que dura más: no se pisa
    const other = rows.find(r => r.product === add && r.plan !== PLAN);
    if (other && coverageBeats(other, PLAN, now)) {
      return res.status(400).json({ error: `${NOMBRE[add]} ya lo tienes con ${PLANS[other.plan] ? PLANS[other.plan].title : other.plan}: elige otro.` });
    }

    const updatedAt = new Date(renewedAt).toISOString();
    const del = await admin.from('entitlements').delete().eq('user_id', user.id).eq('product', drop).eq('plan', PLAN);
    if (del.error) throw del.error;
    const up = await admin.from('entitlements').upsert(
      { user_id: user.id, plan: PLAN, product: add, active: true, updated_at: updatedAt },
      { onConflict: 'user_id,product' }
    );
    if (up.error) throw up.error;
    const products = mine.map(r => r.product).filter(p => p !== drop).concat([add]);
    await saveSwap(user.id, PLAN);
    try { await saveChoice(user.id, PLAN, products); } catch (e) { console.error('swap-model: elección no guardada', e.message); }
    console.log(`swap-model: ${user.id} ${drop} → ${add} (${products.join(',')})`);
    return res.status(200).json({ ok: true, products, message: `Listo: ${NOMBRE[add]} entra y ${NOMBRE[drop]} sale. Tu siguiente cambio se abre con tu renovación.` });
  } catch (e) {
    console.error('swap-model:', e);
    return res.status(500).json({ error: 'No se pudo hacer el cambio. Intenta de nuevo.' });
  }
};
