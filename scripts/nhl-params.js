/* ============================================================
   NHL — parámetros de PRODUCCIÓN, validados en nhl-backtest.js
   (walk-forward 2025-26 y 2024-25; ver NHL-README.md). Una sola
   fuente de verdad: los leen el backtest y build-nhl-priors, que los
   hornea en lib/nhl/priors.js. Solo scripts.
   ============================================================ */
module.exports = {
  CARRY: 0.8,        // cuánto del rating previo se hereda a la temporada nueva
  HALF_LIFE: 300,    // días para que un juego pese la mitad en el ajuste
  K: 0.025,          // aprendizaje por resultado
  SHOTS_W: 0.7,      // peso de los goles "merecidos" por tiros en el objetivo
  SHOT_KIND: 'sog',  // sog | fen | cor
  EN_OUT: 1,         // los goles a puerta vacía no se aprenden (los modela el motor)
  G_C: 0.75,         // ajuste por portero titular (1 = efecto completo de su nivel)
  G_N0: 1500,        // tiros de encogimiento del nivel del portero
  MU_SHIFT_N: 150,
};
