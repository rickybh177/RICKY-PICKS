/* ============================================================
   Descripción de un prop en palabras de cliente (28-oct-2026).

   El TÍTULO del renglón se queda con el nombre exacto del mercado
   ("Recepciones", "Anota TD (anytime)"): es lo que el cliente busca en
   su casa de apuestas. Lo que cambia es la línea de abajo, que antes
   era "modelo 3 ± 1.3 · Más de 2.5 · 62% · ventaja +35.8%" y ahora
   dice tres cosas que se entienden de un jalón:

     Más de 2.5 · 62% de que pase · Vale la pena: la casa paga de más

   - el lado y la línea, tal como aparecen en la casa;
   - la probabilidad del modelo;
   - si conviene por lo que paga la casa (ventaja = ev del endpoint).

   Lo usan la página de compra, los modelos NFL y NBA y la lámina de
   Instagram (lib/ig/plan.js lo carga con require).
   ============================================================ */
(function (root) {
  /* "Más de 2.5" / "Menos de 24.5" / "Sí anota" / "No" */
  function propLado(mk) {
    if (!mk || !mk.line) return null;
    if (mk.key === 'anytime_td') return mk.side === 'no' ? 'No anota' : 'Sí anota';
    if (mk.key === 'dd') return mk.side === 'no' ? 'No hace doble-doble' : 'Sí hace doble-doble';
    if (mk.line.point == null) return null;
    return (mk.side === 'under' ? 'Menos de ' : 'Más de ') + mk.line.point;
  }

  /* 0.624 → "62% de que pase" */
  function propProb(p) {
    return p == null ? null : Math.round(p * 100) + '% de que pase';
  }

  /* ¿Conviene por lo que paga la casa? Se lee con el mismo veredicto
     del chip para que nunca se contradigan: un PICK siempre "vale la
     pena"; un MAYBE con mucha ventaja es uno al que el modelo le puso
     tope por duda (lesión, cambio de rol), y lo dice. */
  function propValor(mk) {
    if (!mk || !mk.line || mk.ev == null) return null;
    const ev = mk.ev;
    if (mk.verdict === 'bet') return 'Vale la pena: la casa paga de más';
    if (mk.verdict === 'maybe') return ev >= 0.04 ? 'Con cuidado: la casa paga de más, pero hay duda'
      : 'Vale poco: la casa paga apenas de más';
    if (ev < 0) return 'No vale la pena: la casa paga de menos';
    if (ev < 0.015) return 'No vale la pena: la casa paga lo justo';
    return 'No vale la pena: pasa muy pocas veces';
  }

  /* La línea completa de abajo. `corta` deja solo el veredicto, sin el
     porqué ("Vale la pena"): la lámina de Instagram no tiene espacio. */
  function propDescripcion(mk, corta) {
    let valor = propValor(mk);
    if (valor && corta) valor = valor.split(':')[0];
    return [propLado(mk), propProb(mk && mk.p), valor].filter(Boolean).join(' · ');
  }

  const api = { propLado, propProb, propValor, propDescripcion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : this);
