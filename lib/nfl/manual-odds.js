/* ============================================================
   NFL — MOMIOS MANUALES (la casa donde realmente se apuesta).

   Por qué existe: los momios de ESPN BET son de referencia y a
   menudo NO son los que se pueden tomar — traen otra línea de
   total, no publican precio de moneyline, y asumir -110 en el
   hándicap infla el edge (un ARI +1.5 a -120 no paga como uno a
   -110: el modelo marcaba BET donde en realidad hay MAYBE).
   Playdoit no es integrable por API (WAF + feed Altenar
   ofuscado, ya se investigó para Liga MX), así que los momios se
   capturan a mano aquí y MANDAN sobre cualquier otra fuente.

   ---- CÓMO AGREGAR UN JUEGO ----
   Clave: 'YYYY-MM-DD:VISITA@LOCAL' con las abreviaturas de ESPN.
   La fecha puede ser la del kickoff en HORA DE MÉXICO (la que se
   ve en la página y en la casa de apuestas) o la de UTC: la
   búsqueda prueba ambas. Los juegos de noche caen al día
   siguiente en UTC, y esa discrepancia ya causó una entrada
   muerta — por eso se aceptan las dos.

   '2026-08-06:CAR@ARI': {
     source: 'Playdoit',
     ml_home: -105, ml_away: -125,   // americano; local y visita
     spread: 1.5,                    // línea del LOCAL (+ = underdog)
     spread_home: -120, spread_away: -110,
     total: 35.5,
     total_over: -115, total_under: -115,
   }

   Todos los campos son opcionales salvo `source`: lo que falte se
   rellena con ESPN. Para líneas sin precio publicado se asume -110.
   Cuando un juego ya pasó se puede borrar (no estorba, pero el
   archivo crece).
   ============================================================ */

const MANUAL_ODDS = {
  // Juego del Salón de la Fama 2026 — momios de Playdoit al 4-ago-2026
  '2026-08-06:CAR@ARI': {
    source: 'Playdoit',
    ml_home: -105, ml_away: -125,
    spread: 1.5, spread_home: -120, spread_away: -110,
    total: 35.5, total_over: -115, total_under: -115,
  },
};

const MX_TZ = 'America/Mexico_City';

/* Claves posibles de un juego: por día UTC y por día en hora de
   México (un juego de las 6 p.m. del jueves es viernes en UTC). */
function keysFor(g) {
  const away = g.away && g.away.abbr, home = g.home && g.home.abbr;
  if (!g.date || !away || !home) return [];
  const days = new Set();
  days.add(g.date.slice(0, 10));
  try {
    // 'en-CA' da YYYY-MM-DD directo
    days.add(new Date(g.date).toLocaleDateString('en-CA', { timeZone: MX_TZ }));
  } catch (e) {}
  return [...days].map(d => `${d}:${away}@${home}`);
}
function keyFor(g) { return keysFor(g)[0] || null; }

function manualFor(g) {
  for (const k of keysFor(g)) if (MANUAL_ODDS[k]) return MANUAL_ODDS[k];
  return null;
}

module.exports = { MANUAL_ODDS, manualFor, keyFor, keysFor };
