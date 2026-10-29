/* ============================================================
   Props en palabras de cliente (28-oct-2026).

   Antes cada prop se leía "modelo 3 ± 1.3 · Más de 2.5 · 62%": cuatro
   números y ninguno decía qué apostar. Ahora el renglón ES la apuesta,
   dicha como la diría quien la juega:

     receptions, Más de 2.5   →  "Jeudy agarra 3 pases o más"
     pts, Menos de 24.5       →  "Agarra… / Mete 24 puntos o menos"
     anytime_td, sí           →  "Sampson anota touchdown"
     probabilidad 0.62        →  "Pasa 62 de cada 100 veces"

   Las líneas .5 se vuelven el número entero que hay que alcanzar
   (Más de 2.5 = 3 o más; Menos de 2.5 = 2 o menos). Una línea entera
   se deja como "más de / menos de" porque el empate se devuelve.

   Se usa igual en la página de compra, en los modelos NFL y NBA y en la
   lámina de Instagram (lib/ig/plan.js lo carga con require), así que
   un mercado nuevo se agrega aquí una sola vez.
   ============================================================ */
(function (root) {
  /* verbo + sustantivo (singular, plural) */
  const MERCADOS = {
    // NFL
    pass_yds:         ['lanza', 'yarda', 'yardas'],
    pass_tds:         ['lanza', 'pase de touchdown', 'pases de touchdown'],
    pass_completions: ['completa', 'pase', 'pases'],
    rush_yds:         ['corre', 'yarda', 'yardas'],
    reception_yds:    ['recibe', 'yarda', 'yardas'],
    receptions:       ['agarra', 'pase', 'pases'],
    // NBA
    pts:              ['mete', 'punto', 'puntos'],
    reb:              ['agarra', 'rebote', 'rebotes'],
    ast:              ['da', 'asistencia', 'asistencias'],
    tpm:              ['mete', 'triple', 'triples'],
    pra:              ['suma', 'entre puntos, rebotes y asistencias', 'entre puntos, rebotes y asistencias'],
  };
  /* Para "no ___ ningún pase" cuando la línea es Menos de 0.5. */
  const NINGUN = { pass_tds: 'ningún pase de touchdown', pass_completions: 'ningún pase', receptions: 'ningún pase',
    tpm: 'ningún triple', reb: 'ningún rebote', ast: 'ninguna asistencia', pts: 'ningún punto' };

  const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* "Jerry Jeudy" → "Jeudy"; "Amon-Ra St. Brown" → "St. Brown". */
  function apellido(nombre) {
    const t = String(nombre || '').trim().split(/\s+/);
    return t.length > 1 ? t.slice(1).join(' ') : t[0] || '';
  }

  function cantidad(def, n, extremo) {
    const [, uno, varios] = def;
    // "pra" no lleva sustantivo contable: "suma 30 o más entre puntos…"
    const partes = uno === varios ? [n, extremo, uno] : [n, n === 1 ? uno : varios, extremo];
    return partes.filter(x => x !== '').join(' ');
  }

  /* La apuesta en una frase. Sin línea publicada devuelve null (para
     eso está propProyeccion). Sin nombre, la frase empieza con el verbo
     en mayúscula: se usa bajo el encabezado del jugador. */
  function propFrase(mk, nombre) {
    if (!mk || !mk.line) return null;
    const quien = nombre ? apellido(nombre) + ' ' : '';
    const arma = s => quien ? quien + s : mayus(s);
    if (mk.key === 'anytime_td') return arma(mk.side === 'no' ? 'no anota touchdown' : 'anota touchdown');
    if (mk.key === 'dd') return arma(mk.side === 'no' ? 'no hace doble-doble' : 'hace doble-doble');
    const def = MERCADOS[mk.key];
    const L = mk.line.point;
    if (!def || L == null) return null;
    const entera = Number.isInteger(L);
    if (mk.side === 'under') {
      const n = entera ? L : Math.floor(L);
      if (!entera && n === 0 && NINGUN[mk.key]) return arma('no ' + def[0] + ' ' + NINGUN[mk.key]);
      return arma(def[0] + ' ' + (entera ? 'menos de ' + cantidad(def, n, '') : cantidad(def, n, 'o menos')));
    }
    const n = entera ? L : Math.ceil(L);
    return arma(def[0] + ' ' + (entera ? 'más de ' + cantidad(def, n, '') : cantidad(def, n, 'o más')));
  }

  /* Sin línea todavía: lo que espera el modelo, en la misma voz.
     "Mete unos 25 puntos" / "Corre unas 62 yardas" / "Anota touchdown". */
  function propProyeccion(mk, nombre) {
    if (!mk || !mk.model) return null;
    const quien = nombre ? apellido(nombre) + ' ' : '';
    const arma = s => quien ? quien + s : mayus(s);
    // sí/no: la frase es el evento; qué tan seguido pasa va debajo
    if (mk.key === 'anytime_td') return arma('anota touchdown');
    if (mk.key === 'dd') return arma('hace doble-doble');
    const def = MERCADOS[mk.key];
    if (!def || mk.model.mu == null) return null;
    const n = Math.round(mk.model.mu);
    if (def[1] === def[2]) return arma(def[0] + ' unos ' + n + ' ' + def[1]);
    const unos = n === 1 ? '' : /as$/.test(def[2]) ? 'unas ' : 'unos ';
    return arma(def[0] + ' ' + unos + n + ' ' + (n === 1 ? def[1] : def[2]));
  }

  /* 0.62 → "Pasa 62 de cada 100 veces" */
  function propVeces(p) {
    if (p == null) return null;
    return 'Pasa ' + Math.round(p * 100) + ' de cada 100 veces';
  }

  const api = { propFrase, propProyeccion, propVeces, apellido };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : this);
