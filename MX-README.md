# MODELO LIGA MX — Apertura 2026 (beta privada)

Modelo de predicciones de Liga MX integrado al sitio RICKY·PICKS.
Lanzado en beta privada solo-admin (mismo esquema que NFL): `/mx.html` +
`api/mx-picks.js` con candado server-side a `rickybh17@gmail.com`.
El botón "Liga MX" del nav de la homepage solo aparece con sesión admin.

## Cómo funciona

**No es Monte Carlo.** El fútbol permite algo más preciso: una matriz
exacta de marcadores **Dixon-Coles** (Poisson bivariado con corrección
de marcadores bajos). Cada mercado se deriva analíticamente de la matriz
— cero varianza de simulación, picks deterministas entre recargas.

1. **Priors** (`lib/mx/priors.js`, generado — NO editar a mano):
   ataque/defensa por equipo ajustados sobre ~850 partidos de mex.1
   (Clausura 2024 → 14-jul-2026) con decaimiento temporal de 300 días,
   vía `scripts/build-mx-priors.js`. También ajusta: ventaja de local,
   **coeficiente de altitud** (la firma de la liga: la sede se toma del
   partido real, no del estadio "oficial" — importante con las sedes
   temporales del Mundial 2026), y rho de Dixon-Coles (la Liga MX
   empata de más; rho salió negativo como se esperaba).
2. **Aprendizaje en línea** (`lib/mx/model.js`): cada resultado del
   Apertura 2026 actualiza los ratings (paso de gradiente Poisson,
   K=0.025, capado) + una corrección global del entorno goleador
   (`muShift`) — si el torneo anota más/menos que la historia, el nivel
   de liga se corrige solo. Cero mantenimiento manual.
3. **Mercados**: 1X2, doble oportunidad, O/U 1.5/2.5/3.5, ambos anotan,
   hándicap asiático, totales por equipo, portería en cero, marcador
   exacto, 1ª mitad y córneres (priors + summaries del torneo).
4. **Veredictos BET/MAYBE/SKIP**: con momios reales (DraftKings vía el
   scoreboard de ESPN) el veredicto es por **EV** sobre una probabilidad
   encogida 28% hacia el mercado (anti-longshot). Sin momios publicados,
   el veredicto se topa en MAYBE (no hay precio que ganar). La doble
   oportunidad usa barras altas (BET ≥ 84%) como "seguro" del partido.

## Datos (todo gratis, sin API keys)

- ESPN site API `soccer/mex.1`: calendario, resultados, forma (WLDDL),
  momios DraftKings (ML 3 vías + total + spread), sede real con ciudad.
- Summaries por partido: córneres/tiros (máx 40 por corrida, cacheados).
- Sin `TODAY_ISO` ni nada manual: la cartelera es una ventana rodante
  (ayer → +9 días) y la jornada se estima por juegos disputados.

## Validación (scripts/mx-backtest.js)

Walk-forward sobre el Clausura 2026 completo (fuera de muestra, priors
cortados al 5-ene-2026):

- 1X2: Brier 0.616 / log-loss 1.028 vs base de liga 0.649 / 1.072 ✓
- "Seguros" DC ≥84%: 34/40 = 85% de acierto ✓
- Marcador exacto top-1: ~8-9% ✓
- O/U y BTTS calibran al nivel de liga con la corrección en línea; la
  deriva goleadora del C2026 (+5%) fue el motivo del muShift.

Para recalibrar: correr el backtest ANTES de desplegar cambios del
engine y comparar Brier/calibración. Regenerar priors entre torneos:
`node scripts/build-mx-priors.js` (ajustar HIST_END a la víspera del
torneo nuevo y SEASON_START en lib/mx/data.js).

## Cómo publicarlo (cuando se decida cobrar)

Igual que el plan del MLB (ver MLB-README.md): quitar el candado
admin de `api/mx-picks.js` y cambiarlo por el check de entitlement
(`lib/plans.js` + Supabase), decidir si hay juego gratis del día
(freemium tipo MLB) o acceso total de paga, y agregar el plan al
checkout. El frontend ya maneja 403 → candado de login.

## Archivos

- `lib/mx/teams.js` — 18 equipos + altitud por ciudad sede
- `lib/mx/data.js` — capa ESPN (scoreboard, momios, summaries, caché)
- `lib/mx/fit.js` — ajustador Dixon-Coles (solo scripts, nunca runtime)
- `lib/mx/priors.js` — generado por build-mx-priors.js
- `lib/mx/engine.js` — matriz de marcadores + todos los mercados
- `lib/mx/model.js` — orquestador + veredictos + análisis en español
- `api/mx-picks.js` — endpoint (candado admin)
- `public/mx.html` — frontend (design system terminal claro, como NFL)
- `scripts/build-mx-priors.js` / `scripts/mx-backtest.js`

Ojo: dev-server.js NO recarga `lib/` en caliente — reiniciar tras tocar
lib/mx (mismo gotcha que MLB).
