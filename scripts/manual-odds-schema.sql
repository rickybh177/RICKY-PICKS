-- ============================================================
-- MOMIOS MANUALES (Playdoit) — correr UNA vez en Supabase
-- (SQL Editor → New query → pegar → Run), igual que ig-schema.sql.
--
-- Una fila por juego y deporte. `odds` es JSON con el mismo shape
-- que lib/nfl/manual-odds.js:
--   nfl: { ml_home, ml_away, spread, spread_home, spread_away,
--          total, total_over, total_under, markets? }
--   mx:  { ml_home, ml_draw, ml_away, total, total_over, total_under }
--   mlb: { ml_home, ml_away, total }
-- game_key: 'YYYY-MM-DD:VISITA@LOCAL' (fecha en hora de México,
-- abreviaturas del modelo). Escribe/lee api/odds-ingest.js con la
-- service role: NO se necesita RLS abierta.
-- ============================================================

create table if not exists manual_odds (
  sport       text not null check (sport in ('nfl', 'mx', 'mlb')),
  game_key    text not null,
  source      text not null default 'Playdoit',
  odds        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (sport, game_key)
);

alter table manual_odds enable row level security;
-- Sin políticas: solo la service role (backend) puede leer/escribir.
