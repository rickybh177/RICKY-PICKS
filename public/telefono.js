/* ============================================================
   TELÉFONO: lista de países con bandera y lada, y la regla para
   dejarlo en formato internacional. La usan los dos formularios de
   alta (index.html, checkout.html) y el aviso para quien ya tenía
   cuenta (telefono-aviso.js), así los tres piden el número igual:
   el cliente elige la banderita (México por defecto) y escribe su
   número local, sin "+" ni lada de país.
   ============================================================ */
window.DattipTel = (function () {
  /* c: país, f: bandera, p: lada, n: dígitos del número local (null = libre) */
  var PAISES = [
    { c: 'MX', f: '🇲🇽', p: '52', n: 10, nombre: 'México' },
    { c: 'US', f: '🇺🇸', p: '1', n: 10, nombre: 'Estados Unidos' },
    { c: 'CA', f: '🇨🇦', p: '1', n: 10, nombre: 'Canadá' },
    { c: 'ES', f: '🇪🇸', p: '34', n: 9, nombre: 'España' },
    { c: 'CO', f: '🇨🇴', p: '57', n: 10, nombre: 'Colombia' },
    { c: 'AR', f: '🇦🇷', p: '54', n: null, nombre: 'Argentina' },
    { c: 'CL', f: '🇨🇱', p: '56', n: 9, nombre: 'Chile' },
    { c: 'PE', f: '🇵🇪', p: '51', n: 9, nombre: 'Perú' },
    { c: 'EC', f: '🇪🇨', p: '593', n: 9, nombre: 'Ecuador' },
    { c: 'VE', f: '🇻🇪', p: '58', n: 10, nombre: 'Venezuela' },
    { c: 'GT', f: '🇬🇹', p: '502', n: 8, nombre: 'Guatemala' },
    { c: 'HN', f: '🇭🇳', p: '504', n: 8, nombre: 'Honduras' },
    { c: 'SV', f: '🇸🇻', p: '503', n: 8, nombre: 'El Salvador' },
    { c: 'NI', f: '🇳🇮', p: '505', n: 8, nombre: 'Nicaragua' },
    { c: 'CR', f: '🇨🇷', p: '506', n: 8, nombre: 'Costa Rica' },
    { c: 'PA', f: '🇵🇦', p: '507', n: 8, nombre: 'Panamá' },
    { c: 'DO', f: '🇩🇴', p: '1', n: 10, nombre: 'República Dominicana' },
    { c: 'PR', f: '🇵🇷', p: '1', n: 10, nombre: 'Puerto Rico' },
    { c: 'BR', f: '🇧🇷', p: '55', n: 11, nombre: 'Brasil' },
    { c: 'UY', f: '🇺🇾', p: '598', n: null, nombre: 'Uruguay' },
    { c: 'PY', f: '🇵🇾', p: '595', n: null, nombre: 'Paraguay' },
    { c: 'BO', f: '🇧🇴', p: '591', n: 8, nombre: 'Bolivia' },
    { c: 'CU', f: '🇨🇺', p: '53', n: 8, nombre: 'Cuba' },
  ];

  function pais(c) { return PAISES.find(function (x) { return x.c === c; }) || PAISES[0]; }

  /* <option> para un <select>; el value es el país (la lada se repite
     entre países, p. ej. +1). */
  function options(seleccionado) {
    return PAISES.map(function (x) {
      return '<option value="' + x.c + '"' + (x.c === (seleccionado || 'MX') ? ' selected' : '') + '>' + x.f + ' +' + x.p + '</option>';
    }).join('');
  }

  /* Número en formato internacional o null si no sirve. Si el cliente
     de todos modos escribe el "+", se respeta lo que escribió. Si
     repite la lada del país al inicio (52 + 10 dígitos), se le quita. */
  function norm(paisCodigo, raw) {
    var s = String(raw || '').trim();
    var d = s.replace(/\D/g, '');
    if (s.charAt(0) === '+') return (d.length >= 8 && d.length <= 15) ? '+' + d : null;
    var p = pais(paisCodigo);
    if (p.n && d.length === p.n + p.p.length && d.indexOf(p.p) === 0) d = d.slice(p.p.length);
    if (p.n ? d.length !== p.n : (d.length < 6 || d.length > 12)) return null;
    return '+' + p.p + d;
  }

  function mensaje(paisCodigo) {
    var p = pais(paisCodigo);
    return p.n ? 'Escribe tu teléfono a ' + p.n + ' dígitos, sin lada de país.' : 'Escribe un teléfono válido, sin lada de país.';
  }

  function placeholder(paisCodigo) {
    var p = pais(paisCodigo);
    return p.n ? p.n + ' dígitos' : 'tu número';
  }

  return { PAISES: PAISES, pais: pais, options: options, norm: norm, mensaje: mensaje, placeholder: placeholder };
})();
