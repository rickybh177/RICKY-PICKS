-- ============================================================
-- URGENTE (2ª vez): la tabla `entitlements` tiene una restricción
-- CHECK en la columna `plan` con una lista fija de valores. Cada
-- vez que el sitio agrega planes nuevos (pasó con MLB, ahora con
-- combo_fundador / mx_fundador / mx_apertura / final), la BD
-- rechaza EN SILENCIO el acceso después de cobrar el pago.
--
-- Solución definitiva: ELIMINAR la restricción. La lista válida
-- de planes vive en el código del servidor (lib/plans.js) — que
-- es quien decide qué se puede vender y otorgar — así que el
-- CHECK en la BD solo duplica esa lista y se desactualiza.
--
-- Cómo correrlo:
-- 1. Entra a supabase.com → tu proyecto → SQL Editor
-- 2. Pega TODO este archivo y dale "Run"
-- 3. Solo se corre UNA vez.
-- ============================================================

alter table entitlements drop constraint if exists entitlements_plan_check;

-- ============================================================
-- Verificación (opcional): no debe regresar ninguna fila.
-- select conname from pg_constraint
-- where conrelid = 'entitlements'::regclass and conname = 'entitlements_plan_check';
-- ============================================================
