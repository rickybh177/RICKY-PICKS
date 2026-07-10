-- ============================================================
-- URGENTE: la tabla `entitlements` tiene una restricción CHECK en
-- la columna `plan` que nunca se actualizó al agregar los planes
-- de MLB. Esto bloquea EN SILENCIO cualquier intento de otorgar
-- acceso a mlb_pase / mlb_semana / mlb_fundador / mlb_temporada,
-- sin importar el método de pago (Mercado Pago, Stripe, PayPal o
-- códigos de canje).
--
-- Cómo correrlo:
-- 1. Entra a supabase.com → tu proyecto → SQL Editor
-- 2. Pega TODO este archivo y dale "Run"
-- 3. Solo se corre UNA vez.
-- ============================================================

-- 1. Quitar la restricción vieja (solo tenía los planes del Mundial)
alter table entitlements drop constraint if exists entitlements_plan_check;

-- 2. Agregarla de nuevo incluyendo los 4 planes de MLB
alter table entitlements add constraint entitlements_plan_check
  check (plan in (
    'mexico', 'individual', 'torneo',
    'mlb_pase', 'mlb_semana', 'mlb_fundador', 'mlb_temporada'
  ));

-- ============================================================
-- Verificación rápida (opcional): confirma que la restricción
-- ya incluye los planes de MLB.
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conname = 'entitlements_plan_check';
-- ============================================================
