/* ============================================================
   /api/ig-webhook
   Meta avisa aquí cada comentario y DM de la cuenta de Instagram.

   GET  → verificación del webhook (hub.challenge) al registrarlo
          en el panel de Meta (usa IG_VERIFY_TOKEN).
   POST → eventos. Vercel ya parseó el JSON (no hay raw body), así
          que la firma X-Hub-Signature-256 no se puede validar; en
          su lugar cada comentario/mensaje se RE-CONSULTA a la
          Graph API antes de actuar (mismo patrón que
          stripe-webhook.js): un payload falsificado no referencia
          ids reales y se descarta.

   Registrar en Meta → App → Webhooks → Instagram:
     URL:      https://rickypicks.com.mx/api/ig-webhook
     Campos:   messages, comments
   ============================================================ */
const { getAdmin } = require('../lib/supabaseAdmin');
const ig = require('../lib/instagram');

async function loadRules(admin) {
  const { data, error } = await admin.from('ig_rules').select('*').eq('active', true);
  if (error) throw error;
  return data || [];
}

async function bumpHits(admin, rule) {
  await admin.from('ig_rules').update({ hits: (rule.hits || 0) + 1, updated_at: new Date().toISOString() }).eq('id', rule.id);
}

async function upsertContact(admin, igsid, patch) {
  const { data: existing } = await admin.from('ig_contacts').select('igsid, username, unread').eq('igsid', igsid).maybeSingle();
  if (!existing) {
    const profile = await ig.getProfile(igsid);
    const row = {
      igsid,
      username: (profile && profile.username) || null,
      name: (profile && profile.name) || null,
      profile_pic: (profile && profile.profile_pic) || null,
      ...patch,
    };
    await admin.from('ig_contacts').upsert(row, { onConflict: 'igsid' });
    return row;
  }
  await admin.from('ig_contacts').update(patch).eq('igsid', igsid);
  return { ...existing, ...patch };
}

/* ---- DMs entrantes ---- */
async function handleMessage(admin, rules, ev) {
  const msg = ev.message;
  if (!msg || msg.is_echo) return; // echo = mensaje que mandamos nosotros
  const igsid = ev.sender && ev.sender.id;
  const mid = msg.mid;
  if (!igsid || !mid) return;
  if (String(igsid) === (await ig.meId())) return;

  // dedupe (Meta reintenta webhooks)
  const { data: dup } = await admin.from('ig_messages').select('id').eq('mid', mid).maybeSingle();
  if (dup) return;

  // fuente de verdad: el mensaje debe existir en la API
  let text = msg.text || '';
  if (process.env.IG_VERIFY_SOURCE !== 'off') {
    try {
      const real = await ig.getMessage(mid);
      text = real.message || text;
    } catch (e) {
      if (e.status && e.status < 500) {
        console.error('ig-webhook: mensaje no verificable, se ignora — mid=' + mid, e.message);
        return;
      }
      throw e; // error transitorio: 500 para que Meta reintente
    }
  }

  const now = new Date().toISOString();
  const contact = await upsertContact(admin, igsid, {
    last_in_at: now,
    last_msg_at: now,
    last_msg_text: text || '[adjunto]',
  });
  await admin.from('ig_contacts').update({ unread: (contact.unread || 0) + 1 }).eq('igsid', igsid);
  await admin.from('ig_messages').insert({
    mid, igsid, direction: 'in', text: text || null,
    attachments: msg.attachments || null, ts: now,
  });

  const rule = ig.pickRule(rules, 'dm', text, null);
  if (!rule || !rule.dm_reply) return;
  const reply = ig.fillTemplate(rule.dm_reply, { username: contact.username, name: contact.name });
  if (!reply) return;
  try {
    const sent = await ig.sendDm(igsid, reply);
    await admin.from('ig_messages').insert({
      mid: (sent && sent.message_id) || null, igsid, direction: 'out',
      text: reply, rule_id: rule.id, ts: new Date().toISOString(),
    });
    await admin.from('ig_contacts').update({ last_msg_at: new Date().toISOString(), last_msg_text: reply }).eq('igsid', igsid);
    await bumpHits(admin, rule);
    console.log(`ig-webhook: DM auto (regla "${rule.name}") → ${contact.username || igsid}`);
  } catch (e) {
    console.error('ig-webhook: fallo al responder DM — igsid=' + igsid, e.message);
  }
}

/* ---- comentarios ---- */
async function handleComment(admin, rules, value) {
  const commentId = value && value.id;
  if (!commentId) return;

  const { data: dup } = await admin.from('ig_comments').select('comment_id').eq('comment_id', commentId).maybeSingle();
  if (dup) return;

  // fuente de verdad: leer el comentario real de la API
  let c;
  try {
    c = await ig.getComment(commentId);
  } catch (e) {
    if (e.status && e.status < 500) {
      console.error('ig-webhook: comentario no verificable, se ignora — id=' + commentId, e.message);
      return;
    }
    throw e;
  }
  const fromId = c.from && c.from.id ? String(c.from.id) : null;
  const username = (c.from && c.from.username) || c.username || null;
  if (fromId && fromId === (await ig.meId())) return; // nuestros propios comentarios/respuestas
  const mediaId = (c.media && c.media.id) || null;

  const rule = ig.pickRule(rules, 'comment', c.text || '', mediaId);
  const row = {
    comment_id: commentId, media_id: mediaId, from_id: fromId,
    from_username: username, text: c.text || null,
    rule_id: rule ? rule.id : null, ts: new Date().toISOString(),
  };
  const ins = await admin.from('ig_comments').insert(row);
  if (ins.error) {
    if (String(ins.error.code) === '23505') return; // otro webhook simultáneo ya lo procesó
    throw ins.error;
  }
  if (!rule) return;

  const vars = { username, name: username };
  let replied = false, dmSent = false;

  if (rule.comment_reply) {
    const text = ig.fillTemplate(rule.comment_reply, vars);
    if (text) {
      try { await ig.replyToComment(commentId, text); replied = true; }
      catch (e) { console.error('ig-webhook: fallo respuesta pública — ' + commentId, e.message); }
    }
  }
  if (rule.dm_reply) {
    const text = ig.fillTemplate(rule.dm_reply, vars);
    if (text) {
      try {
        await ig.sendPrivateReply(commentId, text);
        dmSent = true;
        // el private reply abre conversación: que aparezca en el inbox
        if (fromId) {
          const now = new Date().toISOString();
          await upsertContact(admin, fromId, { last_msg_at: now, last_msg_text: text });
          await admin.from('ig_messages').insert({
            mid: null, igsid: fromId, direction: 'out', text, rule_id: rule.id, ts: now,
          });
        }
      } catch (e) {
        // típico: el usuario tiene los DMs cerrados, o ya se usó el private reply
        console.error('ig-webhook: fallo private reply — ' + commentId, e.message);
      }
    }
  }
  if (replied || dmSent) {
    await admin.from('ig_comments').update({ replied, dm_sent: dmSent }).eq('comment_id', commentId);
    await bumpHits(admin, rule);
    console.log(`ig-webhook: comentario de @${username || '?'} (regla "${rule.name}") — reply=${replied} dm=${dmSent}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] && q['hub.verify_token'] === process.env.IG_VERIFY_TOKEN) {
      return res.status(200).send(q['hub.challenge'] || '');
    }
    return res.status(403).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    const admin = getAdmin();
    const rules = await loadRules(admin);
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        await handleMessage(admin, rules, ev);
      }
      for (const change of entry.changes || []) {
        if (change.field === 'comments') await handleComment(admin, rules, change.value);
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('ig-webhook:', e);
    return res.status(500).end(); // Meta reintenta; el dedupe evita dobles respuestas
  }
};
