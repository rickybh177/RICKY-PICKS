# MODELO NBA 2026-27

Modelo de predicción de la NBA integrado a Dattip, al nivel de los de
NFL, Liga MX y Europa: mercados de partido (ganador, hándicap, total,
totales por equipo, 1ª mitad, 1er cuarto), props de jugador (puntos,
rebotes, asistencias, triples, PRA y doble-doble) y una combinada
sugerida del día. Nació el 26-oct-2026 en beta privada solo-admin y se
**abrió al público el 27-oct-2026** (freemium: el pick gratis del día va
completo, el resto se bloquea en el servidor; planes `nba_mensual` $349
y `nba_temporada` $899, y es el octavo modelo de "tres a elegir" y de
"todos"). `/nba.html` + `api/nba-picks.js` / `api/nba-free.js` /
`api/nba-props.js`. Para volver a beta privada: `NBA_PUBLIC = false` en
los tres endpoints (cualquiera que no sea `rickybh17@gmail.com` recibe
`403 { beta: true }`). Al abrir se publicó un aviso de lanzamiento
(`public/nba-aviso.js`): a todos, con o sin cuenta, 3 veces (contador en
`user_metadata.nba_aviso` con sesión, en localStorage sin ella); dice
que la NBA ya viene incluida en el plan de todos los modelos. Se quita
borrando el `<script>` de las páginas.

Todo el modelo vive en el backend (`lib/nba/`); el navegador recibe
solo probabilidades, líneas, veredictos y proyecciones.

## Resumen honesto: qué tan bueno es contra el mercado

Backtest walk-forward sobre la **temporada regular 2025-26** (1,235
juegos; ratings ajustados solo con 2023-24 y 2024-25; cada juego se
predice antes de aprender su resultado), medido contra la línea de
**cierre** de ESPN BET / DraftKings / Caesars (core API de ESPN):

| | Modelo | Mercado (cierre) |
|---|---|---|
| Brier del ganador | 0.2011 | 0.1951 |
| Log-loss del ganador | 0.588 | 0.572 |
| MAE del margen | 11.05 | 10.86 |
| MAE del total | 15.57 | 15.26 |
| Base localía pura (Brier) | 0.2472 | — |

- **El modelo NO le gana al cierre.** Cuando discrepa de la línea de
  cierre, su lado cubre ~50-53% (punto de equilibrio 52.4%); la regla
  de veredictos a precios de cierre da ROI entre −5% y +1% según
  parámetros: ruido. Mezclar modelo y cierre solo mejora el MAE con 15%
  de peso al modelo.
- **Sí le gana a la apertura.** El lado del modelo contra la línea de
  APERTURA cubre **56.4% (n=675) con discrepancia ≥2 pts y 57.5%
  (n=449) con ≥3**; y la línea se mueve hacia el modelo **74-83% de las
  veces** (CLV medio +1.1 a +1.7 pts). En el pliegue 2024-25 es aún más
  claro: 59.3% (n=720) y 61.6% (n=513) contra la apertura.
- **De dónde sale esa ventaja:** de las AUSENCIAS. Sin el ajuste por
  bajas, el lado del modelo contra la apertura cae a 51.6-52.9%. El
  backtest conoce las bajas perfectas (quién de la rotación no jugó,
  leído del boxscore), así que esos números son un **techo**: en
  producción las bajas salen del reporte de lesiones de ESPN, que llega
  antes que la línea de cierre pero no siempre antes que la apertura.
  El valor real del modelo se medirá en temporada: registrar el pick
  contra la línea del momento y compararlo con el cierre.
- **Calibración del ganador** (decil del favorito, predicho → real):
  55→58, 65→71, 75→78, 84→86, 92→100 (n=449/385/259/121/21). Un pelo
  conservador: con `SD_ML` 12.5 en vez de la sd completa del margen
  (14.2) el Brier baja de 0.2011 a 0.1999.

Conclusión para el producto: el tablero de NBA se lee como
**orientación afinada por bajas y descanso**, no como una máquina de
vencer al cierre. Por eso los veredictos encogen 40% hacia el mercado,
exigen EV ≥ 4% para PICK y se topan a MAYBE cuando la línea del mercado
está a ≥7 puntos de la del modelo (el mercado sabe algo que el reporte
de lesiones aún no dice).

## Fuentes

- **ESPN** (sin key, espejo `site.web.api.espn.com` + UA de navegador,
  igual que NFL): `scoreboard?dates=YYYYMMDD` (resultados y parciales
  por cuarto), `summary?event=ID` (boxscore: estadísticas de equipo →
  posesiones; minutos, puntos, rebotes, asistencias, triples… de cada
  jugador, con quién NO jugó), `injuries` (reporte de lesiones de los
  30 equipos; el id del jugador viene dentro del link a su ficha) y el
  core API `…/competitions/ID/odds` (línea de **apertura y cierre**
  histórica por casa: spread, total, moneyline).
- **The Odds API** (única fuente de momios en vivo, `lib/odds/theoddsapi.js`):
  sport key `basketball_nba`, `h2h,spreads,totals` (3 créditos por
  consulta, TTL 30 min, caché en dos niveles). Props por evento
  (`player_points, player_rebounds, player_assists, player_threes,
  player_points_rebounds_assists, player_double_double`, región `us`):
  6 créditos por juego, bajo demanda, caché 4 h en el KV (×8 si quedan
  <2,000 créditos).

## Cómo funciona

### Modelo de equipo (`lib/nba/core.js`, `engine.js`, `model.js`)

El básquet se separa en **ritmo** y **eficiencia**:

```
poss    = P + pace[h] + pace[a]                         (posesiones del juego)
ortg_h  = mu + muShift + hfa/2 + off[h] − def[a] + descanso_h − c·abs_h/2 + c·abs_a/2
ortg_a  = mu + muShift − hfa/2 + off[a] − def[h] + descanso_a − c·abs_a/2 + c·abs_h/2
E_h     = poss · ortg_h / 100,   E_a = poss · ortg_a / 100
```

`off`/`def` en puntos por 100 posesiones vs promedio (def positivo =
buena defensa), `pace` en posesiones vs promedio. `abs` = valor de los
ausentes de cada equipo (ver abajo), mitad en su propio ataque y mitad
en el del rival: mueve el margen, casi no el total.

1. **Priors** (`lib/nba/priors.js`, GENERADO por
   `scripts/build-nba-priors.js`, no editar a mano): ratings ajustados
   por rival (`lib/nba/fit.js`: mu y hfa en forma cerrada, off/def/pace
   por descenso coordenado con ridge de 8 pseudo-juegos) sobre
   2023-24 → 2025-26 (3,973 juegos, half-life 365 días, playoffs ×0.8),
   con descanso y ausencias descontados, regresados a la media con
   **carry 0.7**. Liga 2026-27: mu 112.0, hfa 1.74 pts/100 (≈1.8 pts de
   margen), 102 posesiones.
2. **Aprendizaje en línea**: cada resultado de la 2026-27 corrige
   off/def con K=0.05 × sorpresa (capada a 25 pts/100) y pace con
   KP=0.1, más muShift (entorno anotador, encogido n/(n+150), tope ±3).
   La sorpresa se **limpia de la suerte en triples** (50% de la propia
   y 50% de la del rival, sobre un 36% de liga): Brier 0.2008 → 0.2005 y
   MAE total 15.76 → 15.64. Con K=0 (sin aprender) el Brier es 0.2375.
3. **Descanso** (`PARAMS.REST`, residuo medio por categoría, pts/100):
   segundo juego en dos noches −0.41 local / −0.36 visita, tercero en
   cuatro noches +0.34, descanso largo (6+ días) **−1.11: se juega
   peor oxidado**. Efecto chico: ON/OFF casi no cambia las métricas,
   pero se deja porque es la realidad medida.
4. **Ausencias** (`lib/nba/players.js`): la rotación de un equipo son
   quienes jugaron ≥40% de sus últimos 20 juegos con ≥15 min. El valor
   de cada uno es su Game Score de Hollinger por juego menos lo que
   produciría un suplente en sus minutos (0.28 GmSc/min), ponderado por
   recencia (half-life 10). Hoy: reporte de lesiones de ESPN → Out ×1,
   Doubtful ×0.8, Questionable/Day-To-Day ×0.4, Probable ×0.1. El
   coeficiente `ABS_C` = 0.3 (grid: 0.25-0.35 plano; 0 → Brier 0.2048,
   0.25 → 0.2005, 0.7 → 0.2096). La ventana larga es a propósito: un
   titular que lleva 8 juegos fuera SIGUE en la rotación, así la
   expectativa lleva su descuento, el rating aprende "a plantel
   completo" y cuando vuelve el descuento desaparece solo.
5. **Mercados en forma cerrada** (`engine.js`): margen y total
   normales con continuidad, desviaciones medidas FUERA DE MUESTRA
   (`DISP`: sd margen 14.2, sd total 23.0, sd del ganador 12.5); 1ª
   mitad = 50.5% del total y 63% del margen esperado (sd 12.3 / 11.2);
   1er cuarto = 25.5% y 36% (sd 8.3 / 8.2). Líneas enteras devuelven el
   push como la casa. Determinista: no hay simulación, los picks no
   bailan entre recargas.
6. **Veredictos**: con momios, EV sobre la prob encogida 40% hacia el
   devig del consenso; PICK ≥ 4%, MAYBE ≥ 1.5%, piso 30%. Sin momios,
   tope MAYBE por barra. Guardián de divergencia: línea del mercado a
   ≥7 pts (hándicap) o ≥12 (total) del modelo → tope MAYBE con aviso.
   1ª mitad y 1er cuarto no tienen momio del consenso: tope MAYBE.
7. **Combinada sugerida**: hasta 3 PICKs de juegos distintos; la
   probabilidad conjunta es el producto de las probabilidades
   ENCOGIDAS hacia el mercado (no del modelo puro). El texto lo dice:
   un parlay multiplica el riesgo, no la ventaja.
8. **Altitud** (DEN/UTAH): probada como extra de localía, no ayuda
   (ALT_HFA 0-3: MAE sube). Se deja en 0.

### Estado de la temporada (`lib/nba/season.js`)

Para tener ratings y rotaciones al día hacen falta todos los juegos
terminados con boxscore. Dos capas: la **estática**
(`lib/nba/data/games-2027.json` + `player-games-2027.json`, generados
por `scripts/nba-history.js 2027 --no-odds`) y el **delta en el KV**
(`nba-season-2027-delta`, Supabase Storage): cada request completa los
juegos nuevos desde el último guardado (máximo 40 boxscores por
request) y los deja para las demás lambdas. Regenerar la estática cada
2-4 semanas mantiene el delta chico.

### Props de jugador (`lib/nba/props.js`, `api/nba-props.js`)

Proyección = minutos esperados (recencia half-life 5) × ritmo por
minuto de cada stat (ratio de medias, half-life 10, hasta 30 juegos,
mínimo 5 con ≥8 min) × entorno (puntos del equipo esperados hoy vs los
de su muestra, exponente 0.3; posesiones para rebotes/asistencias/
triples, exponente 0.4) × factor rival (lo que esa defensa permite por
stat vs liga, encogido 0.5, [0.9, 1.1]). Distribución: mezcla
lognormal/normal (50% / 50%; 40% en PRA) con continuidad para enteros;
binomial negativa por momentos para triples; doble-doble = frecuencia
propia encogida (n/(n+20)) hacia la de las marginales.

Backtest walk-forward 2025-26 (20,549 filas jugador-juego, desde el
juego 10 de cada equipo), MAE modelo vs "promedio de temporada" vs
"últimos 5":

| Stat | MAE modelo | temporada | últimos 5 | sesgo | calibración over en la línea mediana (pred → real) |
|---|---|---|---|---|---|
| Minutos | 4.55 | — | — | +0.04 | — |
| Puntos | 4.74 | 4.82 | 5.01 | +0.14 | 49% → 51% |
| Rebotes | 1.93 | 1.95 | 2.04 | +0.01 | 55% → 54% |
| Asistencias | 1.41 | 1.43 | 1.48 | +0.05 | 58% → 57% |
| Triples | 0.94 | 0.95 | 1.00 | +0.01 | 49% → 50% |
| PRA | 6.10 | 6.24 | 6.40 | +0.19 | 49% → 51% |
| Doble-doble | — | — | — | — | 7.9% → 8.2% (sobreconfiado arriba del 60%: tope MAYBE) |

Calibración a ±0.5σ y ±1σ dentro de 3 puntos en todas las stats. El
entorno y el rival casi no mueven el MAE (grids planos): lo que manda
son los minutos y el ritmo reciente. Guardianes en el endpoint: línea a
>35% de la proyección → MAYBE ("posible cambio de rol"); si CUALQUIER
mercado del jugador diverge, todos los suyos se topan; edge ≥12% →
MAYBE ("el mercado sabe algo"); cuestionable o recién cambiado de
equipo → MAYBE; doble-doble siempre tope MAYBE; sin línea → LECTURA.
No hay líneas históricas de props, así que la calibración es contra
líneas sintéticas (mu ± k·sd): dice que la probabilidad es honesta, no
que gane al mercado de props.

## Cómo correr

```bash
node scripts/nba-history.js 2024 2025 2026        # histórico (caché en tmp; ~10 min la primera vez)
node scripts/nba-history.js 2027 --no-odds         # temporada en curso → lib/nba/data/*-2027.json
node scripts/nba-backtest.js                       # walk-forward 2025-26 (grids, cierre, apertura)
node scripts/nba-backtest.js --fold 2025           # pliegue 2024-25
node scripts/nba-props-backtest.js                 # props (tarda ~10 min)
node scripts/build-nba-priors.js > lib/nba/priors.js
node dev-server.js                                 # /nba.html · ?as=guest · ?as=beta
```

`scripts/nba-common.js` tiene lo compartido por los tres scripts
(carga, ausencias históricas, descanso, dispersión).

## Calibraciones no obvias

- **Carry 0.7**: plano de 0.4 a 0.85 (Brier 0.2047-0.2049); 1.0 ya
  empeora. Los rosters rotan mucho entre temporadas.
- **K 0.05**: 0.03 → 0.2065, 0.05 → 0.2047, 0.1 → 0.2067, 0.15 → 0.2112.
- **KP 0.1**: el ritmo sí hay que aprenderlo rápido (KP=0 → MAE total
  16.40; 0.1 → 15.68).
- **muShift** casi no pesa en la NBA (sesgo +0.3 pts con o sin él); se
  deja por consistencia con MX/NFL.
- **SD del ganador 12.5 ≠ SD del margen 14.2**: la distribución real
  del margen tiene colas pesadas (palizas, garbage time) que inflan la
  sd pero no cambian quién gana. Para "cubre" la sd completa calibra
  mejor (Brier 0.2559 vs 0.2591 con 11.5).
- **1ª mitad lleva 63% del margen esperado** (no 50%): los favoritos
  sacan ventaja temprano y la administran; el total sí va 50/50.
- **Los props no mejoran con el entorno del juego**: los grids de
  ENV_EXP y DEF_SHRINK son planos a la tercera decimal. Se dejan en
  valores chicos (0.3 / 0.4 / 0.5) para que un juego claramente rápido
  o una defensa claramente mala muevan un poco la proyección sin
  romper la calibración.
- **Reporte de lesiones de ESPN**: el `athlete` no trae `id`; se saca
  del link a su ficha (`/id/4712863/`). Se casa por id y, si falla,
  por nombre normalizado.
- **ESPN y el play-in**: `season.type` 5. Entra como temporada regular
  al fit. El All-Star (ids de equipo inventados) se filtra por los 30
  ids reales.
- **Cierre del core API**: `close.total.value` a veces es el PRECIO
  (1.909), no la línea; la línea viene en `american` /
  `alternateDisplayValue` ("233.5"). El spread del local sale de
  `homeTeamOdds.close.pointSpread.american`.

## Mantenimiento en temporada

- **Nada manual a diario**: ratings, descanso, rotaciones y bajas se
  recalculan en cada request desde ESPN; el KV guarda los boxscores
  nuevos.
- **Cada 2-4 semanas**: `node scripts/nba-history.js 2027 --no-odds` y
  commit de `lib/nba/data/games-2027.json` + `player-games-2027.json`
  (el delta del KV vuelve a cero).
- **Registro de picks contra el cierre**: pendiente (ver abajo). Es la
  única forma de saber si la ventaja contra la apertura sobrevive con
  el reporte de lesiones real.
- **Playoffs** (abril-junio): el modelo corre igual (`seasontype` 3
  entra al aprendizaje con peso 0.8 en el fit); las rotaciones cortas y
  la localía mayor NO están modeladas aparte. Revisar antes de abril.
- **Créditos de momios**: tablero 3 créditos / 30 min perezosos
  (~1,500/mes si hubiera tráfico 24/7); props 6 por juego abierto / 4 h.
- **Pick gratis**: elegido por `lib/free-pick.js` (banda 58-86%, sin
  partidazo: lista de taquilleros `nba` en `TAQUILLEROS`, agregar
  Lakers/Celtics/Warriors/Knicks/Bulls si se quiere) entre los juegos de
  MAÑANA, clavado en el KV `nba-free-<día>`. Overrides en
  `lib/nba/featured.js`. El post diario de Instagram ya tiene la liga
  (`lib/ig/plan.js`, con lámina de props): mientras esté en beta,
  `/api/nba-free` contesta 403 y la liga se salta sola.

## Qué se tocó al abrir al público (27-oct-2026)

`NBA_PUBLIC = true` en los tres endpoints; `upcoming` fuera de
`nba_mensual` / `nba_temporada` (USD 19.99 / 49.99; `anchor` de
`todo_mensual` a 8 × $349 = $2,792); `checkout.html` con los dos planes,
`nba` en `ALL_MODELS` y en el mapa de productos; tarjeta en
mis-modelos, pestaña en producto.html e index.html, enlace en las barras
de los otros modelos, "los ocho" en los banners; `TAQUILLEROS.nba`
(Lakers, Celtics, Warriors, Knicks, Bulls, Heat, Thunder). El post diario
de Instagram toma el pick de NBA solo desde ese día. Las pasarelas cobran
con `price_data` dinámico (no hay que dar de alta nada en Stripe ni en
Mercado Pago).

## Pendientes

- **Medir en producción**: registrar cada PICK con la línea del
  momento y compararlo con el cierre (CLV). Es la métrica que decide si
  el modelo aporta.
- **Props cuando falta un compañero**: hoy un titular ausente no sube
  los minutos ni el uso de los demás (solo cambia la expectativa del
  equipo). Es la mejora más clara para props.
- **Playoffs**: localía y rotaciones propias.
- **1ª mitad / 1er cuarto con momio real**: The Odds API los tiene por
  evento (`totals_h1`, `spreads_h1`, `totals_q1`), pero cuestan créditos
  por juego; evaluar cuando haya tráfico.
- **Minutos**: MAE 4.55; un modelo de minutos por partido (paliza
  esperada → menos minutos de los titulares) ayudaría a props de
  estrellas en juegos de -12.
