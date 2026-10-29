/* ============================================================
   TELÉFONO PARA QUIEN YA TENÍA CUENTA.

   Desde el 28-oct-2026 crear cuenta exige teléfono. Los clientes de
   antes no lo tienen; el dueño pidió pedírselo "cuando entren". Este
   script corre en todas las páginas con sesión: si el usuario entró y
   su cuenta no trae `user_metadata.telefono`, abre un modal que lo
   pide y lo guarda con `auth.updateUser`. Es OBLIGATORIO (decisión
   del dueño, 28-oct-2026): no hay opción de posponer ni forma de
   cerrarlo sin dar el número.

   También escucha el inicio de sesión en la misma página (el modal
   del landing) para pedirlo justo después de entrar.

   Necesita /telefono.js cargado antes (lista de países y regla del
   número). Probar sin sesión en local: ?telefono=test.
   ============================================================ */
(function () {
  var URL = 'https://juzfncioexyerhwweaui.supabase.co';
  var ANON = 'sb_publishable_9l3PIKomRJ5nQF3nXPXkgQ_0Osam0vj';
  var abierto = false;

  /* La regla y la lista de países viven en /telefono.js (compartidas
     con los formularios de alta). */
  var T = window.DattipTel;

  function pinta(onSave) {
    if (abierto || document.getElementById('telAviso')) return;
    abierto = true;
    var css = document.createElement('style');
    css.textContent =
      '#telAviso{position:fixed;inset:0;z-index:9998;background:rgba(10,13,19,.55);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .25s ease}' +
      '#telAviso.on{opacity:1}' +
      "#telAviso .box{background:#fff;color:#14181e;border-radius:18px;width:min(420px,100%);padding:26px 24px 20px;box-shadow:0 24px 60px -24px rgba(0,0,0,.5);font-family:'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      '#telAviso h3{margin:0 0 6px;font-size:1.2rem;letter-spacing:-.02em}#telAviso p{margin:0 0 16px;color:#667084;font-size:.9rem;line-height:1.45}' +
      '#telAviso label{display:block;font-family:"JetBrains Mono",monospace;font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a93a3;margin-bottom:6px}' +
      '#telAviso .row{display:flex;gap:8px}' +
      '#telAviso input,#telAviso select{box-sizing:border-box;font:inherit;font-size:1rem;padding:13px 14px;border:1.5px solid #d8dfe9;border-radius:12px;outline:none;background:#f6f8fb;color:#14181e}' +
      '#telAviso input{flex:1;min-width:0}#telAviso select{flex:none;width:auto;padding-right:8px}#telAviso input:focus,#telAviso select:focus{border-color:#2f7bff;background:#fff}' +
      '#telAviso button.ok{width:100%;margin-top:12px;font:inherit;font-weight:700;font-size:.95rem;padding:13px;border:none;border-radius:12px;background:#1d4ed8;color:#fff;cursor:pointer}#telAviso button.ok:disabled{opacity:.6}' +
      '#telAviso .msg{min-height:18px;font-size:.82rem;color:#d93a3a;margin-top:8px}';
    document.head.appendChild(css);
    var el = document.createElement('div');
    el.id = 'telAviso';
    el.setAttribute('role', 'dialog');
    el.innerHTML =
      '<div class="box">' +
      '<h3>Verifica tu cuenta</h3>' +
      '<p>Por seguridad te pedimos tu número de teléfono. Lo usamos solo para avisos de tu cuenta por WhatsApp y no lo compartimos con nadie.</p>' +
      '<label for="telAvisoInput">Teléfono (WhatsApp)</label>' +
      '<div class="row"><select id="telAvisoPais" aria-label="País">' + T.options('MX') + '</select>' +
      '<input id="telAvisoInput" type="tel" inputmode="tel" autocomplete="tel" placeholder="10 dígitos"></div>' +
      '<div class="msg" id="telAvisoMsg"></div>' +
      '<button class="ok" id="telAvisoOk">Guardar</button>' +
      '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('on'); });
    var cierra = function () { el.classList.remove('on'); setTimeout(function () { el.remove(); abierto = false; }, 250); };
    var input = el.querySelector('#telAvisoInput'), msg = el.querySelector('#telAvisoMsg'), ok = el.querySelector('#telAvisoOk');
    var paisSel = el.querySelector('#telAvisoPais');
    paisSel.addEventListener('change', function () { input.placeholder = T.placeholder(paisSel.value); });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 300);
    var guarda = async function () {
      var tel = T.norm(paisSel.value, input.value);
      if (!tel) { msg.textContent = T.mensaje(paisSel.value); return; }
      ok.disabled = true; ok.textContent = 'Guardando…'; msg.textContent = '';
      try { await onSave(tel); cierra(); }
      catch (e) { msg.textContent = 'No se pudo guardar. Intenta de nuevo.'; ok.disabled = false; ok.textContent = 'Guardar'; }
    };
    ok.addEventListener('click', guarda);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') guarda(); });
  }

  function revisa(sb, user) {
    if (!user) return;
    if (user.user_metadata && user.user_metadata.telefono) return;
    pinta(async function (tel) {
      var r = await sb.auth.updateUser({ data: { telefono: tel } });
      if (r && r.error) throw r.error;
    });
  }

  async function main() {
    if (!T) return;
    if (/[?&]telefono=test/.test(location.search)) { pinta(async function () {}); return; }
    var sb = null;
    try { if (window.supabase && window.supabase.createClient) sb = window.supabase.createClient(URL, ANON); } catch (e) {}
    if (!sb) return;
    try { var r = await sb.auth.getSession(); revisa(sb, r && r.data && r.data.session && r.data.session.user); } catch (e) {}
    /* quien inicia sesión en esta misma página (modal del landing) */
    try {
      sb.auth.onAuthStateChange(function (ev, s) {
        if (ev === 'SIGNED_IN' && s && s.user) setTimeout(function () { revisa(sb, s.user); }, 600);
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
