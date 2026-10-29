/* ============================================================
   Descripción de un prop en palabras de cliente (28-oct-2026).

   El TÍTULO del renglón es el nombre exacto del mercado con su línea,
   tal como aparece en la casa de apuestas, para que se vea de un
   vistazo a qué meterle (igual que "Hándicap: Steelers -3.5"):

     Recepciones: Más de 2.5

   La línea de abajo, que antes era "modelo 3 ± 1.3 · Más de 2.5 · 62%
   · ventaja +35.8%", ahora dice dos cosas que se entienden de un jalón:

     62% de que pase · Vale la pena: la casa paga de más

   - la probabilidad del modelo;
   - si conviene por lo que paga la casa (ventaja = ev del endpoint).

   Lo usan la página de compra, los modelos NFL y NBA y la lámina de
   Instagram (lib/ig/plan.js lo carga con require).
   ============================================================ */
(function (root) {
  /* "Más de 2.5" / "Menos de 24.5" / "Sí" / "No" */
  function propLado(mk) {
    if (!mk || !mk.line) return null;
    if (mk.key === 'anytime_td' || mk.key === 'dd') return mk.side === 'no' ? 'No' : 'Sí';
    if (mk.line.point == null) return null;
    return (mk.side === 'under' ? 'Menos de ' : 'Más de ') + mk.line.point;
  }

  /* "Recepciones: Más de 2.5" — sin línea, solo el mercado. */
  function propTitulo(mk) {
    const lado = propLado(mk);
    return (mk && mk.label || '') + (lado ? ': ' + lado : '');
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
    return [propProb(mk && mk.p), valor].filter(Boolean).join(' · ');
  }

  const api = { propLado, propTitulo, propProb, propValor, propDescripcion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : this);
