/* ============================================================
   Helpers de la Graph API de Instagram (variante "Instagram API
   with Instagram Login": no requiere página de Facebook).

   Env vars (Vercel):
   - IG_ACCESS_TOKEN  token de larga duración de la cuenta profesional
   - IG_VERIFY_TOKEN  string inventado para la verificación del webhook
   - IG_ID            (opcional) id de la cuenta; se resuelve solo con /me
   ============================================================ */

const IG_GRAPH = 'https://graph.instagram.com/v23.0';

async function igFetch(path, { method = 'GET', body } = {}) {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) throw new Error('Falta IG_ACCESS_TOKEN en las variables de entorno.');
  const url = `${IG_GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Graph API HTTP ${res.status}`);
    err.status = res.status;
    err.graph = data.error || null;
    throw err;
  }
  return data;
}

/* ---- identidad propia (para ignorar nuestros propios eventos) ---- */
let _meId = null;
async function meId() {
  if (process.env.IG_ID) return String(process.env.IG_ID);
  if (!_meId) _meId = String((await igFetch('/me?fields=id')).id);
  return _meId;
}
const getMe = () => igFetch('/me?fields=id,username,name');

/* ---- envío ---- */
const sendDm = (igsid, text) =>
  igFetch('/me/messages', { method: 'POST', body: { recipient: { id: igsid }, message: { text } } });

// Private reply: el ÚNICO DM que se puede iniciar hacia alguien que no nos
// ha escrito — 1 por comentario, dentro de los 7 días del comentario.
const sendPrivateReply = (commentId, text) =>
  igFetch('/me/messages', { method: 'POST', body: { recipient: { comment_id: commentId }, message: { text } } });

const replyToComment = (commentId, text) =>
  igFetch(`/${commentId}/replies`, { method: 'POST', body: { message: text } });

/* ---- lectura (fuente de verdad: como no hay raw body en Vercel, no se
   puede validar la firma del webhook; en su lugar RE-CONSULTAMOS cada
   comentario/mensaje a la API — un payload falsificado no referencia
   ids reales y muere aquí) ---- */
const getComment = (commentId) =>
  igFetch(`/${commentId}?fields=id,text,username,from,media,parent_id,timestamp`);

const getMessage = (mid) =>
  igFetch(`/${mid}?fields=id,created_time,from,to,message`);

async function getProfile(igsid) {
  try {
    return await igFetch(`/${igsid}?fields=name,username,profile_pic`);
  } catch {
    return null; // el perfil puede no ser accesible; no es fatal
  }
}

/* ---- motor de reglas ---- */
const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

function ruleMatches(rule, text, mediaId) {
  if (rule.media_id && mediaId && String(rule.media_id) !== String(mediaId)) return false;
  if (rule.media_id && !mediaId) return false;
  const kws = rule.keywords || [];
  if (!kws.length) return true; // catch-all
  const t = normalize(text);
  if (!t) return false;
  return kws.some((k) => {
    const kw = normalize(k);
    if (!kw) return false;
    return rule.match_type === 'exact' ? t === kw : t.includes(kw);
  });
}

// La regla más específica gana: con post concreto > con keywords > catch-all;
// a igualdad, la más antigua.
function pickRule(rules, triggerType, text, mediaId) {
  const candidates = (rules || []).filter(
    (r) => r.active && r.trigger_type === triggerType && ruleMatches(r, text, mediaId)
  );
  candidates.sort((a, b) => {
    const score = (r) => (r.media_id ? 2 : 0) + ((r.keywords || []).length ? 1 : 0);
    return score(b) - score(a) || String(a.created_at).localeCompare(String(b.created_at));
  });
  return candidates[0] || null;
}

// Personalización: {{username}} y {{nombre}} en las plantillas de respuesta.
function fillTemplate(tpl, vars) {
  return String(tpl || '')
    .replace(/\{\{\s*username\s*\}\}/gi, vars.username || '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, vars.name || vars.username || '')
    .trim();
}

module.exports = {
  igFetch,
  meId,
  getMe,
  sendDm,
  sendPrivateReply,
  replyToComment,
  getComment,
  getMessage,
  getProfile,
  normalize,
  ruleMatches,
  pickRule,
  fillTemplate,
};
