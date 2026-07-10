# Brief: Modelo de predicciones MLB — para Fable 5

> **Objetivo:** construir un modelo de predicciones de MLB para RICKY-PICKS, con la misma
> arquitectura de servidor que el modelo del Mundial que ya tenemos (coeficientes solo en
> backend, frontend recibe solo probabilidades, gating por plan en Supabase).

---

## 0. Contexto: cómo funciona nuestro modelo actual (fútbol)

Nuestro modelo del Mundial es un **Dixon-Coles bivariate Poisson** a nivel de EQUIPO:

- Cada equipo tiene un coeficiente de **ataque (`atk`)** y **defensa (`dfn`)**.
- Hay un término de **ventaja local (`home_adv`)** y una corrección de correlación en
  marcadores bajos (`rho` / función `tau`).
- Se aplica **shrinkage** hacia la media según el tamaño de muestra de cada equipo.
- Se ajusta por **forma reciente** (pesos por recencia con half-life).
- Con los goles esperados (`lambda`, `mu`) se construye una **matriz de marcadores** vía
  Poisson, y de ahí salen los mercados: 1X2, Over/Under 2.5, BTTS, marcadores exactos.
- Los coeficientes viven **solo en el backend** (`lib/model.js`); la API pública
  (`publicConfig()`) NUNCA los expone — solo devuelve probabilidades y xG.

**Esta forma de salida y de servir el modelo se debe REUTILIZAR para MLB.**
Lo que cambia es el MÉTODO de cálculo, no la arquitectura.

---

## 1. El cambio conceptual clave (leer antes que nada)

En fútbol el equipo es la unidad. **En baseball NO.**

- El **~60-70% del resultado lo determina el pitcher abridor**, no el equipo.
- "Los Yankees con Gerrit Cole abriendo" son un equipo distinto a "los Yankees con su 5º abridor".
- Por eso los modelos serios de MLB **no simulan equipo vs equipo** — simulan
  **a nivel de turno al bate (plate appearance)**: el arsenal del pitcher contra cada uno
  de los 9 bateadores, uno por uno, inning por inning, incluyendo el bullpen.

---

## 2. Arquitectura recomendada (2 fases)

### Fase 1 — MVP (lanzar rápido, espíritu parecido al modelo de fútbol)
Carreras esperadas a nivel equipo con un modelo Poisson / log-lineal, ajustado por:
- Pitcher abridor
- Park factor
- Bullpen

Salida: moneyline + total de carreras. Es el "Dixon-Coles de baseball". Sirve para
lanzar en semanas, no meses.

### Fase 2 — El modelo real (aquí está el edge)
**Simulación Monte Carlo a nivel de turno al bate:**
1. Cada PA produce un resultado (K, BB, 1B, 2B, 3B, HR, out) usando una **fórmula log5**
   que combina las tasas del bateador + las del pitcher + park + platoon (LHP/RHP).
2. Se aplica la **penalización por times-through-the-order** (el abridor rinde peor la 3ª
   vez que enfrenta al lineup).
3. Se cambia al bullpen según reglas de descanso/uso.
4. Se simula el juego de 9 innings **~10,000 veces**.
5. La distribución de carreras resultante genera **todos los mercados** de golpe.

---

## 3. Inputs que necesita el modelo

**Bateadores**
- wOBA, K%, BB%, ISO, batted-ball data
- Splits vs LHP / RHP (platoon)

**Pitcher abridor**
- K%, BB%, HR/9, xFIP / SIERA
- Arsenal (tipos de lanzamiento)
- Penalización por times-through-the-order

**Bullpen**
- Calidad agregada de relevistas
- Descanso / uso en los últimos 3 días (bullpen quemado = señal fuerte para el Over)

**Parque**
- Run factor y HR factor por estadio (ej. Coors Field suma ~15% al ambiente de carreras)

**Clima**
- Temperatura y viento (crítico para HR y totales)

**Lineups**
- Alineaciones confirmadas del día + abridores probables

**Umpire (avanzado, opcional en v1)**
- Tendencias de zona de strike

**Baseline**
- Ambiente de carreras promedio de la liga (para calibrar)

---

## 4. Mercados a generar (salida del modelo)

- **Moneyline** (prob. de ganar cada equipo)
- **Run line** (±1.5)
- **Total de carreras** Over/Under
- **First 5 innings (F5)** — ML y total ← **el edge más limpio**: aísla al abridor y
  elimina el ruido del bullpen. Priorizar este mercado.
- **Team totals** (carreras por equipo)
- **NRFI / YRFI** (no run first inning)

---

## 5. Fuentes de datos (todas gratis o baratas)

| Fuente | Qué da | Costo |
|---|---|---|
| **MLB StatsAPI** | Calendario, lineups, resultados oficiales | Gratis |
| **pybaseball** (Python) | Statcast, FanGraphs, Baseball Reference | Gratis |
| **Retrosheet** | Play-by-play histórico de décadas (entrenar + backtest) | Gratis |
| **Baseball Savant** | Stats avanzadas, park factors | Gratis |
| API de clima (ej. Open-Meteo) | Temp / viento por estadio | Gratis/barato |

---

## 6. Requisito de backtesting (OBLIGATORIO)

Un modelo de MLB que no le gana a la **línea de cierre (closing line)** no sirve para vender.
Validar con:
- **Brier score**
- **Log-loss**
- **ROI vs closing line**

Backtest sobre al menos una temporada completa (~2,430 juegos) antes de publicar picks.

---

## 7. Decisión estratégica a tomar antes de arrancar

**¿Entrenar desde histórico o usar stats ya calculadas?**

- **Opción A (recomendada para lanzar ya):** arrancar con stats ya calculadas de
  FanGraphs / Baseball Savant y construir solo la simulación. Más rápido, listo para
  la temporada actual.
- **Opción B (más preciso, más lento):** entrenar coeficientes propios desde Retrosheet.
  Migrar a esto después de lanzar.

→ **Recomendación: Opción A primero, Opción B como iteración.**

---

## 8. Entregables que debe producir Fable 5

1. Motor del modelo (equivalente a nuestro `lib/model.js`) con:
   - Coeficientes / datos SOLO en backend.
   - Función tipo `publicConfig()` que NO exponga el modelo, solo probabilidades.
   - Objeto de mercados `{ moneyline, run_line, total, f5, team_totals, nrfi }` que el
     frontend consuma igual que hoy.
2. Script de ingesta diaria (lineups + abridores + clima) — un solo lugar que actualizar
   por día (como nuestro `TODAY_ISO`).
3. Notebook / script de backtesting con Brier, log-loss y ROI vs closing line.
4. Documentación de qué actualizar cada día para publicar los picks.

---

## Resumen en una línea

> Reutiliza nuestra arquitectura de servidor (backend-only + gating por plan), pero cambia
> el método: en vez de ataque/defensa por equipo, **simula turno al bate con matchups
> pitcher-vs-bateador (log5) + park + bullpen + clima**, corre 10,000 simulaciones por
> juego, y prioriza el mercado **First 5 innings**. Valida siempre contra la línea de cierre.
