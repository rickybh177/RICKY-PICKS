/* ============================================================
   HUELLA: qué hace cada cliente con sesión iniciada (1-nov-2026).

   El sitio solo sabía la última vez que alguien tecleó su
   contraseña, y como la sesión se queda abierta en el teléfono ese
   dato miente. Esto avisa a /api/huella cuando un usuario CON SESIÓN
   abre una página (qué liga ve y desde qué aparato) y cuántos
   segundos se quedó. Sin sesión no se manda nada, y nunca se manda
   nada que el usuario escriba.

   Se guarda como resumen por día (lib/uso.js), no clic por clic.
   ============================================================ */
(function () {
  var URL = 'https://juzfncioexyerhwweaui.supabase.co';
  var ANON = 'sb_publishable_9l3PIKomRJ5nQF3nXPXkgQ_0Osam0vj';
  var LIGA_PAGINA = { '/nfl.html': 'nfl', '/mlb.html': 'mlb', '/mx.html': 'mx', '/nba.html': 'nba', '/nhl.html': 'nhl' };
  var EURO = ['epl', 'laliga', 'bundesliga', 'ucl', 'seriea', 'ligue1', 'uel', 'uecl', 'mls'];

  function liga() {
    var p = location.pathname;
    if (LIGA_PAGINA[p]) return LIGA_PAGINA[p];
    if (p === '/europa.html') {
      var l = new URLSearchParams(location.search).get('liga');
      return EURO.indexOf(l) >= 0 ? l : 'epl';
    }
    return null;
  }
  function sid() {
    try {
      var s = sessionStorage.getItem('dattip_sid');
      if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('dattip_sid', s); }
      return s;
    } catch (e) { return null; }
  }

  async function arranca() {
    if (!window.supabase || !window.supabase.createClient) return;
    var sb;
    try { sb = window.supabase.createClient(URL, ANON); } catch (e) { return; }
    var r = await sb.auth.getSession();
    var ses = r && r.data && r.data.session;
    if (!ses) return;   // sin sesión no se registra nada

    var token = ses.access_token;
    var base = {
      pagina: location.pathname,
      liga: liga(),
      sid: sid(),
      movil: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
    };
    function manda(evento, extra) {
      var body = JSON.stringify(Object.assign({ evento: evento }, base, extra || {}));
      try {
        fetch('/api/huella', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: body }).catch(function () {});
      } catch (e) {}
    }

    var inicio = Date.now(), salio = false;
    manda('pagina');
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && !salio) {
        salio = true;
        manda('salida', { segundos: Math.round((Date.now() - inicio) / 1000) });
      } else if (document.visibilityState === 'visible' && salio) {
        /* volvió a la pestaña: cuenta como otra visita */
        salio = false; inicio = Date.now(); manda('pagina');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranca);
  else arranca();
})();
