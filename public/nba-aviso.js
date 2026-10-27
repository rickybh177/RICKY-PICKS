/* ============================================================
   AVISO DE LANZAMIENTO — "Ya está disponible el modelo de NBA".

   Se muestra al entrar al sitio SOLO a quien tiene sesión iniciada, y
   solo sus primeras 3 visitas (regla del dueño, 27-oct-2026). El
   contador vive en los metadatos del usuario de Supabase
   (user_metadata.nba_aviso), así cuenta por CUENTA y no por aparato:
   si entra desde el celular y luego desde la compu, son 2 de las 3.
   Si Supabase no deja escribir, se respalda en localStorage.

   Para quitar el aviso cuando ya no haga falta: borrar el <script
   src="/nba-aviso.js"> de las páginas (index, mis-modelos, nfl, mlb,
   mx, europa). Para probarlo sin sesión en local: ?nba_aviso=test.
   ============================================================ */
(function () {
  var MAX = 3;
  var KEY = 'nba_aviso';
  var URL = 'https://juzfncioexyerhwweaui.supabase.co';
  var ANON = 'sb_publishable_9l3PIKomRJ5nQF3nXPXkgQ_0Osam0vj';

  function pinta() {
    if (document.getElementById('nbaAviso')) return;
    var css = document.createElement('style');
    css.textContent =
      '#nbaAviso{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-24px);opacity:0;z-index:9999;width:min(560px,calc(100% - 24px));' +
      'background:#fff;border:1px solid #d8dfe9;border-radius:16px;box-shadow:0 18px 50px -20px rgba(20,24,30,.45);padding:14px 16px;display:flex;align-items:center;gap:14px;' +
      "font-family:'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#14181e;transition:transform .35s ease,opacity .35s ease}" +
      '#nbaAviso.on{transform:translateX(-50%) translateY(0);opacity:1}' +
      '#nbaAviso .ball{width:42px;height:42px;border-radius:12px;background:rgba(47,123,255,.1);display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}' +
      '#nbaAviso .tx{flex:1;min-width:0}#nbaAviso .tx b{display:block;font-size:.95rem;letter-spacing:-.01em}#nbaAviso .tx small{display:block;color:#667084;font-size:.78rem;margin-top:2px;line-height:1.4}' +
      '#nbaAviso a.go{background:#1d4ed8;color:#fff;text-decoration:none;font-weight:700;font-size:.82rem;padding:10px 14px;border-radius:10px;white-space:nowrap}' +
      '#nbaAviso button.x{background:none;border:none;color:#8a93a3;font-size:18px;cursor:pointer;padding:4px;line-height:1}' +
      '@media (max-width:520px){#nbaAviso{flex-wrap:wrap}#nbaAviso .tx{flex-basis:calc(100% - 100px)}#nbaAviso a.go{flex:1;text-align:center}}';
    document.head.appendChild(css);
    var el = document.createElement('div');
    el.id = 'nbaAviso';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="ball">🏀</div>' +
      '<div class="tx"><b>Ya está disponible el modelo de NBA</b><small>Cada juego calculado posesión por posesión, con las bajas del día descontadas. Pick gratis todos los días.</small></div>' +
      '<a class="go" href="/nba.html">Ver NBA</a>' +
      '<button class="x" aria-label="Cerrar">×</button>';
    document.body.appendChild(el);
    var cierra = function () { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 400); };
    el.querySelector('button.x').addEventListener('click', cierra);
    requestAnimationFrame(function () { el.classList.add('on'); });
    setTimeout(cierra, 15000);
  }

  async function main() {
    var test = /[?&]nba_aviso=test/.test(location.search);
    if (test) { pinta(); return; }
    if (!window.supabase || !window.supabase.createClient) return;
    var sb;
    try { sb = window.supabase.createClient(URL, ANON); } catch (e) { return; }
    var session = null;
    try { var r = await sb.auth.getSession(); session = r && r.data && r.data.session; } catch (e) {}
    if (!session || !session.user) return; // solo cuentas con sesión
    var user = session.user;
    var local = 0;
    try { local = Number(localStorage.getItem(KEY + '_' + user.id) || 0); } catch (e) {}
    var meta = Number((user.user_metadata || {})[KEY] || 0);
    var n = Math.max(meta, local);
    if (n >= MAX) return;
    pinta();
    n++;
    try { localStorage.setItem(KEY + '_' + user.id, String(n)); } catch (e) {}
    try { var d = {}; d[KEY] = n; await sb.auth.updateUser({ data: d }); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
