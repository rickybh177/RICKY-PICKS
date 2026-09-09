/* ============================================================
   Qué partido se regala como PICK GRATIS.

   Regla del dueño (9-sep-2026). Antes se elegía el de más
   convicción — o sea `strength`, que es la probabilidad del mejor
   BET — así que el pick gratis era SIEMPRE el partido más obvio de
   la jornada (un 93% de "Toluca o empate" no convence a nadie: se
   ve regalado, no se ve modelo). Ahora se busca:

     1. SEGURIDAD + INTRIGA: un veredicto lo bastante firme para dar
        confianza, pero no tan cantado que sobre el modelo. La banda
        útil es ~58%-86%, con el punto dulce en 70%.

     2. NO REGALAR EL PARTIDAZO: un Madrid–Barça, un Clásico o un
        Chiefs–Cowboys es justo por lo que la gente paga. Un partido
        entre DOS equipos taquilleros se manda al fondo y solo sale
        si no hay de otra en toda la jornada.

   Lo usan los cuatro modelos (MLB, Liga MX, NFL y las ligas
   europeas) para que la regla sea una sola y no se desincronicen.
   ============================================================ */

/* Banda de probabilidad del veredicto que se le muestra al visitante.
   Fuera de ella el partido no se descarta: solo puntúa mucho peor. */
const BANDA = { piso: 0.58, ideal: 0.70, techo: 0.86 };

function normaliza(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // Atlético → atletico
    .toLowerCase().trim();
}

/* Equipos taquilleros, escritos TAL COMO los nombra el proveedor.
   Esto se verificó contra la cartelera real: ESPN abrevia y una lista
   con nombres largos no coincidiría nunca ("Manchester United" jamás
   igualaría a "Man United", ni "Atlético Madrid" a "Atlético"). */
const EUROPA_GRANDES = [
  'real madrid', 'barcelona', 'atletico',
  'man united', 'man city', 'liverpool', 'arsenal', 'chelsea', 'spurs', 'tottenham',
  'bayern', 'dortmund', 'leverkusen',
  'psg', 'paris', 'inter', 'milan', 'juventus', 'napoli', 'roma',
  'benfica', 'porto', 'ajax',
];

const TAQUILLEROS = {
  mlb: ['yankees', 'dodgers', 'red sox', 'mets', 'cubs', 'braves'],
  mx: ['america', 'chivas', 'guadalajara', 'cruz azul', 'pumas', 'tigres', 'monterrey'],
  nfl: ['cowboys', 'chiefs', 'eagles', '49ers', 'packers', 'bills', 'ravens', 'lions', 'steelers', 'patriots'],
  epl: ['man united', 'man city', 'liverpool', 'arsenal', 'chelsea', 'spurs', 'tottenham'],
  laliga: ['real madrid', 'barcelona', 'atletico'],
  bundesliga: ['bayern', 'dortmund', 'leverkusen'],
  seriea: ['inter', 'milan', 'juventus', 'napoli', 'roma'],
  ligue1: ['psg', 'paris', 'marseille', 'monaco'],
  /* Torneos europeos: juegan los grandes de todas las ligas. */
  ucl: EUROPA_GRANDES,
  uel: EUROPA_GRANDES,
  uecl: EUROPA_GRANDES,
};

/* Cuántos equipos taquilleros hay en el partido (0, 1 o 2). */
function cuantosGrandes(liga, home, away) {
  const lista = TAQUILLEROS[liga] || [];
  if (!lista.length) return 0;
  const grande = n => { const x = normaliza(n); return lista.some(t => x.includes(t)); };
  return (grande(home) ? 1 : 0) + (grande(away) ? 1 : 0);
}

/* Qué tan atractivo es ese porcentaje para regalarlo: 1 en el punto
   dulce, 0.4 en los bordes de la banda y cayendo rápido fuera. Un 93%
   puntúa ~5 veces peor que un 70%. */
function atractivo(prob) {
  if (!(prob > 0)) return 0;
  const { piso, ideal, techo } = BANDA;
  if (prob >= piso && prob <= techo) {
    const lado = prob <= ideal
      ? (prob - piso) / (ideal - piso)
      : (techo - prob) / (techo - ideal);
    return 0.4 + 0.6 * lado;
  }
  const fuera = prob < piso ? piso - prob : prob - techo;
  return Math.max(0.02, 0.4 - fuera * 3);
}

/* El veredicto que la card le enseña al visitante: manda el BET (y
   entre BETs, el de más probabilidad); si no hay, el mejor de los
   demás. Es el mismo orden que usa el front, así que se puntúa
   exactamente lo que el cliente va a ver. */
const RANGO = { bet: 3, maybe: 2, skip: 1 };
function veredictoMostrado(verdicts) {
  const list = (verdicts || []).filter(v => v && v.label);
  if (!list.length) return null;
  return list.slice().sort((a, b) => {
    const d = (RANGO[b.verdict] || 0) - (RANGO[a.verdict] || 0);
    return d !== 0 ? d : (b.prob || 0) - (a.prob || 0);
  })[0];
}

/* Castigos por tipo de veredicto. Un SKIP es el modelo diciendo "no
   juegues esto": de pick gratis no sirve, así que solo sale si en toda
   la jornada no hay nada mejor. Un MAYBE penaliza poco — lo justo para
   que un BET dentro de la banda le gane, pero no tanto como para
   preferir un BET cantado de 90% sobre un MAYBE de 70%. */
const PENA_VEREDICTO = { bet: 0, maybe: -0.35, skip: -5 };
const SIN_VEREDICTO = -8;

/* Castigo del partidazo: -3 lo deja debajo de CUALQUIER partido normal
   con veredicto útil, pero encima de un SKIP. Si la única jornada
   posible fuera "clásicos con BET o partidos sin pick", se prefiere el
   clásico: enseñar un SKIP es peor producto que enseñar un grande. */
const PENA_PARTIDAZO = -3;
const PENA_UN_GRANDE = -0.05;

/* Evalúa un partido ya normalizado.
   { liga, home, away, verdicts } → { partidazo, score, verdicto } */
function evalua({ liga, home, away, verdicts }) {
  const v = veredictoMostrado(verdicts);
  const grandes = cuantosGrandes(liga, home, away);
  const score = atractivo(v ? v.prob : 0)
    + (v ? (PENA_VEREDICTO[v.verdict] != null ? PENA_VEREDICTO[v.verdict] : -5) : SIN_VEREDICTO)
    + (grandes >= 2 ? PENA_PARTIDAZO : grandes === 1 ? PENA_UN_GRANDE : 0);
  return { partidazo: grandes >= 2, score, verdicto: v };
}

/* Elige el mejor de una lista. `normalizar` convierte el objeto de
   cada modelo al shape que espera evalua(). */
function elegir(games, normalizar) {
  const evaluados = (games || []).map(g => ({ g, ...evalua(normalizar(g)) }));
  if (!evaluados.length) return null;
  return evaluados.reduce((a, b) => (b.score > a.score ? b : a)).g;
}

/* Puntaje suelto — lo usan NFL y Europa, que además comparan contra el
   partido ya clavado en el KV para no re-elegir sin motivo. */
function puntaje(norm) {
  return evalua(norm).score;
}

/* Veredicto FORZADO por un override: cuando el dueño fija qué mercado
   debe enseñar la card (p. ej. "ambos anotan" en un Barcelona–Levante
   para una campaña). Se busca por texto dentro del label, sin acentos,
   y si ese mercado no existe en el partido regresa null — el llamador
   cae al veredicto normal en vez de mostrar algo vacío. */
function veredictoForzado(verdicts, mercado) {
  if (!mercado) return null;
  const m = normaliza(mercado);
  if (!m) return null;
  return (verdicts || []).find(v => v && v.label && normaliza(v.label).includes(m)) || null;
}

/* El veredicto que debe enseñar la card: el forzado si el override lo
   fija y existe; si no, el que manda por rango y probabilidad. */
function veredictoDeCard(verdicts, mercado) {
  return veredictoForzado(verdicts, mercado) || veredictoMostrado(verdicts);
}

module.exports = { elegir, evalua, puntaje, atractivo, cuantosGrandes, veredictoMostrado, veredictoForzado, veredictoDeCard, normaliza, BANDA, TAQUILLEROS };
