/* ============================================================
   /api/ig-admin — API del panel de Instagram (solo admin).

   GET  ?action=status         → estado de conexión (env vars + /me)
   GET  ?action=rules          → todas las reglas
   GET  ?action=conversations  → contactos ordenados por actividad
   GET  ?action=messages&igsid → hilo de un contacto (marca leído)
   GET  ?action=comments       → log de comentarios recientes
   POST {action:'save-rule', rule}    → crear/editar regla
   POST {action:'delete-rule', id}
   POST {action:'send', igsid, text}  → mandar DM desde el inbox
   ============================================================ */
const { getAdmin, getUserFromToken } = require('../lib/supabaseAdmin');
const ig = require('../lib/instagram');

const ADMIN_EMAILS = ['rickybh17@gmail.com'];

module.exports = async function handler(req, res) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = await getUserFromToken(token);
  if (!user || !ADMIN_EMAILS.includes(user.email)) {
    return res.status(403).json({ error: 'Acceso no autorizado.' });
  }

  const admin = getAdmin();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = (req.query && req.query.action) || body.action;

  try {
    /* ---------- GET ---------- */
    if (req.method === 'GET') {
      if (action === 'status') {
        const env = {
          IG_ACCESS_TOKEN: !!process.env.IG_ACCESS_TOKEN,
          IG_VERIFY_TOKEN: !!process.env.IG_VERIFY_TOKEN,
        };
        if (!env.IG_ACCESS_TOKEN) return res.status(200).json({ connected: false, env });
        try {
          const me = await ig.getMe();
          return res.status(200).json({ connected: true, env, account: me });
        } catch (e) {
          return res.status(200).json({ connected: false, env, error: e.message });
        }
      }

      if (action === 'rules') {
        const { data, error } = await admin.from('ig_rules').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json({ rules: data || [] });
      }

      if (action === 'conversations') {
        const { data, error } = await admin
          .from('ig_contacts').select('*')
          .order('last_msg_at', { ascending: false, nullsFirst: false })
          .limit(200);
        if (error) throw error;
        return res.status(200).json({ conversations: data || [] });
      }

      if (action === 'messages') {
        const igsid = req.query.igsid;
        if (!igsid) return res.status(400).json({ error: 'Falta igsid.' });
        const { data, error } = await admin
          .from('ig_messages').select('*')
          .eq('igsid', igsid).order('ts', { ascending: true }).limit(500);
        if (error) throw error;
        await admin.from('ig_contacts').update({ unread: 0 }).eq('igsid', igsid);
        const { data: contact } = await admin.from('ig_contacts').select('*').eq('igsid', igsid).maybeSingle();
        return res.status(200).json({ messages: data || [], contact: contact || null });
      }

      if (action === 'comments') {
        const { data, error } = await admin
          .from('ig_comments').select('*').order('ts', { ascending: false }).limit(200);
        if (error) throw error;
        return res.status(200).json({ comments: data || [] });
      }

      return res.status(400).json({ error: 'Acción desconocida.' });
    }

    /* ---------- POST ---------- */
    if (req.method === 'POST') {
      if (action === 'save-rule') {
        const r = body.rule || {};
        if (!r.name || !r.trigger_type) return res.status(400).json({ error: 'La regla necesita nombre y tipo.' });
        if (!['comment', 'dm'].includes(r.trigger_type)) return res.status(400).json({ error: 'Tipo inválido.' });
        if (!r.comment_reply && !r.dm_reply) return res.status(400).json({ error: 'La regla necesita al menos una respuesta.' });
        const row = {
          name: String(r.name).slice(0, 120),
          trigger_type: r.trigger_type,
          keywords: Array.isArray(r.keywords) ? r.keywords.map(k => String(k).trim()).filter(Boolean) : [],
          match_type: r.match_type === 'exact' ? 'exact' : 'contains',
          media_id: r.media_id ? String(r.media_id).trim() : null,
          comment_reply: r.comment_reply ? String(r.comment_reply) : null,
          dm_reply: r.dm_reply ? String(r.dm_reply) : null,
          active: r.active !== false,
          updated_at: new Date().toISOString(),
        };
        const q = r.id
          ? admin.from('ig_rules').update(row).eq('id', r.id).select().single()
          : admin.from('ig_rules').insert(row).select().single();
        const { data, error } = await q;
        if (error) throw error;
        return res.status(200).json({ rule: data });
      }

      if (action === 'delete-rule') {
        if (!body.id) return res.status(400).json({ error: 'Falta id.' });
        const { error } = await admin.from('ig_rules').delete().eq('id', body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'send') {
        const { igsid, text } = body;
        if (!igsid || !text || !String(text).trim()) return res.status(400).json({ error: 'Faltan igsid o texto.' });
        try {
          const sent = await ig.sendDm(igsid, String(text).trim());
          const now = new Date().toISOString();
          await admin.from('ig_messages').insert({
            mid: (sent && sent.message_id) || null, igsid, direction: 'out',
            text: String(text).trim(), ts: now,
          });
          await admin.from('ig_contacts').update({ last_msg_at: now, last_msg_text: String(text).trim() }).eq('igsid', igsid);
          return res.status(200).json({ ok: true });
        } catch (e) {
          // el error más común: fuera de la ventana de 24 h
          return res.status(422).json({ error: e.message });
        }
      }

      return res.status(400).json({ error: 'Acción desconocida.' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    console.error('ig-admin:', e);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};
