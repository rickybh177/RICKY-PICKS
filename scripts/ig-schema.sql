-- ============================================================
-- Esquema del módulo de automatización de Instagram.
-- Correr UNA VEZ en Supabase → SQL Editor.
--
-- Todas las tablas se leen/escriben SOLO desde el backend con la
-- service role key; RLS queda activado SIN políticas para que la
-- anon key del navegador no pueda tocarlas.
-- ============================================================

-- Reglas de automatización: "si un comentario/DM contiene X → responder Y".
create table if not exists ig_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger_type text not null check (trigger_type in ('comment', 'dm')),
  keywords text[] not null default '{}',   -- vacío = aplica a cualquier texto (catch-all)
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  media_id text,                           -- opcional: limitar la regla a un post concreto
  comment_reply text,                      -- respuesta pública al comentario (solo trigger 'comment')
  dm_reply text,                           -- DM a enviar (private reply si vino de comentario)
  active boolean not null default true,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contactos: cada persona que ha escrito por DM (o recibió un private reply).
-- igsid = Instagram-Scoped ID (el id del usuario, único por app).
create table if not exists ig_contacts (
  igsid text primary key,
  username text,
  name text,
  profile_pic text,
  first_seen timestamptz not null default now(),
  last_in_at timestamptz,     -- último mensaje DEL usuario → define la ventana de 24 h
  last_msg_at timestamptz,    -- última actividad en cualquier dirección (orden del inbox)
  last_msg_text text,
  unread integer not null default 0
);

-- Historial de mensajes (entrantes y salientes).
create table if not exists ig_messages (
  id bigint generated always as identity primary key,
  mid text unique,            -- id del mensaje en la API de Meta (dedupe de webhooks)
  igsid text not null references ig_contacts(igsid) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  text text,
  attachments jsonb,
  rule_id uuid,               -- si lo mandó una regla automática, cuál
  ts timestamptz not null default now()
);
create index if not exists ig_messages_igsid_ts on ig_messages (igsid, ts desc);

-- Log de comentarios procesados (también sirve de dedupe de webhooks).
create table if not exists ig_comments (
  comment_id text primary key,
  media_id text,
  from_id text,
  from_username text,
  text text,
  rule_id uuid,
  replied boolean not null default false,  -- se respondió públicamente
  dm_sent boolean not null default false,  -- se mandó private reply
  ts timestamptz not null default now()
);
create index if not exists ig_comments_ts on ig_comments (ts desc);

alter table ig_rules enable row level security;
alter table ig_contacts enable row level security;
alter table ig_messages enable row level security;
alter table ig_comments enable row level security;
