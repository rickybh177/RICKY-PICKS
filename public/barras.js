/* ============================================================
   Barras "de un vistazo" para cada partido (27-oct-2026).

   Dos barras apiladas, iguales en todos los modelos:
   - Modelo: probabilidad de ganar de cada lado (y del empate en
     fútbol), tal como la calcula el modelo.
   - Dinero: dónde lo pusieron las casas — la probabilidad implícita
     de sus momios de moneyline, sin la comisión (devig). Es lo que el
     mercado ya cobra; si el modelo y el dinero no coinciden, ahí está
     la historia del partido.

   Uso: barrasPartido(lados, modelo, momios)
     lados  = ['PIT', 'Empate', 'TB']   (2 o 3, en el orden de la card)
     modelo = [0.45, 0.25, 0.30]        (probabilidades del modelo)
     momios = [-150, +240, +400]        (momios americanos de las casas)
   Cualquiera de las dos barras se omite si le faltan datos.
   ============================================================ */
(function () {
  const css =
    '.bx{margin:14px 0 4px;display:grid;gap:10px}' +
    '.bx-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--faint,#8a93a3)}' +
    '.bx-h b{color:var(--muted,#667084);font-weight:700}' +
    '.bx-bar{display:flex;height:10px;border-radius:99px;overflow:hidden;background:var(--g2,#eef2f7);gap:2px}' +
    '.bx-bar i{display:block;height:100%;min-width:3px}' +
    '.bx-bar i.s0{background:var(--text,#14181e)}.bx-bar i.sd{background:var(--line-2,#d8dfe9)}.bx-bar i.s1{background:var(--blue,#2f7bff)}' +
    '.bx-row.money .bx-bar i.s0{background:#5b6475}.bx-row.money .bx-bar i.s1{background:#8db4ff}' +
    '.bx-v{display:flex;justify-content:space-between;margin-top:5px;font-size:.78rem;color:var(--muted,#667084);font-variant-numeric:tabular-nums}' +
    '.bx-v span{white-space:nowrap}.bx-v strong{color:var(--text,#14181e);font-weight:700}';
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const imp = a => { const n = Number(a); if (!isFinite(n) || n === 0) return null; return n > 0 ? 100 / (n + 100) : -n / (-n + 100); };
  const pct = p => Math.round(p * 100) + '%';

  /* Normaliza a 100% (el modelo puede traer redondeos; los momios, la
     comisión de la casa). null si falta algún lado. */
  function norm(ps) {
    if (!ps || ps.some(p => p == null || !isFinite(p) || p < 0)) return null;
    const s = ps.reduce((a, b) => a + b, 0);
    return s > 0 ? ps.map(p => p / s) : null;
  }

  function bar(cls, titulo, nota, lados, ps) {
    const n = ps.length;
    const segCls = i => (i === 0 ? 's0' : i === n - 1 ? 's1' : 'sd');
    const segs = ps.map((p, i) => '<i class="' + segCls(i) + '" style="flex:' + Math.max(p, 0.001).toFixed(4) + '"></i>').join('');
    const fav = ps.indexOf(Math.max(...ps));
    const vals = ps.map((p, i) => '<span>' + esc(lados[i]) + ' ' + (i === fav ? '<strong>' + pct(p) + '</strong>' : pct(p)) + '</span>').join('');
    return '<div class="' + cls + '"><div class="bx-h"><b>' + titulo + '</b><span>' + nota + '</span></div>' +
      '<div class="bx-bar">' + segs + '</div><div class="bx-v">' + vals + '</div></div>';
  }

  window.barrasPartido = function (lados, modelo, momios) {
    const pm = norm(modelo);
    const pk = momios ? norm(momios.map(imp)) : null;
    if (!pm && !pk) return '';
    return '<div class="bx">' +
      (pm ? bar('bx-row', 'Modelo', 'Probabilidad de ganar', lados, pm) : '') +
      (pk ? bar('bx-row money', 'Dónde está el dinero', 'Momios de las casas', lados, pk) : '') +
      '</div>';
  };
})();
