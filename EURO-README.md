# MODELOS DE EUROPA — Premier League, LaLiga, Bundesliga y Champions League 2026-27 (beta privada)

Tres modelos de predicción de fútbol europeo integrados al sitio
RICKY·PICKS, uno por liga y **completamente independientes entre sí**
(cada liga tiene sus priors, su calibración, su producto y su
entitlement). Lanzados en beta privada solo-admin, mismo esquema que
tuvo Liga MX: `/europa.html?liga=epl|laliga|bundesliga` +
`api/euro-picks.js` / `api/euro-free.js` con candado server-side.
Mientras una liga no esté en `PUBLIC_LEAGUES`, cualquiera que no sea
`rickybh17@gmail.com` recibe `403 { beta: true }` y la página muestra
"Beta privada — muy pronto".

Serie A (`ita.1`) y Ligue 1 (`fra.1`) ya están en el catálogo con
`enabled: false`: plantillas cargadas, sin priors ni endpoint. Ver
"Cómo agregar Serie A / Ligue 1".

## Cómo funciona

Mismo motor que Liga MX, generalizado por liga. **No es Monte Carlo**:
matriz exacta de marcadores **Dixon-Coles** (Poisson bivariado con
corrección de marcadores bajos), cada mercado derivado analíticamente
de la matriz — cero varianza de simulación, picks deterministas entre
recargas. El motor (`lib/mx/engine.js`: `dcMatrix`,
`marketsFromMatrix`, `firstHalfMarkets`, `cornersMarkets`, `ahCover`,
`overProb`, `devig`…) es agnóstico de liga y se reutiliza tal cual;
`lib/mx/*` no se tocó.

Modelo por partido (sin altitud — es Europa):

```
λ_local  = exp(mu + hfa + att[local] + def[visita])
λ_visita = exp(mu +       att[visita] + def[local])
```

`att` = fuerza ofensiva, `def` = DEBILIDAD defensiva (positivo =
concede más). **Todo indexado por id de equipo de ESPN como string**
(`"364"` = Liverpool), nunca por abreviatura: en Europa suben y bajan
3 equipos por año, ESPN cambia abreviaturas entre temporadas (Man City
fue `MCI` y hoy es `MNC`) y las repite entre ligas (`MUN` es Bayern en
`ger.1` y Man United en `eng.1`). Ratings, priors, córneres y momios
usan el id; la abreviatura es solo para mostrar.

1. **Priors** (`lib/euro/priors/<liga>.js`, GENERADOS — no editar a
   mano): ataque/defensa por equipo ajustados sobre cuatro temporadas
   (2022-23 → 2025-26: 1,520 partidos en Premier y LaLiga, 1,224 en
   Bundesliga) con decaimiento temporal (`halfLife` por liga: 365 días
   en Premier, 500 en LaLiga y Bundesliga), vía
   `scripts/build-euro-priors.js`. Ajusta también `mu` (nivel goleador),
   `hfa` (localía) y `rho` (Dixon-Coles). Los **ascendidos sin
   historia** en la ventana entran con el **ancla de ascendido**, que
   sale de los datos: el promedio de att/def de los equipos que
   aparecieron por primera vez después de la primera temporada de la
   ventana (5 en Premier, 6 en LaLiga, 5 en Bundesliga); respaldo
   `{att: -0.25, def: 0.15}` si no hubiera ninguno.
2. **Aprendizaje en línea** (`lib/euro/core.js`, orquestado por
   `lib/euro/model.js`): cada resultado de 2026-27 actualiza los ratings
   (paso de gradiente Poisson, `sgdK` por liga, sorpresa capada a
   `sgdCap` 2.2 goles) + una corrección global del entorno goleador
   (`muShift`: encogida con n/(n+80), tope ±0.08, 8 pseudo-goles para
   que un 0-0 temprano no mueva la liga entera). Cero mantenimiento
   manual: el runtime lee `getSeasonResults` desde `seasonStart`
   (2026-08-01) y repite el ciclo completo en cada request.
3. **Mercados**: 1X2, doble oportunidad, empate no vale, O/U 1.5/2.5/3.5,
   ambos anotan, totales por equipo, portería en cero, marcador exacto,
   1ª mitad, córneres (priors de 2025-26 mezclados con hasta 40
   summaries de la temporada en curso) y hándicap asiático si el
   mercado trae spread (el consenso h2h/totals no lo trae; queda
   listo).
4. **Veredictos BET/MAYBE/SKIP**: con momios reales (consenso
   multi-casas de The Odds API) el 1X2 y el total se deciden por **EV**
   sobre una probabilidad encogida hacia el mercado (`mktBlend` 0.45) y
   con un piso de probabilidad (`x2Floor` 0.35 en el 1X2, 0.30 en
   totales). Sin momios publicados el veredicto se topa en MAYBE (no
   hay precio que ganar). Doble oportunidad y ambos anotan van por
   **barras calibradas** en el backtest (`dcBet/dcMaybe`,
   `bttsBet/bttsMaybe`), distintas por liga. Todas las barras viven en
   `CAL` dentro del archivo de priors, nunca en el código.
5. **Ajustes por partido**: descanso corto (menos de 4.5 días desde el
   último juego DE LIGA → ×0.97 en goles esperados) y aviso de "recién
   ascendido" en el análisis. Las lambdas se topan a [0.15, 4.2].

### `core.js`: un solo ciclo para backtest y producción

Ese es el cambio de arquitectura respecto a Liga MX. `lib/euro/core.js`
son funciones puras (sin I/O): `lambdas`, `sgdUpdate`, `muShiftStep`,
`replayResults`, `currentRatings`, `restInfo`, `clampLambda`,
`blendTarget`, y el EV contra el mercado (`evVerdict`, `ev1x2`,
`bestValueIndex`, `evTotal`, `evBars`). **`scripts/euro-backtest.js` y
`lib/euro/model.js` importan de ahí las mismas funciones**: lo que se
mide en el backtest es exactamente lo que corre en producción, no hay
dos copias de la fórmula que puedan divergir en silencio. Si hay que
cambiar cómo aprende el modelo, se cambia en `core.js` y se vuelve a
correr el backtest. `DEFAULT_CAL` (los valores que se hornean cuando el
script no recibe banderas) también vive ahí.

`replayResults(results, priors, LG, cal, onPredict)` recorre los
resultados en orden cronológico y por cada juego: (1) arma la liga con
el `muShift` vigente, (2) llama `onPredict` — el backtest registra ahí
su predicción ANTES de ver el marcador —, (3) `muShiftStep` con los
goles reales, (4) `sgdUpdate`. Juegos con un equipo que no está en los
priors se saltan (no se inventan ratings a media temporada).

### Fit (`lib/euro/fit.js`, solo scripts, nunca en runtime)

Generaliza `lib/mx/fit.js`: sin altitud, equipos por id, sin liguilla.
Dos pasos:

1. `att/def` por Fisher scoring (Newton amortiguado) sobre la
   log-verosimilitud Poisson ponderada por recencia
   (`gameWeight` = 0.5^(días/halfLife)), con regularización de 8
   pseudo-partidos hacia el ancla y **`mu` y `hfa` en forma cerrada en
   cada iteración** — la lección de Liga MX: moverlos por gradiente
   junto con att/def diverge por colinealidad. att y def se centran en
   0 tras cada iteración (el nivel vive en `mu`); la convergencia se
   mide DESPUÉS de centrar porque con ascendidos anclados a un valor
   distinto de 0 el paso crudo nunca baja de ~1e-3 (Bundesliga con
   Hertha/Schalke 22-23).
2. `rho` por búsqueda en malla [−0.20, 0.08] sobre la verosimilitud DC
   completa con las lambdas fijas — siempre con goles REALES.

Objetivo por lado con `shotsW` en [0,1]: si el juego trae estadística,
`(1−shotsW)·goles + shotsW·min(goles+2.5, sot·conversión)`; sin ella,
goles. Las tres ligas quedaron en `shotsW 0` (ver validación), pero la
`conversion` (goles por tiro a puerta, 0.31–0.35) se reporta en
`LEAGUE` por si algún día se activa. Equipos con menos de 3 partidos de
peso se anclan como ascendidos (`low_evidence_ids` en `diag`).

### Runtime (`lib/euro/model.js` → `buildBoard(leagueId)`)

En paralelo: `getWindow` (cartelera), `getSeasonResults` (aprendizaje)
y `getSoccerOdds` (consenso). Luego `core.currentRatings` → córneres
(`cornerRates`, 6 summaries a la vez, tope 40) → por partido: descanso,
lambdas, matriz, mercados, EV/barras, análisis en español, `strength`
(la probabilidad del mejor BET). Devuelve el mismo payload que
`lib/mx/model.js` más `league_id`, `league_name`, `league_flag`,
`season_label`, `rounds` y `ev_params` (`blend` + barras/pisos de
`x2`, `total`, `btts`) para que la página replique el EV con los
momios del usuario sin copiar constantes. La jornada se ESTIMA
(mediana de juegos por equipo + 1, topada a `rounds`): no viene en el
API y cambia a media ronda.

**Coeficientes y ratings nunca salen del servidor.** Los archivos de
priors se cargan con requires estáticos (no template string) para que
el empaquetador de Vercel los meta al bundle del lambda.

## Datos

### ESPN (gratis, sin key)

`lib/euro/data.js` pega a `site.web.api.espn.com/apis/site/v2/sports/soccer/<código>/…`
con User-Agent de Chrome + Referer; el host clásico
`site.api.espn.com` regresa 403 desde datacenters (Vercel) y queda solo
como último intento de respaldo. Códigos: `eng.1`, `esp.1`, `ger.1`
(`ita.1`, `fra.1` apagadas).

- **Scoreboard** `?dates=YYYYMMDD-YYYYMMDD&limit=200` en pedazos
  MENSUALES (`getRangeChunked`; un mes de liga europea cabe de sobra).
  De cada evento: `season.{year,slug}` (year 2026 = temporada 2026-27),
  sede y ciudad, marcador, forma (WLDDL), récord, momios DraftKings
  (solo juegos por venir; ya no se usan para veredictos, ver Momios) y
  estado. `parseEvent` regresa `home.id` / `away.id` como string.
- **Summary** `?event=ID` → `boxscore.teams[].statistics`:
  `totalShots`, `shotsOnTarget`, `wonCorners`, `possessionPct`.
  `getMatchStats` cachea solo lo parseado (el JSON completo pesa
  cientos de KB); 24 h con stats, 1 h sin ellas (puede ser un juego en
  curso). `fetchJson(url, 0)` = sin caché en memoria.
- **Ventana visible** (`getWindow`): ayer → +9 días. Si la liga está en
  pausa (fecha FIFA, receso de invierno) y no hay ningún partido por
  jugar en la ventana, se extiende hasta la PRÓXIMA jornada completa
  (mira 60 días adelante, toma 5 días desde el primer juego por
  venir) — la lección de Liga MX del 4-ago-2026. Copia literal de
  `lib/mx/data.js`; no se ejercitó en vivo porque las tres ligas
  tenían juegos en la ventana.
- **Caché in-memory**: 5 min para rangos con futuro, 24 h para rangos
  ya pasados (más de 36 h atrás).

### Catálogo (`lib/euro/leagues.js`)

`LEAGUES` (config por liga: código ESPN, sport key de momios, equipos,
jornadas, `seasonLabel`, `seasonStart`, `histStart`/`histEnd`,
`enabled`) y `TEAMS` (plantillas 2026-27 por id: `abbr`, `name` =
`shortDisplayName` de ESPN, `full`, `city`). Premier 20, LaLiga 20,
Bundesliga 18 (Serie A 20 y Ligue 1 18 cargadas aunque apagadas).
`logoUrl(id)` = `https://a.espncdn.com/i/teamlogos/soccer/500/<id>.png`.
`city` viene de la sede de sus partidos de local (ESPN `/teams` no trae
estadio) y es solo cosmética. La bandera de Inglaterra está escrita
como secuencia de escapes Unicode (7 code points) para que ningún
editor la rompa.

### Histórico para scripts (`scripts/euro-history.js`)

`getHistory(leagueId, { withStats })` baja temporadas completas
(1-jul → 30-jun) y cachea en disco, por liga + temporada, en
`os.tmpdir()/ricky-euro-history`:

```
<liga>-<año>.json            juegos terminados (año = ESPN season.year)
stats/<liga>/<evento>.json   summary parseado (o { missing: true })
fd-<temp>-<div>.csv          cierres de football-data (solo backtest)
```

Las temporadas pasadas no se vuelven a pedir; la temporada en curso se
refresca si el archivo tiene más de 6 h. Con `--stats` baja los
summaries (8 a la vez, reintentos y pausa de 15 s tras 10 fallos
seguidos); la primera descarga completa tardó ~10 min para 4,337
summaries. Filtro anti-fuga por `season.slug`
(`2024-25-laliga`, `2022-23-german-bundesliga`…). Rescate
`stuckButPlayed`: partidos de hace más de 7 días que ESPN dejó como
"Scheduled" pero ya traen marcador entero distinto de 0-0 cuentan como
jugados (sin stats). Estado hoy (5-sep-2026):

| Liga | 22-23 | 23-24 | 24-25 | 25-26 | 26-27 (en curso) | Ascendidos sin historia |
|---|---|---|---|---|---|---|
| Premier | 380 | 380 | 380 | 380 | 28 | Hull, Coventry |
| LaLiga | 380 (5 rescatados) | 380 | 380 | 380 | 34 | Racing, Deportivo, Málaga |
| Bundesliga | 306 | 306 | 306 | 306 | 16 | Paderborn, Elversberg |

CLI: `node scripts/euro-history.js <epl|laliga|bundesliga|all> [--stats]`
imprime juegos y equipos por temporada, descartados por slug,
rescatados, cobertura de summaries y la lista de ascendidos.

También baja los **cierres de football-data.co.uk** (`getClosingOdds`,
CSV por liga y temporada: `E0`, `SP1`, `D1`) para que el backtest mida
los veredictos con EV contra precios reales: fuente `avg` (promedio de
casas, lo más parecido al consenso del runtime), `pinnacle` o `b365`.
Ojo con el host: `www.football-data.co.uk` contesta 503; el dominio
pelado sirve los CSV.

### Momios: The Odds API (única fuente, presupuesto compartido)

`lib/odds/theoddsapi.js` → `getSoccerOdds(sportKey, nameToId)` +
`findSoccerOdds(list, homeId, awayId, dateISO)` (±36 h). Sport keys:
`soccer_epl`, `soccer_spain_la_liga`, `soccer_germany_bundesliga`
(`soccer_italy_serie_a`, `soccer_france_ligue_one` listos). Consenso
por outcome = mediana de probabilidades implícitas de todas las casas
(sin exchanges), `regions=eu`, `markets=h2h,totals`. La línea de
totales de consenso es la que MÁS casas ofrecen: en Europa las casas se
reparten entre 2.5 y 3.5 en el mismo partido y sin esto el EV del
total se calculaba contra un precio que no existe.

- **Créditos**: plan de 20,000/mes compartido entre TODOS los deportes;
  cada request de fútbol cuesta 2 créditos. Las ligas europeas tienen
  **TTL de 60 min** (`SPORT_TTL_MIN`; los demás deportes 30): las tres
  juntas gastan ~4.3K créditos/mes en el peor caso de tráfico 24/7 (en
  vez de ~8.6K con 30 min), y como el fetch es perezoso (solo al haber
  visitas) el consumo real queda muy abajo. Con menos de 2,000 créditos
  restantes el TTL se multiplica ×8. Caché en dos niveles: memoria del
  lambda + bucket `odds-cache` de Supabase Storage (sobrevive cold
  starts). **Nunca llamar a `fetchSport` en loops ni en pruebas más de
  una vez por liga.**
- **Solo pre-partido** (`isPreGame`): en cuanto arranca el juego las
  casas pasan a precios en vivo y el consenso lo excluye → el veredicto
  se queda sin precio y se topa en MAYBE.
- **Nombres → id** (`lib/euro/oddsnames.js`): The Odds API publica
  "Brighton and Hove Albion", "Real Racing Club de Santander",
  "1. FC Köln"; `NAMES` mapea cada nombre visto en vivo el 5-sep-2026
  (los 58 equipos) más alias, y hay un respaldo por normalización
  contra `TEAMS` (sin acentos ni siglas de club). Un nombre nuevo sin
  match se avisa UNA vez en el log y el partido queda sin momios; nunca
  se adivina entre dos. Cobertura en la primera corrida: 12/12 Premier,
  16/16 LaLiga, 11/11 Bundesliga.
- Sin `ODDS_API_KEY`: `odds_source` null y todos los veredictos con
  precio se topan en MAYBE.

## Validación (`scripts/euro-backtest.js`)

```
node scripts/euro-backtest.js <liga> --season 2025-26|2024-25
  [--K 0,0.025,0.035] [--halfLife 365,500] [--shotsW 0,0.3] [--noMuShift]
  [--mktBlend 0.22,0.3,0.45] [--x2Floor 0.2,0.35] [--book avg|pinnacle|b365]
  [--noOdds] [--json salida.json]
```

Walk-forward honesto: ajusta SOLO con partidos anteriores al primer
juego de la temporada de prueba (`asOf` = ese día menos uno), luego
predice → registra → aprende juego por juego con el `replayResults` de
`core.js`. Base de liga = frecuencias del set de ajuste. Reporta Brier /
log-loss / RPS del 1X2, calibración del favorito por decil, O/U 2.5,
BTTS, seguros de doble oportunidad a 0.72/0.76/0.80/0.84 (más la barra
de CAL), marcador exacto top-1, cordura sin mercado (total y % local
predichos vs reales) y `muShift` al cierre. Cada halfLife × shotsW es
un ajuste nuevo; cada K una pasada. Correrlo ANTES de desplegar
cambios en `core.js` / `fit.js` y comparar.

### epl

Walk-forward honesto: ajuste solo con partidos anteriores a la temporada de prueba (asOf = un día antes del primer juego); después predice → registra → aprende juego por juego con el mismo `replayResults` del runtime. Malla: K ∈ {0, 0.015, 0.025, 0.035, 0.05} × halfLife ∈ {200, 300, 365, 500} × shotsW ∈ {0, 0.25, 0.5} × muShift on/off, sobre 2024-25 y 2025-26 (380 juegos cada una, 240 pasadas). Selección por log-loss promedio de las dos temporadas, desempate por RPS, con prueba pareada por juego para no confundir ruido con señal.

| Métrica | 2024-25 | 2025-26 |
|---|---|---|
| Ajuste / prueba | 760 / 380 (asOf 2024-08-15) | 1140 / 380 (asOf 2025-08-14) |
| Brier 1X2 (base liga) | 0.5895 (0.6595) | 0.6188 (0.6563) |
| Log-loss 1X2 (base) | 0.9869 (1.0860) | 1.0294 (1.0845) |
| RPS (base) | 0.2031 (0.2371) | 0.2093 (0.2278) |
| Skill Brier | 10.6 % | 5.7 % |
| Favorito acierta | 52.4 % | 46.8 % |
| Seguros DC ≥ 0.72 | 202/244 = 82.8 % | 167/203 = 82.3 % |
| Seguros DC ≥ 0.76 | 149/172 = 86.6 % | 120/145 = 82.8 % |
| O/U 2.5: Brier · over pred / real | 0.2446 · 56.1 / 56.6 % | 0.2566 · 52.7 / 55.0 % |
| BTTS: Brier · sí pred / real | 0.2476 · 54.8 / 57.4 % | 0.2489 · 53.5 / 56.1 % |
| Marcador exacto top-1 | 11.3 % | 11.3 % |
| Total predicho / real | 2.955 / 2.934 | 2.798 / 2.750 |
| Local predicho / real | 45.4 / 40.8 % | 42.0 / 42.6 % |
| Empate predicho / real | 22.5 / 24.5 % | 23.9 / 27.4 % |
| muShift al cierre | −0.009 | −0.019 |

Calibración horneada en `lib/euro/priors/epl.js` (`node scripts/build-euro-priors.js epl --halfLife 365 --shotsW 0 --sgdK 0.025 --dcBet 0.72 --dcMaybe 0.66`):

- **halfLife 365** — empata con 500 (Δ 0.0001 de log-loss) y le gana a 200/300; se queda el default.
- **shotsW 0** — 0.25 mejora 2025-26 (−0.0025) pero empeora 2024-25 (+0.0017): no cumple la regla (≥ 0.002 y en ambas). En Premier los tiros a puerta no suman con este blend.
- **sgdK 0.025** — 0.035 gana 0.0004 en 1X2 (ruido, z = −0.3) pero pierde 0.002–0.003 de Brier en O/U y BTTS en las dos temporadas; K = 0 es claramente peor (+0.017, z = 2.9): aprender en temporada importa.
- **muShift on** (N 80, tope 0.08) — neutro con K > 0 (±0.0001), ayuda con K = 0; cierra en −0.01/−0.02 absorbiendo el pelo de goles de más que traen los priors.
- **dcBet 0.72 / dcMaybe 0.66** — barra más baja con ≥ 82 % en ambas temporadas; a esa barra la probabilidad media predicha es 0.80 y el acierto real 0.82–0.83, o sea calibrado. 0.76 es la alternativa conservadora (86.6 % / 82.8 %).
- **bttsBet 0.555 / bttsMaybe 0.535** — defaults; el modelo predice BTTS ~2.6 pp por debajo de lo real en ambas temporadas, así que las barras ya son conservadoras.

Lo que hay que saber: el 1X2 tiene skill claro (log-loss 0.99/1.03 vs base 1.09), pero O/U 2.5 y BTTS apenas empatan con la tasa base (Brier ≈ p(1−p)): el Poisson/DC acierta el total medio y aun así subestima P(over 2.5), porque la realidad tiene más varianza. 2025-26 fue temporada de empates (27.4 % vs 22–24 % histórico) y el favorito acertó solo 46.8 %; por eso el rho de los priors 2026-27 sale en −0.08 cuando en los dos walk-forward era ≈ 0 — ese valor no está validado fuera de muestra.

### laliga

Backtest walk-forward honesto: ajuste Dixon-Coles solo con partidos anteriores a la temporada de prueba; después predice → registra → aprende cada juego en orden con el MISMO ciclo de `lib/euro/core.js` que corre en producción. Base = frecuencias del set de ajuste. Barrido de 120 configuraciones (K × halfLife × shotsW × muShift) sobre las dos temporadas; se eligió minimizando el log-loss promedio y prefiriendo el default cuando la diferencia es ruido (< 0.001).

| Métrica | 2024-25 (380 j.) | 2025-26 (380 j.) |
|---|---|---|
| Brier 1X2 (base liga) | 0.5787 (0.6476) | 0.5816 (0.6318) |
| Log-loss 1X2 (base liga) | 0.9754 (1.0709) | 0.9800 (1.0489) |
| RPS (base liga) | 0.1958 (0.2287) | 0.2007 (0.2234) |
| Skill Brier | 10.6% | 7.9% |
| Favorito acierta | 52.9% | 52.6% |
| Seguros DC ≥0.76 (barra BET) | 152/179 = 84.9% | 131/158 = 82.9% |
| Seguros DC ≥0.84 | 71/77 = 92.2% | 54/61 = 88.5% |
| O/U 2.5: Brier · over pred / real | 0.2420 · 46.6% / 48.7% | 0.2455 · 47.9% / 50.0% |
| BTTS: Brier · sí pred / real | 0.2487 · 47.3% / 54.2% | 0.2490 · 48.5% / 56.6% |
| Marcador exacto top-1 | 14.5% | 15.5% |
| Total de goles pred / real | 2.567 / 2.618 | 2.616 / 2.695 |
| Local pred / real | 45.1% / 44.5% | 44.6% / 48.9% |
| muShift al cierre | +0.011 | +0.019 |

Calibración elegida (horneada en `lib/euro/priors/laliga.js`, regenerar con `node scripts/build-euro-priors.js laliga --halfLife 500 --shotsW 0 --sgdK 0.025 --dcBet 0.76 --dcMaybe 0.70 --bttsBet 0.60 --bttsMaybe 0.58`):

- `halfLife 500` — mejor que 365 en las DOS temporadas y a todos los K (marginal monótono 200→500); LaLiga premia la memoria larga.
- `shotsW 0` — los tiros a puerta mejoran 25-26 (~0.001) pero empeoran 24-25; no llegan al umbral de 0.002 en ambas. Goles puros.
- `sgdK 0.025` — K=0.015 gana por 0.0006 de log-loss promedio (ruido) y cada temporada prefiere un K distinto; se queda el default.
- `muShift` activo (N 80, tope 0.08) — neutral en el backtest (±0.0003); las dos temporadas anotaron más que su historia y la corrección fue en la dirección correcta.
- `dcBet 0.76 / dcMaybe 0.70` — 0.72 falla en 25-26 (79.8%); 0.76 da ≥82% en ambas.
- `bttsBet 0.60 / bttsMaybe 0.58` (subidas del default 0.555/0.535) — el modelo subestima "ambos anotan" 7-8 puntos en las dos temporadas (sobra portería en cero: 0.61 vs 0.51 real por juego); con la barra default el veredicto BTTS NO acertaba 54.0% / 52.8%; con 0.60 acierta 55.8% / 64.9% y el SÍ 65.5% / 63.0%.

Pendientes conocidos: total de goles 0.05-0.08 por debajo en ambas temporadas (muShift lo absorbe en parte); 1-1 subpredicho (11% vs 15%) y 0-0 sobrepredicho (7% vs 5%) — un solo rho de Dixon-Coles no arregla ambos, por eso cae en ≈0; en 25-26 la ventaja de local real (48.9%) superó a la predicha (44.6%).

### bundesliga

Backtest walk-forward honesto (ajuste solo con juegos anteriores a la temporada de prueba; predice → registra → aprende, con el mismo `lib/euro/core.js` del runtime) sobre la malla K ∈ {0, 0.015, 0.025, 0.035, 0.05} × halfLife ∈ {200, 300, 365, 500} × shotsW ∈ {0, 0.25, 0.5} × muShift on/off, en dos temporadas completas (306 juegos cada una). Criterio: mínimo log-loss promedio de ambas temporadas (desempate RPS).

| Métrica (CAL elegido) | 2024-25 | 2025-26 |
|---|---|---|
| Juegos de ajuste / prueba | 612 / 306 | 918 / 306 |
| Brier 1X2 (base liga) | 0.6101 (0.6667) | 0.5709 (0.6478) |
| Log-loss 1X2 (base liga) | 1.0193 (1.0969) | 0.9656 (1.0706) |
| RPS (base liga) | 0.2112 (0.2392) | 0.1938 (0.2313) |
| Skill Brier | 8.5% | 11.9% |
| Favorito acierta | 50.3% | 55.2% |
| Seguros DC ≥ 0.80 | 97/113 = 85.8% | 86/95 = 90.5% |
| O/U 2.5 Brier · over pred vs real | 0.2334 · 60.0% vs 59.8% | 0.2317 · 59.0% vs 63.7% |
| BTTS Brier · sí pred vs real | 0.2430 · 59.2% vs 56.9% | 0.2443 · 58.7% vs 61.8% |
| Marcador exacto top-1 | 8.2% | 10.5% |
| Total predicho vs real | 3.146 vs 3.134 | 3.111 vs 3.235 |
| % local predicho vs real | 46.5% vs 38.6% | 43.0% vs 43.8% |
| muShift al cierre | −0.004 | +0.030 |

Calibración horneada en `lib/euro/priors/bundesliga.js` (`node scripts/build-euro-priors.js bundesliga --halfLife 500 --shotsW 0 --sgdK 0.015 --dcBet 0.80 --dcMaybe 0.74`):

- **halfLife 500** — mejora monótona 200→500 en las dos temporadas; vs 365 la diferencia es ruido (0.0009) pero va en la misma dirección en ambas, y con 18 equipos la liga agradece más memoria (700/1000 fuera de malla ya no mueven nada).
- **shotsW 0** — los tiros a puerta ayudan en 2024-25 (−0.005) pero estorban en 2025-26 (+0.001) en todas las celdas: no cumple "ayuda en ambas". Revisar con una tercera temporada.
- **sgdK 0.015** — promedio 0.9925 vs 0.9944 con el default 0.025; cada temporada pide un K distinto (≈0.01 vs ≈0.025) y 0.015 es el compromiso.
- **muShift on** (N 80, tope 0.08) — nunca estorba y en 2025-26 absorbió parte del subpronóstico de goles (+0.03).
- **dcBet 0.80 / dcMaybe 0.74** — 0.76 solo acierta 79% en 2024-25; 0.80 es la barra más baja con ≥82% en ambas temporadas.
- **bttsBet/bttsMaybe por defecto** — el sesgo de BTTS cambia de signo entre temporadas (±3 pts).

Avisos: la ventaja de local es volátil (2024-25 tuvo 38.6% de triunfos locales contra 46.5% predicho; 2025-26 cuadró); los priors 2026-27 llevan hfa 0.188 con cuatro temporadas. Paderborn y Elversberg entran con el ancla de ascendido (att −0.212 / def 0.122) salida de los 5 ascendidos de la ventana.

### Comparativa entre ligas

Mismas dos temporadas de prueba (2024-25 / 2025-26), cada liga con SU
calibración horneada. Los valores de priors son los de
`lib/euro/priors/<liga>.js` generados el 5-sep-2026.

| | Premier | LaLiga | Bundesliga |
|---|---|---|---|
| Juegos del fit de priors (22-23 → 25-26) | 1,520 | 1,520 | 1,224 |
| halfLife · sgdK · shotsW | 365 · 0.025 · 0 | 500 · 0.025 · 0 | 500 · 0.015 · 0 |
| dcBet / dcMaybe | 0.72 / 0.66 | 0.76 / 0.70 | 0.80 / 0.74 |
| bttsBet / bttsMaybe | 0.555 / 0.535 | 0.60 / 0.58 | 0.555 / 0.535 |
| mu · hfa · rho (priors 26-27) | 0.2539 · 0.1776 · −0.08 | 0.0818 · 0.2908 · 0.015 | 0.322 · 0.1883 · −0.08 |
| Goles/juego · empates (histórico) | 2.95 · 24.1% | 2.62 · 25.4% | 3.19 · 25.2% |
| Log-loss 1X2 24-25 (base) | 0.9869 (1.0860) | 0.9754 (1.0709) | 1.0193 (1.0969) |
| Log-loss 1X2 25-26 (base) | 1.0294 (1.0845) | 0.9800 (1.0489) | 0.9656 (1.0706) |
| Skill Brier 24-25 / 25-26 | 10.6% / 5.7% | 10.6% / 7.9% | 8.5% / 11.9% |
| Favorito acierta 24-25 / 25-26 | 52.4% / 46.8% | 52.9% / 52.6% | 50.3% / 55.2% |
| Seguros DC a su barra BET | 82.8% / 82.3% (≥0.72) | 84.9% / 82.9% (≥0.76) | 85.8% / 90.5% (≥0.80) |
| O/U 2.5 Brier 24-25 / 25-26 | 0.2446 / 0.2566 | 0.2420 / 0.2455 | 0.2334 / 0.2317 |
| BTTS Brier 24-25 / 25-26 | 0.2476 / 0.2489 | 0.2487 / 0.2490 | 0.2430 / 0.2443 |
| Marcador exacto top-1 24-25 / 25-26 | 11.3% / 11.3% | 14.5% / 15.5% | 8.2% / 10.5% |
| Ascendidos 26-27 con ancla | Hull, Coventry | Racing, Deportivo, Málaga | Paderborn, Elversberg |
| Ancla de ascendido (att / def) | −0.149 / 0.211 | −0.149 / 0.101 | −0.212 / 0.122 |

Lecturas: las tres le ganan claramente a la base de liga en 1X2 (skill
6–12 %, log-loss 0.05–0.10 mejor); LaLiga es la más predecible
(marcador exacto 15 %, favorito estable en 52–53 %) y la que más memoria
pide; Bundesliga es la más goleadora y la que mejor calibra O/U y BTTS
en Brier, pero su localía es volátil; Premier fue la más difícil en
2025-26 (temporada de empates). En las tres, O/U 2.5 y BTTS apenas
empatan con la tasa base: el modelo clava el total medio pero
subestima la varianza real. Con n chica los deciles altos del favorito
saltan (Bundesliga 25-26: 80-90 % predicho vs 69 % real con n=13).

### Contra el mercado (cierres reales) — lo que hay que saber antes de vender EV

El backtest empareja cada partido con su cierre de football-data
(`avg`, 100 % de cobertura en las seis temporadas) y aplica la MISMA
regla de veredictos del runtime (`core.ev1x2` / `core.evTotal`) para
contar cuántos BET saldrían y su ROI a 1 unidad plana. Resultado con la
calibración horneada (`mktBlend 0.45`, `x2Floor 0.35`):

| Liga · temporada | Brier 1X2 modelo / mercado | BET 1X2: n · acierto · ROI | BET O/U 2.5: n · ROI |
|---|---|---|---|
| Premier 24-25 | 0.5895 / 0.5752 | 69 · 40.6% · +3.1% | 71 · −1.3% |
| Premier 25-26 | 0.6188 / 0.6077 | 44 · 27.3% · −33.0% | 101 · −14.7% |
| LaLiga 24-25 | 0.5787 / 0.5594 | 53 · 28.3% · −29.7% | 78 · −7.1% |
| LaLiga 25-26 | 0.5816 / 0.5717 | 41 · 36.6% · −16.1% | 48 · −25.4% |
| Bundesliga 24-25 | 0.6101 / 0.5895 | 50 · 28.0% · −35.8% | 42 · −42.5% |
| Bundesliga 25-26 | 0.5709 / 0.5618 | 46 · 43.5% · −3.4% | 45 · −13.1% |

Dos hechos duros:

1. **El consenso de cierre tiene mejor Brier que el modelo en las seis
   temporadas.** El modelo no le gana a la línea; le gana a la base de
   liga, que es otra cosa.
2. **Los BET del 1X2 por EV pierden dinero.** Con el `mktBlend 0.22` /
   piso 0.20 heredados de Liga MX el ROI iba de −5 % a −26 % con
   150–220 BETs por temporada (casi todos empates y underdogs largos).
   Por eso `DEFAULT_CAL` subió el encogimiento a 0.45 y el piso a 0.35
   (~70 % menos BETs, fuera empates): el sangrado baja, pero sigue
   negativo en 5 de 6 temporadas. El O/U 2.5 con EV tampoco es positivo
   en ninguna. Con cierres de Pinnacle (`--book pinnacle`, solo cubre
   210/380 de Premier 25-26) el 1X2 da −11 % y el O/U +6 %: ruido.

Conclusión operativa (misma regla del MLB-README: no vender picks de
un mercado que no calibre): lo que SÍ está validado es la
probabilidad del 1X2, los "seguros" de doble oportunidad a su barra
(82–90 % de acierto) y el marcador exacto; el veredicto BET por EV
contra el mercado NO está demostrado rentable y hay que presentarlo
como "dónde el modelo difiere del mercado", no como ventaja. Las
barras de BTTS se eligieron por acierto (el CSV no trae momios de
BTTS), no por ROI.

## Champions League (8-sep-2026): un modelo de copa sobre el mismo núcleo

La Champions entra como cuarto modelo europeo (`ucl`, ESPN
`uefa.champions`, página `/europa.html?liga=ucl`) y **dentro del
paquete Europa** (producto `ucl` en `europa_*` y `todo_*`; nunca se
vende sola). Misma matriz Dixon-Coles y mismos endpoints; lo que cambia
es cómo se estiman los ratings y de qué aprende en temporada.

### Por qué no basta con "otra liga"

Los 36 clubes de la fase de liga vienen de 16 ligas y cada uno juega
solo 8 partidos: con la Champions sola no hay forma de poner a Bayern,
Liverpool y Bodø/Glimt en la misma escala. Por eso los priors salen de
**un ajuste conjunto** (`scripts/build-ucl-priors.js`, `lib/euro/fit.js`
con filas `dom` y `uefa`) sobre las ligas domésticas que ESPN cubre más
Champions, Europa League y Conference (`LEAGUES.ucl.fitWith`, 19
competencias, ~19,500 partidos 2022-26): los partidos europeos son los
puentes entre ligas. Las ligas que solo alimentan el ajuste van en el
catálogo con `fitOnly: true` (sin priors, sin endpoint, sin venta).
Chequia, Eslovaquia, Ucrania y Azerbaiyán no están en ESPN: Slavia,
Slovan, Shakhtar y Sabah se califican solo con sus partidos europeos
(Sabah, sin ninguno, arranca con el **ancla del debutante europeo**:
promedio de los 66 clubes que solo tienen partidos europeos).

Tres piezas nuevas en `lib/euro/core.js` / `fit.js`, todas
retrocompatibles (las tres ligas dan exactamente los mismos números
que antes; verificado con el backtest de la Premier 2025-26):

- **Nivel y localía por competencia** (`levelOf`): los partidos
  europeos tienen su propio `mu` y `hfa` (`muUefa`, `hfaUefa` en forma
  cerrada) — en Europa la localía es mayor (0.31 vs 0.21 doméstico) y el
  nivel goleador, dado el rival, algo menor. La final cuenta como sede
  neutral (ESPN no la marca; se detecta por la fase `final`).
- **Escala europea** (`fit.js` paso 3, `LEAGUE.scale`): la
  regularización del ajuste conjunto encoge las diferencias ENTRE
  ligas (solo las identifican ~1,900 partidos europeos) y el favorito
  salía subestimado (55% predicho → 62-70% real). Una escala `s` sobre
  `att+def` ajustada por verosimilitud en los partidos europeos sale en
  **1.30-1.35** en las dos temporadas de prueba y en el ajuste final, y
  mejora el log-loss en ambas. Los partidos domésticos usan escala 1.
- **Aprendizaje de la liga de cada club** (`LEAGUES.ucl.learnFrom`, 12
  ligas): en temporada el runtime aprende de la Champions Y de los
  partidos de liga de los 36 (con el nivel doméstico, `LEAGUE.comps.dom`);
  `muShift` solo se alimenta de la Champions (`muShiftComp`). Los
  rivales domésticos sin prior (recién ascendidos en su liga) arrancan
  con el ancla. Sin descanso corto (`restMult 1`): en Champions todos
  juegan entre semana tras la liga.

### Validación (`scripts/ucl-backtest.js`, walk-forward sin fuga)

Ajuste solo con partidos anteriores al primer juego de Champions de la
temporada; se aprende en orden cronológico de Champions + ligas y se
califican solo los 189 partidos de Champions. Calibración elegida:
`halfLife 500`, `sgdK 0.025`, `dcBet 0.76`, `bttsBet 0.555`, `restMult 1`.

| Temporada | Brier 1X2 modelo / base | log-loss | RPS | skill | Seguros DC ≥0.76 | BTTS ≥0.555 | O/U 2.5 pred / real | Total pred / real |
|---|---|---|---|---|---|---|---|---|
| 2024-25 | 0.5223 / 0.6042 | 0.8904 / 1.0016 | 0.1991 / 0.2400 | 13.6% | 84/102 = 82.4% | 65/111 = 58.6% | 59.9% / 64.6% | 3.16 / 3.27 |
| 2025-26 | 0.5332 / 0.6161 | 0.9086 / 1.0210 | 0.1938 / 0.2343 | 13.5% | 84/98 = 85.7% | 87/136 = 64.0% | 60.8% / 65.6% | 3.22 / 3.47 |

Lecturas:

- El modelo le gana a la base de la Champions por **13-14 % de
  Brier** en las dos temporadas: más que en las ligas (6-12 %),
  porque en una copa con 36 clubes de niveles muy distintos hay más
  que predecir.
- Aprender de las ligas domésticas aporta en promedio (log-loss 0.908
  vs 0.912 sin ellas), con signo distinto por temporada: se conserva
  porque es el modelo más informado y su costo es una llamada más a
  ESPN por liga.
- Sesgo conocido: la fase de liga (desde 2024-25) anota más de lo que
  el ajuste espera (**0.1-0.25 goles por partido de menos**, y por
  eso empates de más: 22 % predicho vs 18 % / 14 % real). El nivel
  propio de la Champions medido sobre el histórico sale ≈ 0
  (`ucl_level`): la deriva es de la temporada en curso y la corrige
  `muShift` en vivo (cierra en +0.02 / +0.05), sin llegar del todo.
  Consecuencia práctica: los O/U salen algo conservadores hacia el
  under; los seguros DC y BTTS calibran.
- **Sin cierres históricos**: football-data.co.uk no cubre la
  Champions, así que aquí no hay medición contra el mercado. Aplica
  la misma prudencia que en las ligas (ver "Contra el mercado"): los
  veredictos EV del 1X2 y totales no están validados como rentables.
- Momios en vivo: `soccer_uefa_champs_league` (TTL 60 min), 32/32
  nombres vivos mapeados en `lib/euro/oddsnames.js` (`NAMES.ucl`).

### Fase de la competencia

`lib/euro/model.js` manda `phase_label` para las copas ("Jornada 3 de
8", "Playoffs", "Octavos de final"…) a partir del `season.slug` de los
partidos por jugar de la ventana; la página lo usa en vez de la
jornada. Las eliminatorias a doble partido se predicen como partidos
sueltos (el 1X2 es del partido, no de la serie): pendiente para
febrero de 2027 avisarlo en el análisis.

### Cómo regenerar

```
node scripts/euro-history.js fit          # ligas y copas que solo alimentan el ajuste
node scripts/euro-history.js ucl --stats  # Champions con córneres
node scripts/ucl-backtest.js --season 2025-26 --K 0.015,0.025,0.035 --halfLife 365,500
node scripts/build-ucl-priors.js --halfLife 500
```

## Estado actual (5-sep-2026)

- **Beta privada admin-only** en las tres ligas: `PUBLIC_LEAGUES = new
  Set([])` en `api/euro-picks.js` Y en `api/euro-free.js` (deben ser
  el mismo Set; si divergen el landing enseña un pick gratis de una
  liga cuya página sigue cerrada, o al revés). No-admin (con o sin
  sesión) → `403 { error: 'Modelo en beta privada.', beta: true,
  league_id, league_name }`.
- El admin entra por `ADMIN_EMAILS` (`rickybh17@gmail.com`) en los dos
  endpoints, y `lib/supabaseAdmin.js` le fabrica entitlements
  `epl_mensual` / `laliga_mensual` / `bundesliga_mensual` para que los
  candados de entitlement también lo dejen pasar.
- **Dev local** (`node dev-server.js`, sin `VERCEL`): acceso completo.
  `?as=guest` en la URL de la página o del API simula al invitado con la
  liga YA pública (destacado completo, resto `locked`); `?as=beta`
  simula al público con la liga privada (403).
- **Planes cableados pero no a la venta** (`upcoming: true` en
  `lib/plans.js`, precios PROVISIONALES): `epl_mensual`,
  `laliga_mensual`, `bundesliga_mensual` ($349), `europa_mensual` (las 3
  ligas, $349 — mismo precio que un modelo), `todo_mensual` (los 6
  modelos, $599), `europa_temporada` (pago único, $1,199, ancla $3,141,
  275 días). Son los precios de la estrategia recomendada el
  5-sep-2026 (Europa se vende como UN modelo, nunca por liga; ver el
  documento de pricing); el dueño decide antes de vender. `europa_permanente`
  (precio 0, solo por código/soporte, sin `upcoming`). Productos:
  `epl`, `laliga`, `bundesliga`. Un plan `upcoming` NO sale en
  `/api/plans-public` y `api/stripe-create.js` / `api/create-payment.js`
  lo rechazan con "Ese plan todavía no está a la venta." antes de
  tocar la pasarela. `europa_temporada` está en `FULL_PASS_PLANS`
  (cancela las mensualidades europeas que cubre) y la regla
  `coverageBeats` conserva un pase vigente que dura más (un
  `todo_mensual` ya no pisa `europa_temporada`).
- **Frontend ya preparado para la apertura**: `public/europa.html`
  lee el banner de planes de `/api/plans-public` (`<liga>_mensual`,
  `europa_mensual`, `europa_temporada`) y lo oculta si ninguno está a
  la venta; el candado por partido manda a `/producto.html?m=europa`;
  `producto.html?m=europa` (alias `?m=epl|laliga|bundesliga` eligen la
  liga del pick gratis) pinta "Próximamente · beta privada" mientras no
  haya planes y la card del pick en estado BETA ante el 403;
  `index.html` tiene la sección "Free pick Europa" y la QUITA entera
  del DOM cuando `/api/euro-free?liga=epl` contesta 403; `mis-modelos`,
  `admin.html`, `checkout.html`, `my-access` y `meta-purchase.js` ya
  conocen los tres productos. El link "Europa" del nav de la homepage y
  de los toggles de mx/mlb/nfl es visible para todos; quien no es admin
  aterriza en el estado "Beta privada".
- Pick gratis por liga clavado en KV (`euro-free-<liga>-2026-27` en el
  bucket `odds-cache`), misma máquina de estados que NFL: se puede
  re-elegir mientras no empiece, congelado en juego, pasa al siguiente
  al terminar. `OVERRIDES` en `lib/euro/featured.js` para forzarlo por
  nombre de equipo.
- Tiempos por tablero en la primera corrida: ~1.5 s Premier, ~1.1 s
  LaLiga, ~0.7 s Bundesliga (caché de 5 min por liga en `euro-picks`,
  10 min en `euro-free`; `?refresh=1` solo con acceso completo).

## Cómo publicar una liga (cuando se decida cobrar)

1. **Precios reales** en `lib/plans.js`: quitar `upcoming: true` de los
   planes que se vayan a vender (`epl_mensual`, `laliga_mensual`,
   `bundesliga_mensual`, `europa_mensual`, `todo_mensual`,
   `europa_temporada` — plan por plan, pueden salir escalonados) y fijar
   `price` (y `anchor` de `europa_temporada`). Espejar el precio en
   `public/checkout.html` (ficha `PLANS`, solo texto: el cobro real sale
   del servidor), en `api/stripe-create.js` (`PLAN_NAMES`, ya están) y
   en `public/meta-purchase.js` (valores que reporta el Pixel;
   provisionales hoy). `producto.html` y `europa.html` NO se tocan: leen
   `/api/plans-public`.
2. **Abrir la liga**: agregar su id al `PUBLIC_LEAGUES` de
   `api/euro-picks.js` Y de `api/euro-free.js`. Con eso queda en
   freemium como Liga MX: partido destacado completo (el pick gratis),
   el resto `locked: true` sin veredictos, mercados ni análisis (el
   candado es del servidor, el blur del frontend es cosmético). El
   landing recupera solo la sección "Free pick Europa".
3. `node scripts/verify-plans.js` (estático + EN VIVO contra Supabase
   con el usuario de prueba): debe pasar sin fallas. Los combos
   (`europa_*`, `todo_*`) escriben una fila por producto y **requieren
   la migración `scripts/migrate-entitlements-product.sql`** (columna
   `product` + índice único `user_id, product`); sin ella
   `grantEntitlement` lanza error y el webhook reintenta — no hay
   fallback seguro para combos. Correrla primero si sigue pendiente.
4. Revisar `public/meta-purchase.js` (importes del Pixel) y el copy de
   `index.html` (FAQ "¿Qué incluyen los planes de Europa?" y los
   términos, que hoy dicen "mientras el modelo esté en beta privada,
   ningún plan de Europa está a la venta").
5. Banners y CTAs: nada que hardcodear — `europa.html` muestra el banner
   en cuanto `plans-public` traiga algún plan europeo y `producto.html`
   reemplaza "Próximamente" por las tarjetas. Verificar en el navegador
   como invitado (`?as=guest` en local) y con una cuenta sin plan.
6. Desplegar y probar el ciclo compra → regreso (`destForPlan` manda a
   `/europa.html?liga=<liga>`; `europa_*` a Premier; `todo_*` a
   `/mis-modelos.html`).

## Cómo agregar Serie A / Ligue 1

Están cableadas en `LEAGUES` (`seriea`: `ita.1` / `soccer_italy_serie_a`,
20 equipos, 38 jornadas; `ligue1`: `fra.1` / `soccer_france_ligue_one`,
18 y 34) con `enabled: false`, plantillas 2026-27 en `TEAMS`,
`SLUG_SUFFIX` en `euro-history.js`, división de football-data (`I1`,
`F1`) y TTL de momios de 60 min. Falta:

1. `lib/euro/leagues.js`: `enabled: true` (revisar la plantilla contra
   ESPN `/teams?limit=50` y las ciudades).
2. Histórico y summaries: `node scripts/euro-history.js seriea --stats`
   (~10 min la primera vez por liga).
3. Backtest: `scripts/euro-history.js` tiene `FD_DIV` para ambas pero
   `FD_NAMES` solo cubre las tres ligas actuales — agregar el mapa
   nombre de football-data → id de ESPN, si no el backtest avisa
   "EQUIPOS SIN MAPEAR" y corre sin métricas de mercado. Correr
   `--season 2024-25` y `2025-26` con la malla completa y elegir CAL
   con la misma regla (log-loss promedio, ≥ 0.002 y en ambas para
   aceptar un cambio del default).
4. Priors: `node scripts/build-euro-priors.js seriea --halfLife … ` →
   `lib/euro/priors/seriea.js`, y agregar el `require` estático en
   `PRIORS_FILES` de `lib/euro/model.js` (sin eso `buildBoard` lanza
   "Sin priors para la liga").
5. Momios: `lib/euro/oddsnames.js` — `nameToId` ya se arma para toda
   liga de `TEAMS` con el respaldo por normalización, pero conviene
   levantar los nombres reales del API una vez (cuesta 2 créditos) y
   ponerlos en `NAMES`. Presupuesto: cada liga nueva suma ~1.4K
   créditos/mes en el peor caso.
6. Página y planes: `LIGAS` + enlaces del `liga-toggle` en
   `public/europa.html`; `EURO_LIGAS` en `public/producto.html`;
   productos `seriea` / `ligue1` en `lib/plans.js` (`EURO_PRODUCTS`,
   planes `<liga>_mensual`, lista `products` de `europa_*` / `todo_*` /
   `europa_permanente`), prefijos en `productForPlan` de
   `lib/supabaseAdmin.js`, `KNOWN_PRODUCTS` en `scripts/verify-plans.js`,
   `PRODUCT_LABEL` / `PRODUCT_ORDER` / `PLAN_SHORT` en `admin.html`,
   `PLANS` / `modelUrl` / `productsOf` / `TOP` en `checkout.html`, chips
   en `mis-modelos.html`, `PLAN_NAMES` en `stripe-create.js`,
   `destForPlan` en `create-payment.js`, `meta-purchase.js`.
7. `PUBLIC_LEAGUES` en los dos endpoints cuando toque abrirla.

## Mantenimiento entre temporadas (cada julio)

1. `lib/euro/leagues.js`: `seasonLabel` → `2027-28`, `seasonStart` →
   `2027-08-01`, `histStart` → `2023-07-01`, `histEnd` → `2027-07-31`
   (ventana de cuatro temporadas rodante). Regenerar `TEAMS` con las
   plantillas nuevas de ESPN `/teams` (ascensos/descensos, ciudades) —
   el script de una sola vez con el que se generaron no está versionado
   en el repo (vivió en el scratchpad de la sesión del 5-sep-2026);
   rehacerlo o editar a mano siguiendo el formato. Corregir a mano las
   sedes que ESPN trae mal (hoy Dortmund, Hamburg, Troyes).
2. `node scripts/euro-history.js all --stats` — baja la temporada
   recién terminada y sus summaries.
3. Volver a correr `scripts/euro-backtest.js` por liga sobre la
   temporada recién terminada (y la anterior) para confirmar o mover
   CAL; después `node scripts/build-euro-priors.js <liga> <banderas>`
   con las banderas elegidas. Revisar en el log la lista "sin historia
   en la ventana (ascendidos)" y que el archivo traiga a toda la
   plantilla (el script falla si falta alguien).
4. `lib/euro/oddsnames.js`: alias de los ascendidos en `NAMES`;
   `scripts/euro-history.js`: `FD_NAMES` de los ascendidos para el
   backtest.
5. `lib/plans.js`: `europa_temporada` (`days`, `anchor`, título con la
   temporada nueva). La llave del KV del pick gratis cambia sola con
   `seasonLabel`.
6. Reiniciar el dev-server después de tocar `lib/` (ver gotchas) y
   correr `node scripts/verify-plans.js --static`.

## Archivos

- `lib/euro/leagues.js` — catálogo: `LEAGUES`, `TEAMS` (por id de ESPN),
  `logoUrl`, `leagueOf`
- `lib/euro/data.js` — capa ESPN por liga (scoreboard mensual,
  summaries, ventana con extensión por pausa, caché)
- `lib/euro/core.js` — núcleo puro compartido por backtest y runtime
  (lambdas, sgdUpdate, muShift, replayResults, EV, `DEFAULT_CAL`)
- `lib/euro/fit.js` — ajustador Dixon-Coles con decaimiento (solo
  scripts)
- `lib/euro/model.js` — orquestador `buildBoard(leagueId)`: mercados,
  veredictos, análisis en español
- `lib/euro/featured.js` — pick gratis por liga clavado en KV
  (compartido por los dos endpoints)
- `lib/euro/oddsnames.js` — nombres de The Odds API → id de ESPN
- `lib/euro/priors/{epl,laliga,bundesliga}.js` — GENERADOS por
  `build-euro-priors.js` (`LEAGUE`, `PRIORS`, `CORNERS`, `CAL`)
- `api/euro-picks.js` — `GET ?liga=…[&refresh=1][&as=guest|beta]`,
  beta privada + freemium con candado server-side
- `api/euro-free.js` — `GET ?liga=…`, un partido con la forma exacta de
  `/api/mx-free` más `league_id` / `league_name`
- `public/europa.html` — una página para las tres ligas (sub-toggle),
  design system terminal claro (Inter Tight + JetBrains Mono, tokens de
  `mx.html`), horas en `America/Mexico_City`, momios manuales del
  usuario recalculados con `ev_params`
- `scripts/euro-history.js` — histórico + summaries + cierres en disco
- `scripts/build-euro-priors.js` — genera los priors con CAL horneada
- `scripts/euro-backtest.js` — walk-forward + barrido + contra el
  mercado
- Toques en archivos compartidos: `lib/plans.js`, `lib/supabaseAdmin.js`,
  `lib/odds/theoddsapi.js` (`getSoccerOdds`, `findSoccerOdds`,
  `SPORT_TTL_MIN`), `api/plans-public.js`, `api/stripe-create.js`,
  `api/create-payment.js`, `api/my-access.js`, `scripts/verify-plans.js`,
  `public/{index,producto,checkout,mis-modelos,admin,mx,mlb,nfl}.html`,
  `public/meta-purchase.js`

## Gotchas

- **dev-server.js NO recarga `lib/` en caliente**: solo borra del caché
  de `require` el archivo de `api/`. Reiniciar tras tocar `lib/euro`
  (mismo gotcha que MLB y Liga MX).
- **Ids de ESPN, no abreviaturas**, en todo lo que se indexe por equipo.
  Si algo llega por nombre (The Odds API, football-data) pasa por su
  mapa (`oddsnames.js`, `FD_NAMES`) y nunca se adivina entre dos.
- **Momios solo pre-partido**: al arrancar el juego el consenso
  desaparece, el veredicto pierde el precio y se topa en MAYBE; por eso
  el pick gratis se clava en KV (si no, saltaría a otro partido y se
  regalaría un segundo pick).
- **Las copas europeas no cuentan para el descanso**: Champions, Europa
  League y copa nacional no salen en el scoreboard de la liga, así que
  un equipo que jugó el martes en Champions se ve descansado.
  Limitación conocida, aceptada.
- **La línea de totales del consenso puede ser 3.5** (la que más casas
  ofrecen); el backtest solo mide 2.5 (única línea del CSV).
- **Jornada estimada**: mediana de juegos por equipo + 1; salta a media
  ronda (con 18 equipos, al jugarse 5 de 9). Por eso la llave del KV
  del pick gratis NO lleva la jornada.
- `PUBLIC_LEAGUES` vive en DOS archivos (`euro-picks`, `euro-free`) y
  deben coincidir.
- ESPN clásico regresa 403 desde datacenter; siempre por el espejo
  `site.web.api.espn.com` (el clásico solo en el tercer intento).
- El caché de scripts vive en `os.tmpdir()/ricky-euro-history` y macOS
  puede purgarlo; se regenera solo con el mismo comando (~10 min con
  `--stats`).
- `fetchJson(url, 0)` = sin caché en memoria (summaries pesados).
- `shotsW > 0` en runtime necesitaría `home.sot` / `away.sot` en los
  resultados de `getSeasonResults`, que no los trae: caería en silencio
  a goles puros. Con el `shotsW 0` actual no aplica; si algún día se
  activa hay que adjuntar `getMatchStats` por juego.
- Sin `ODDS_API_KEY` el modelo corre igual pero sin EV (todo topado en
  MAYBE). Con menos de 2,000 créditos el TTL se degrada ×8.
- `www.football-data.co.uk` contesta 503; usar el dominio pelado (ya
  está así en el script).
- LaLiga 2022-23: cinco partidos de la J21 quedaron "Scheduled" en ESPN
  con marcador real; se rescatan con `stuckButPlayed`. Un 0-0 atorado
  de esa forma se perdería (no se observó ninguno).

## Pendientes y asuntos abiertos

De datos y catálogo:

- LaLiga 2022-23: ESPN deja 5 juegos de la J21 (feb-2023: Almería 2-3
  Betis, Sevilla 2-0 Mallorca, Valencia 1-2 Athletic, Espanyol 2-3 Real
  Sociedad, Real Madrid 4-0 Elche) como `Scheduled` / `completed=false`
  aunque el scoreboard trae el marcador real y el summary no tiene
  boxscore. Se rescatan con `stuckButPlayed` (más de 7 días de
  antigüedad, estado `pre`, marcador entero y distinto de 0-0); quedan
  con stats null. Sin la regla LaLiga 22-23 tendría 375 juegos.
- `TEAMS.city` viene de la sede que reporta ESPN en los partidos de
  local (voto mayoritario 2025-26 + 2026-27 con peso ×3 a la temporada
  actual). Tres sedes vienen mal en ESPN y se corrigieron a mano en
  `leagues.js` (Dortmund "Aue" → Dortmund, Hamburg "Hamburg
  Norderstedt" → Hamburg, Troyes "Paris" → Troyes); otras conservan la
  grafía de ESPN (Rayo = "Leganés, Madrid", Valencia/Levante =
  "Manises", Málaga = "Malaga"). Solo cosmético: el modelo no usa la
  ciudad.
- Plantillas 2026-27 tal como las regresa ESPN hoy: Premier incluye
  Coventry, Hull, Ipswich, Sunderland, Leeds; LaLiga incluye Racing,
  Deportivo, Málaga, Levante, Elche; Bundesliga incluye Paderborn,
  Elversberg, Schalke, Hamburg. La lista de "ascendidos" se calcula
  como equipos sin partidos en la ventana 22-23..25-26
  (Sunderland/Leeds/Ipswich sí tienen historia dentro de la ventana,
  por eso no aparecen).
- Extras fuera del contrato (inofensivos): `data.js` exporta
  `parseMatchStats` y `BROWSER_HEADERS`; `getMatchStats` devuelve
  id/abbr por lado junto con las stats; `euro-history.js` exporta
  `getSeasonGames`, `getClosingOdds`, `SLUG_SUFFIX` y `FD_NAMES`, y el
  array de `getHistory` trae `perSeason` y `coverage` como propiedades
  adjuntas; `LEAGUE.conversion` en los priors; `core.js` exporta además
  `DEFAULT_CAL`, `withDefaults`, `blendTarget`, `targetsOf`,
  `replayResults`, `clampLambda`, `restInfo`, `LAM_MIN/LAM_MAX` y el
  bloque de EV; `fit.js` exporta `conversionOf`, `REG_W`,
  `FALLBACK_ANCHOR` y `diag` con `iters` / `last_step` / `promoted_ids`
  / `low_evidence_ids`.
- La rama de extensión por pausa de `getWindow` no se ejercitó en vivo.
- El script que generó `TEAMS` no está en el repo.

Del modelo:

- **EV contra el mercado no rentable** (ver la sección de cierres):
  `mktBlend 0.45` / `x2Floor 0.35` reducen el sangrado pero no lo
  vuelven positivo. Decidir antes de abrir al público cómo se presenta
  el veredicto 1X2/total con momios (o si se muestra solo la
  probabilidad y la doble oportunidad).
- Premier 2025-26 con defaults: el decil 40-50 % del favorito sale
  sobreconfiado (predicho 44.6 % vs real 38.2 %, n=152) y el empate se
  subpredice (23.9 % vs 27.4 %); el rho de los priors 26-27 (−0.08) no
  está validado fuera de muestra (los walk-forward dieron 0).
- O/U 2.5 y BTTS con Brier ≈ tasa base en las tres ligas: el modelo
  subestima la varianza de goles. Las barras de BTTS se calibraron por
  acierto, no por ROI (sin momios de BTTS en el CSV).
- Bundesliga: localía volátil entre temporadas; `shotsW` ayuda en una
  y estorba en otra — revisar con una tercera temporada.
- La base de liga del backtest son las frecuencias del set de ajuste
  completo sin ponderar (tres temporadas para 2025-26); para O/U y BTTS
  esa base es solo la tasa histórica.

De producto:

- Migración `scripts/migrate-entitlements-product.sql` en Supabase:
  pendiente del dueño según el registro del incidente de julio; los
  combos europeos dependen de ella. `node scripts/verify-plans.js` (en
  vivo) es la prueba.
- Precios de Europa provisionales en `lib/plans.js` (y sus espejos en
  `checkout.html` / `meta-purchase.js`); los fija la estrategia de
  pricing antes de quitar `upcoming`.
