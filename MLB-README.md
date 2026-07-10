# Modelo MLB — RICKY·PICKS

Modelo de predicciones de MLB por simulación Monte Carlo a nivel de **turno al bate**:
cada juego se simula 10,000 veces combinando las tasas reales del pitcher contra cada
bateador del lineup (log5), con parque, clima, bullpen, splits por mano y penalización
por vueltas al lineup (times-through-the-order).

**Estado: beta privada.** Solo el admin (`rickybh17@gmail.com`) puede verlo.
No está linkeado desde el landing ni tiene precio público.

---

## Cómo verlo

- **Producción:** `https://ricky-picks.vercel.app/mlb.html` → inicia sesión con tu cuenta admin.
- **Local:** `node dev-server.js` → `http://localhost:3000/mlb.html` (en local no pide sesión).

La página muestra: juegos del día, abridores con mano/ERA, clima, probabilidad de ganar
(moneyline), total con distribución de las 10,000 simulaciones, run line, primeras 5
entradas (F5), NRFI, totales por equipo, y los picks con más convicción del modelo.
Las flechas ‹ › navegan entre fechas; **Actualizar** recalcula con lineups/clima de ahora.

## Qué se actualiza solo (nada que hacer a diario)

Todo. A diferencia del modelo del Mundial (que pide cambiar `TODAY_ISO` a mano), el de
MLB jala en runtime desde MLB StatsAPI (gratis, sin API key):

| Dato | Fuente | Cuándo |
|---|---|---|
| Calendario y hora de juegos | StatsAPI `schedule` | cada request (caché 5 min) |
| Abridores probables | StatsAPI | igual |
| Lineups confirmados | StatsAPI | aparecen ~1-4 h antes del juego; antes usa "lineups proyectados" (promedio del equipo vs la mano del abridor) |
| Stats de jugadores + splits vs L/R | StatsAPI (bulk) | caché 1 h |
| Bullpen por equipo | StatsAPI (split `rp`) | caché 1 h |
| Clima (temp/viento por estadio) | El propio feed de MLB | caché 5 min |
| Baseline de la liga | StatsAPI agregado | caché 6 h |
| Park factors | Tabla fija en `lib/mlb/parks.js` | revisar 1 vez por temporada |

Los picks mejoran solos cuando se confirman los lineups → el badge cambia de
"lineups proyectados" a "lineups confirmados". Si quieres el número más fresco antes
de publicar en redes, presiona **Actualizar** en la página.

## Arquitectura (misma filosofía que el modelo del Mundial)

```
lib/mlb/engine.js    ← motor Monte Carlo (log5, base-out, TTO, walk-off, extras)
lib/mlb/model.js     ← orquestador: datos → tasas con shrinkage → sim → mercados
lib/mlb/statsapi.js  ← capa de datos MLB StatsAPI con caché
lib/mlb/parks.js     ← park factors, techos, clima→multiplicadores, metadata equipos
api/mlb-picks.js     ← GET /api/mlb-picks?date=YYYY-MM-DD (gated, solo probabilidades)
public/mlb.html      ← dashboard (no linkeado desde el landing)
scripts/mlb-backtest.js ← backtesting sin fuga de futuro
```

**El modelo nunca sale del servidor.** El API devuelve solo probabilidades, esperados
y datos públicos (nombres, ERA, récord). Las tasas por PA, el shrinkage, los park
factors y todos los parámetros viven en `lib/mlb/` (backend).

## Cómo publicarlo cuando quieras cobrar

1. **Precio:** agrega el plan en `lib/plans.js`, p. ej.
   `mlb: { id: 'mlb', title: 'MLB 30 días', price: 399, currency: 'MXN' }`.
2. **Gate:** en `api/mlb-picks.js`, reemplaza el bloque "SOLO ADMIN" por el patrón de
   `api/picks.js`: `getUserFromToken` → `getEntitlement` → aceptar `plan === 'mlb'`
   (o `torneo` si quieres incluirlo). El comentario en el archivo marca el lugar exacto.
3. **Checkout:** los webhooks de pago ya existentes (`mp-webhook.js`, etc.) otorgan el
   entitlement con `grantEntitlement(userId, 'mlb')` — mismo flujo que hoy.
4. **Landing:** agrega la sección/botón en `public/index.html` → `/checkout.html?plan=mlb`,
   y quita el candado de `public/mlb.html` (la página ya maneja login).

## Backtesting

```bash
node scripts/mlb-backtest.js --start 2026-04-20 --end 2026-07-05 --sims 3000
```

- Reconstruye cada juego con stats **hasta el día anterior** (`byDateRange`) — sin fuga
  de futuro — usando los lineups reales del día.
- Reporta: Brier, log-loss, calibración por buckets, acierto del favorito, MAE del
  total, NRFI.
- **ROI vs línea de cierre:** requiere un CSV de momios (`--odds closing.csv` con
  columnas `date,away,home,ml_away,ml_home` en momios americanos y nombres completos
  de equipos). MLB StatsAPI no da momios; se pueden exportar de The Odds API o de
  archivos históricos de SBR. Sin ese archivo el backtest valida calibración, no ROI.
- Limitaciones del modo backtest (vs producción): sin splits vs L/R (byDateRange no
  los da) y bullpen con stats de temporada completa.

Regla del negocio: **no vender picks de un mercado que no calibre en el backtest.**

### Resultados del backtest inicial (20-abr → 5-jul 2026, 1,018 juegos)

| Métrica | Modelo | Referencia |
|---|---|---|
| Brier (moneyline) | **0.2471** | 0.25 azar · 0.2498 siempre-local |
| Log-loss | **0.6875** | 0.693 azar |
| Acierto del favorito | 53.7% | libros ~57-58% |
| Mitad de alta convicción | **60.1%** | mitad de baja convicción 47.3% |
| Favoritos ≥65% | 63.4% real | 69.8% dice el modelo (leve sobreconfianza) |
| NRFI promedio | 48.1% | 47.3% real (bien calibrado) |

Lecturas honestas: el modelo le gana a los baselines y **separa juegos de verdad**
(60% en su mitad de alta convicción), y NRFI calibra casi perfecto. Todavía no está
demostrado que le gane a la línea de cierre (falta el CSV de momios) y arriba de 65%
es un poco sobreconfiado — para venderlo, comunicar picks de convicción media-alta,
no los extremos. El backtest corre sin platoon splits; producción los usa, así que
el número real debería ser ligeramente mejor.

## Calibraciones incluidas (validadas contra 2026)

- Total por juego ≈ 9.1 carreras (promedio real de la temporada).
- Ventaja de local = 52.2% (medida en los 1,356 juegos de 2026, no el 54% histórico).
- YRFI ~48-52% con lineups confirmados (efecto 1ª entrada incluido).
- Umbrales de picks por mercado en `derivePicks()` (`lib/mlb/model.js`): un +1.5 al
  80% no es pick; un ML al 62% sí.

## Roadmap (mejoras con más edge)

1. **Momios reales** (The Odds API) para mostrar edge modelo-vs-casa y rankear picks
   por valor esperado, no por probabilidad.
2. **Fatiga de bullpen** (uso de relevistas últimos 3 días → señal de Over).
3. **Statcast xwOBA** en lugar de resultados crudos (pybaseball) para tasas menos ruidosas.
4. **Umpires** (tendencia de zona de strike → totales).
5. Entrenar coeficientes propios con Retrosheet (la "Opción B" del brief).
