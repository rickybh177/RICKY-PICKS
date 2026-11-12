# MODELO NHL 2026-27

Modelo de predicción de la NHL integrado a Dattip, con el mismo formato
que el de NBA: ganador (con tiempo extra y penales), línea de gol ±1.5,
total de goles, resultado a 60 minutos (3 vías), totales por equipo y
1er periodo, con un **pick principal por partido** o un "este se deja
pasar" con su razón. Nació el 11-nov-2026 en **beta privada solo-admin**:
`/nhl.html` + `api/nhl-picks.js` / `api/nhl-free.js`; cualquiera que no
sea `rickybh17@gmail.com` recibe `403 { beta: true, league_id: 'nhl',
league_name: 'NHL' }`. Para abrirlo: `NHL_PUBLIC = true` en los dos
endpoints (ver "Cómo publicar").

Todo el modelo vive en el backend (`lib/nhl/`); el navegador recibe solo
probabilidades, líneas, veredictos y texto.

## Resumen honesto: qué tan bueno es contra el mercado

Backtest walk-forward (ratings y dispersión ajustados solo con
temporadas anteriores; cada juego se predice antes de aprender su
resultado), medido contra la línea de **cierre** que guarda ESPN (ESPN
BET en 2024-25, DraftKings desde 2025-26):

| Ganador (con tiempo extra) | Juegos | Brier modelo | Brier cierre | Log-loss modelo | Log-loss cierre | Localía pura (Brier) |
|---|---|---|---|---|---|---|
| 2024-25 | 1,312 | 0.2352 | **0.2331** | 0.6626 | **0.6582** | 0.2461 |
| 2025-26 | 1,312 | **0.2429** | 0.2444 | **0.6784** | 0.6817 | 0.2495 |
| 2026-27 (al 10-nov) | 284 | 0.2285 | **0.2249** | 0.6485 | **0.6409** | 0.2460 |
| Las tres juntas | 2,908 | 0.2380 | **0.2374** | | | |

| Otros mercados (Brier en la línea de cierre) | Modelo | Cierre |
|---|---|---|
| Línea de gol ±1.5 · 2024-25 / 2025-26 / 2026-27 | 0.2384 / **0.2145** / 0.2294 | **0.2372** / 0.2155 / **0.2270** |
| Total · 2024-25 / 2025-26 / 2026-27 | 0.2497 / 0.2514 / 0.2520 | **0.2491** / **0.2489** / **0.2484** |
| MAE del total (goles) · 2024-25 / 2025-26 | 1.879 / 1.835 | 1.898 / 1.846 (contra la línea) |

- **El modelo NO le gana al cierre de forma demostrable.** Queda a un
  pelo: gana una temporada de tres (2025-26) y pierde las otras dos; en
  conjunto el cierre es mejor por 0.0006 de Brier. La mezcla óptima
  modelo/cierre pone 85% de peso al modelo en 2025-26, 20% en 2024-25 y
  0% en lo que va de 2026-27: ruido de temporada a temporada.
- **En totales el mercado es mejor las tres veces.** El modelo deja un
  sesgo de +0.07 a +0.13 goles (se queda corto) y su lado más probable
  acierta 49-54%. Por eso el total pide más ventaja para ser PICK y no
  puede ser promovido a pick principal.
- **Sí anticipa a la apertura.** Cuando el modelo discrepa del
  moneyline de APERTURA, la línea se mueve hacia el modelo **60-71% de
  las veces** en general y **76-90% cuando discrepa ≥8 puntos de
  probabilidad** (CLV medio +0.8 a +1.3 puntos de probabilidad). Es la
  misma señal que NBA: el modelo lleva información que el mercado
  incorpora después, sobre todo el volumen de tiro reciente.
- **Regla del sitio a precios de cierre** (pick principal por partido,
  unidad plana): 2024-25 **59% de los partidos con pick, ROI +5.4%**
  (n=769); 2025-26 **48%, +3.6%** (n=636); 2026-27 **39%, +2.2%**
  (n=110). Positivo las tres veces, pero con momios de no favorito el
  error estándar del ROI es de ±4-5% por temporada: **no es una ventaja
  demostrada**, es "no sangra". El pick "por probabilidad" (el favorito
  claro sin ventaja de precio) acierta 57-70% y solo deja lo que paga
  (ROI −9.6%, −2.8% y +7.0%): se dice tal cual en la tarjeta.
- **Referencia a ciegas**: apostar siempre al no favorito al cierre deja
  +1.8%, −6.7% y −16.6% en las mismas tres muestras, así que el
  resultado de la regla no es solo "jugar al que paga más".
- **Calibración del ganador** (favorito, predicho → real, 2025-26 /
  2024-25): 52→50 / 52→54, 57→51 / 57→58, 62→61 / 62→63, 67→65 / 67→72,
  72→74 / 72→86. Bien en promedio; cada temporada se va un poco para un
  lado (la localía real fue 52.2% en 2025-26 y 56.3% en 2024-25).

Conclusión para el producto: el tablero de NHL se lee como **una
segunda opinión bien calibrada, afinada por tiros, descanso y portero**,
no como una máquina de vencer al cierre. Los veredictos encogen 50%
hacia el mercado, el total queda con la barra más alta y hay guardián
de divergencia. La única forma de saber si la ventaja contra la
apertura sobrevive es registrar cada pick con el precio del momento y
compararlo con el cierre.

## Fuentes

- **ESPN** (sin key, espejo `site.web.api.espn.com` + UA de navegador,
  igual que NBA/NFL; el host clásico da 403 desde datacenter):
  `scoreboard?dates=YYYYMMDD` (resultados, goles por periodo —así se
  separa el tiempo reglamentario del tiempo extra y los penales— y el
  **portero probable** de cada equipo), `summary?event=ID` (boxscore:
  tiros a puerta, fallados y bloqueados, power play, porteros con tiros
  recibidos y goles, y la jugada por jugada, de donde salen los **goles
  a puerta vacía**) y el core API `…/competitions/ID/odds` (moneyline,
  línea de gol y total de **apertura y cierre** por casa).
- **The Odds API** (única fuente de momios en vivo,
  `lib/odds/theoddsapi.js`): sport key `icehockey_nhl`,
  `h2h,spreads,totals` (3 créditos por consulta, TTL general de 30 min,
  caché en dos niveles). No se tocó `lib/odds/theoddsapi.js`.

## Cómo funciona

### Modelo de equipo (`lib/nhl/core.js`, `engine.js`, `model.js`)

```
λ_local  = exp(mu + muShift + hfa/2 + att[h] − def[a] + adj_h)
λ_visita = exp(mu + muShift − hfa/2 + att[a] − def[h] + adj_a)
```

λ = goles esperados en **tiempo reglamentario y sin puerta vacía**
("goles limpios"). `att`/`def` en escala log vs promedio (def positivo =
concede menos). `adj` = segundo juego en dos noches y portero titular.

1. **Priors** (`lib/nhl/priors.js`, GENERADO por
   `scripts/build-nhl-priors.js`, no editar a mano): ratings ajustados
   por rival (`lib/nhl/fit.js`: máxima verosimilitud Poisson por ajuste
   proporcional iterativo, mu y localía en forma cerrada, 10
   pseudo-juegos de encogimiento) sobre 2022-23 → 2025-26 (5,592 juegos,
   half-life 300 días, playoffs ×0.8), regresados a la media con
   **carry 0.8**. Liga 2026-27: 2.78 goles limpios por equipo, localía
   0.037 log (≈ +3.7% de goles para el local, 52-53% de victorias),
   conversión 0.0986 goles por tiro a puerta.
2. **Aprendizaje en línea**: cada resultado de la 2026-27 corrige
   att/def con K=0.025 × sorpresa (capada a 3 goles). El objetivo NO son
   los goles tal cual: **70% son los goles "merecidos" por tiros a
   puerta** (tiros × conversión vigente de liga) y 30% los goles reales
   sin puerta vacía. Es la calibración que más pesa (ver abajo). Más
   muShift (entorno goleador, encogido n/(n+150), tope ±8%).
3. **Segundo juego en dos noches** (`PARAMS.REST`, medido en 1,093
   equipo-juegos): el equipo cansado mete **−3.7%** y concede **+4.1%**.
   En vivo se mira el calendario, no solo los juegos terminados: el
   juego de hoy ya cansa al equipo para el de mañana.
4. **Portero** (`GOALIES`, `TEAM_REF`): cada portero lleva sus tiros
   recibidos y goles evitados sobre el promedio (decaídos ×0.6 entre
   temporadas), encogidos con 1,500 tiros. Lo que cuenta es la
   DIFERENCIA contra la mezcla de porteros con la que el equipo ganó su
   rating defensivo (promedio móvil), con peso 0.75 y tope de ±0.012
   goles por tiro. Hoy sale del `probables` del scoreboard de ESPN
   ("Confirmed" pesa 1, "Expected" 0.7).
5. **Motor en forma cerrada** (`engine.js`), determinista: matriz
   Poisson de goles limpios con tres correcciones de hockey medidas
   fuera de muestra (`DISP`, 3,936 juegos):
   - **pesos por diferencia de goles** (`MARGIN_W` 1.35 / 1.06 / 0.87 /
     0.83 para diferencia 0 / 1 / 2 / 3+): hay 22% de empates a 60
     minutos y dos Poisson independientes dan 17%. La matriz se
     re-escala para conservar exactamente los goles esperados.
   - **puerta vacía** (`EN`): con el rival abajo por 1 el líder mete un
     gol a puerta vacía 39.5% de las veces (dos, 8%); abajo por 2,
     65%; por 3, 33%. Por eso en la NHL hay más victorias por 3 que por
     1 y los totales impares son más comunes.
   - **tiempo extra y penales**: el empate a 60 se reparte casi a
     volado (`OT_S` 0.48 de la ventaja del mejor equipo, `OT_HOME`
     +1.7%); quien gana ahí gana por UN gol y el total sube uno. El
     ganador, la línea de gol, el total y los totales por equipo se
     calculan sobre ese marcador FINAL; "60 minutos" sobre la matriz
     reglamentaria.
   - 1er periodo: Poisson con 31.6% de los goles limpios.
   Líneas enteras devuelven el push como la casa.
6. **Veredictos y pick principal** (`lib/nhl/verdicts.js`, función pura
   que comparten el sitio y el backtest). De cada mercado con precio
   entran los DOS lados (en hockey el valor suele estar del lado que no
   es favorito). EV sobre la prob encogida **50%** hacia el devig del
   consenso; PICK con EV ≥ 4% (ganador y línea de gol) o ≥ 6% (total),
   MAYBE ≥ 1.5%, piso 30% / 25% / 30%. Si ninguno llega a PICK se
   promueve el de mejor EV (≥ 1%) entre ganador y línea de gol; si no,
   el ganador cuando el modelo lo ve ≥ 57% y el precio no paga más de 3%
   de menos ("lo más probable; el precio es justo"); si no, "se deja
   pasar" con su razón y hacia dónde se inclina el modelo. Guardián:
   ganador del modelo a ≥ 15 puntos del mercado → nunca PICK. Sin momios
   solo el ganador da PICK (≥ 57%). "60 minutos" lleva EV contra las
   casas de 3 vías pero tope MAYBE (no hay cierres históricos de ese
   mercado para validarlo); totales por equipo y 1er periodo, lectura.
7. **Juegos que ya empezaron**: se congela lo último que dijo el modelo
   antes del inicio (foto por día en el KV `nhl-snap-<día>`), igual que
   NBA.

### Estado de la temporada (`lib/nhl/season.js`)

Dos capas, como NBA: la **estática** (`lib/nhl/data/games-2027.json`,
generada por `scripts/nhl-history.js 2027`) y el **delta en el KV**
(`nhl-season-2027-delta`): cada request completa los juegos terminados
desde el último guardado (máximo 40 boxscores por request). Un juego
sin boxscore todavía no se guarda: se reintenta en la siguiente corrida.

## Cómo correr

```bash
node scripts/nhl-history.js 2023 2024 2025 2026   # histórico (caché en tmp o NHL_CACHE_DIR; ~3 min la primera vez)
node scripts/nhl-history.js 2027                  # temporada en curso → lib/nhl/data/games-2027.json
node scripts/nhl-backtest.js                      # walk-forward 2025-26 (grids, cierre, apertura, pick principal)
node scripts/nhl-backtest.js --fold 2025          # pliegue 2024-25
node scripts/nhl-backtest.js --fold 2027 --quick  # lo que va de la 2026-27 con los priors de producción
node scripts/nhl-backtest.js --quick --set K=0.03,SHOTS_W=0.8   # probar otra combinación
node scripts/build-nhl-priors.js > lib/nhl/priors.js
PORT=3111 node dev-server.js                      # /nhl.html · ?as=guest · ?as=beta
```

Los parámetros de producción viven en `scripts/nhl-params.js` (los leen
el backtest y `build-nhl-priors`); `scripts/nhl-common.js` tiene lo
compartido (carga, descanso, dispersión).

## Calibraciones no obvias

- **Tiros en el objetivo (lo que más pesa)**. Aprendiendo solo de goles
  el modelo apenas le gana a la localía pura; con 65-80% de peso a los
  tiros a puerta baja a su mejor Brier en los dos pliegues (2025-26:
  w=0 → 0.2522, 0.5 → 0.2442, 0.65 → 0.2431, 0.8 → 0.2428, 1 → 0.2437;
  2024-25: 0.2424 / 0.2361 / 0.2353 / 0.2352 / 0.2362). El porcentaje
  de tiro de un partido es casi puro ruido. Se dejó 0.7. Fenwick (+
  fallados) y Corsi (+ bloqueados) no mejoran de forma consistente: se
  queda con tiros a puerta, que además es el dato más simple.
- **Conversión vigente**. Los tiros por juego bajaron de 31.2 a 27.8 en
  tres temporadas con los goles iguales; con la conversión histórica
  fija los goles "merecidos" salían cortos y el sesgo del total subía a
  +0.25. Se re-estima con lo que va de la temporada, anclada con 3,000
  tiros.
- **K 0.025**: 0 → 0.2491, 0.01 → 0.2438, 0.02 → 0.2430, 0.03 → 0.2430,
  0.045 → 0.2436 (2025-26).
- **Carry y half-life: planos** (carry 0.5 → 1.0: 0.2428-0.2430;
  half-life 200-700 días: idéntico a la cuarta decimal). El aprendizaje
  en línea domina después de 15-20 juegos.
- **Puerta vacía fuera del objetivo**: 0.2435 → 0.2429. Chico pero
  consistente, y el motor lo necesita para modelarla aparte.
- **Motor por piezas** (2025-26, log-loss del resultado a 60 minutos):
  Poisson independiente 1.0813 → con pesos por diferencia 1.0640 → con
  puerta vacía aparte 1.0637 (Brier del ganador 0.2432 → 0.2429). Los
  pesos son los que arreglan el empate; la puerta vacía, la línea de gol
  y el total.
- **Segundo juego en dos noches**: 0.2435 → 0.2429 (2025-26) y 0.2363 →
  0.2352 (2024-25). Sí ayuda.
- **Portero: ayuda poco, y el número es un techo.** Peso 0 → 0.2431 /
  0.2357; 0.5 → 0.2429 / 0.2353; 1 → 0.2430 / 0.2352; 2 → 0.2438 /
  0.2357. El backtest conoce al titular real; en producción sale del
  probable de ESPN. El encogimiento (800-5,000 tiros) es plano.
- **OJO con el portero "que más jugó"**: la primera versión tomaba como
  titular al de más minutos y el portero parecía valer el triple. Era
  fuga de datos: cuando al titular lo sacan por goleada, el suplente
  acaba con más minutos y delata el resultado. Ahora el titular es el
  que marca el scoreboard (80 de 2,788 equipo-juegos de 2025-26 difieren).
- **muShift** no mueve nada (como en NBA); se deja por consistencia.
- **El tiempo extra cambia mucho de un año a otro**: 20.7% de los juegos
  en 2023-24 y 2024-25, 24.8% en 2025-26. Es la mayor fuente del sesgo
  del total y de la calibración del empate (21% predicho → 25% real en
  2025-26; 22% → 19.6% en 2024-25). No hay cómo anticiparlo.
- **Regla del pick principal** (cierre, 2025-26 / 2024-25 / 2026-27):
  producción 48% con pick y +3.6% / 59% y +5.4% / 39% y +2.2%. Blend
  0.3 da más picks y peor ROI (+1.5 / +2.1 / −5.8); blend 0.65, menos
  picks sin mejorar; meter el total a la promoción lo empeora (+1.5 /
  +4.9 / −8.9); `WIN_BAR` 0.60 deja 44% / 53% / 37% con +5.3 / +5.6 /
  +4.9. Se dejó 0.57 para que más partidos terminen con una conclusión;
  subirlo a 0.60 es la palanca si se prefiere menos picks.

## Cosas raras de ESPN y de The Odds API

- **Abreviaturas que cambian**: Utah sale como `UTAH` en `/teams` y en
  la 2024-25, y como `UTA` en el scoreboard desde 2025-26. La identidad
  del equipo se resuelve por `espnId` (`abbrOfId`). Arizona (id 24,
  2023-24) se trata como Utah para heredar su rating.
- **Torneos que no son NHL**: el 4 Nations (feb-2025) y similares
  aparecen en el scoreboard de NHL con `season.type` 2; se filtran por
  id de equipo.
- **Marcador con penales**: el ganador en penales lleva +1 en `score` y
  un quinto parcial con 1; los goles reglamentarios son la suma de los
  tres primeros `linescores`.
- **Cierres de 2022-23**: el core API trae el PRECIO en el campo de la
  línea (línea de gol "−120", total "105"). El parser descarta lo que no
  parezca una línea de hockey; esa temporada solo se usa para ajustar.
- **Apertura**: ESPN guarda moneyline y línea del total de apertura,
  pero no los precios del total ni de la línea de gol.
- **El `h2h` de hockey en la región europea mezcla dos mercados**: las
  casas de 2 vías pagan el ganador con tiempo extra; las de 3 vías
  (Unibet, Winamax, Betclic, Tipico…) traen "Draw" y pagan el resultado
  a 60 minutos. La mediana genérica las revuelve y sale un moneyline con
  los dos lados en positivo (y un EV inventado de +20%).
  `lib/nhl/odds.js` las separa casa por casa: ganador, línea de gol y
  total salen solo de las de 2 vías (6-10 casas por juego), y el `h2h`
  de las de 3 vías alimenta "60 minutos".

## Limitaciones

- **Sin lesiones ni alineaciones.** El modelo no sabe si falta la
  estrella; el guardián de divergencia y el encogimiento son la única
  defensa. Es la mejora más clara (ESPN publica `injuries` de NHL).
- **Portero probable**: "Expected" puede cambiar hasta el calentamiento.
- **Días pasados**: al navegar a un día anterior, la tarjeta se calcula
  con los ratings de hoy (ya aprendieron ese juego); el pick que se
  muestra sí es el congelado antes del inicio, si hubo foto.
- **Playoffs**: entran al aprendizaje como cualquier juego; el tiempo
  extra sin penales y la localía de series no están modelados aparte.
  Revisar antes de abril.
- **Totales por equipo, 1er periodo**: calibran (Brier 0.244 y 0.248)
  pero sin precio; son lectura.

## Mantenimiento en temporada

- **Nada manual a diario**: ratings, descanso y porteros se recalculan
  en cada request; el KV guarda los boxscores nuevos.
- **Cada 2-4 semanas**: `node scripts/nhl-history.js 2027` y commit de
  `lib/nhl/data/games-2027.json` (el delta del KV vuelve a cero), y
  `node scripts/nhl-backtest.js --fold 2027 --quick` para ver cómo va
  contra el cierre.
- **Créditos de momios**: 3 por consulta, TTL 30 min, perezoso. Si hace
  falta ahorrar, agregar `icehockey_nhl: 60` a `SPORT_TTL_MIN`.
- **Pick gratis**: lo elige `lib/free-pick.js` (banda 58-86%) entre los
  juegos de mañana, clavado en el KV `nhl-free-<día>`. Overrides en
  `lib/nhl/featured.js`. No hay lista de taquilleros `nhl` en
  `TAQUILLEROS`; agregarla si se quiere proteger algún partidazo.

## Cómo publicar

1. `NHL_PUBLIC = true` en `api/nhl-picks.js` y `api/nhl-free.js`.
2. Quitar `upcoming` de los planes `nhl_*` en `lib/plans.js` y sacar
   `nhl` de `BETA_PRODUCTS`; revisar `checkout.html`, `producto.html`,
   `mis-modelos.html` y las barras de modelos de las otras páginas.
3. Quitar `noindex` de `public/nhl.html` si se quiere indexar y sumarla
   al `sitemap.xml`.
4. Regenerar `lib/nhl/data/games-2027.json` ese día.

## Pendientes

- **Medir en producción**: registrar cada PICK con el precio del momento
  y compararlo con el cierre (CLV).
- **Lesiones** de ESPN traducidas a goles (receta de NBA).
- **Momios de 60 minutos** con historial, para poder validar ese
  mercado y quitarle el tope.
- **1er periodo y totales por equipo con momio real** (por evento en The
  Odds API; cuestan créditos por juego).
