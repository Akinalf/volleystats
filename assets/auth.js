/* VolleyStats – accès admin.
 * Contrat utilisé par sync.js et les pages :
 *   VS.admin.isAdmin()      → boolean (un code validé est mémorisé sur cet appareil)
 *   VS.admin.code()         → le code mémorisé, ou null
 *   VS.admin.login(code)    → Promise<boolean> (vérifie via la RPC vs_check_code, mémorise si OK)
 *   VS.admin.logout()
 *   VS.admin.require()      → à appeler en haut de saisie.html : true si admin (synchrone, sans réseau) ;
 *                             sinon masque la page, demande le code et renvoie false (la page ne doit rien faire de plus).
 *   VS.admin.prompt(opts)   → Promise<boolean> : fenêtre de saisie du code (utilisée par l’en-tête et require).
 *
 * Sécurité : masquer des boutons côté client n’est que de l’ergonomie. La vraie protection est côté serveur :
 * toute écriture passe par une RPC qui vérifie le code (stocké haché). Aucun code n’est écrit dans ce fichier. */
(function () {
  'use strict';
  const KEY = 'volleystats.adminCode';
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const set = (c) => { try { localStorage.setItem(KEY, c); return true; } catch (e) { return false; } };
  const clear = () => { try { localStorage.removeItem(KEY); } catch (e) { /* rien */ } };

  // Masque le contenu de la page tant que l’accès n’est pas validé (seule la fenêtre de code reste visible).
  const style = document.createElement('style');
  style.textContent = 'body.vs-locked>:not(.vs-modal-wrap):not(#vs-toasts){display:none!important}'
    + '.vs-auth-msg{min-height:18px;margin:6px 0 0;font-size:13px}.vs-auth-msg.err{color:#fca5a5}.vs-auth-msg.wait{color:var(--muted)}';
  document.head.appendChild(style);

  /* Vérifie un code auprès du serveur → 'ok' | 'bad' | 'offline' | 'error'. Lecture seule : aucune écriture. */
  async function check(code) {
    const cfg = window.VS_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return 'error';
    if (navigator.onLine === false) return 'offline';
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
    try {
      const res = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/vs_check_code', {
        method: 'POST',
        headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) return 'error';
      return (await res.json()) === true ? 'ok' : 'bad';
    } catch (e) {
      return 'offline'; // réseau coupé, serveur injoignable ou délai dépassé
    } finally { if (timer) clearTimeout(timer); }
  }

  let lastError = null;
  async function login(code) {
    code = String(code == null ? '' : code).trim();
    if (!code) { lastError = 'bad'; return false; }
    const r = await check(code);
    lastError = r === 'ok' ? null : r;
    if (r === 'ok') { set(code); return true; }
    return false;
  }
  function logout() { clear(); }

  const MSG = {
    bad: 'Code incorrect.',
    offline: 'Pas de connexion au serveur : impossible de vérifier le code. Réessayez une fois en ligne.',
    error: 'Le serveur n’a pas pu vérifier le code. Réessayez plus tard.',
  };

  /* Fenêtre de saisie du code. opts : { title, intro, locked, cancelLabel } → Promise<boolean>. */
  function prompt(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false, busy = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const intro = opts.intro || 'Entrez le code admin pour saisir et modifier les matchs sur cet appareil.';
      const dlg = VS.modal(opts.title || 'Accès admin', `<p class="muted small" style="margin:0 0 8px">${VS.esc(intro)}</p>
        <form id="vsAuthForm" autocomplete="off"><input type="password" id="vsAuthCode" placeholder="Code admin" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Code admin"></form>
        <p class="vs-auth-msg" id="vsAuthMsg" role="status"></p>`, [
        { label: opts.cancelLabel || 'Annuler', cls: 'ghost', onClick: () => { finish(false); } },
        { label: 'Se connecter', cls: 'primary', onClick: () => { submit(); return false; } },
      ], { locked: !!opts.locked });
      const w = dlg.el, input = w.querySelector('#vsAuthCode'), msg = w.querySelector('#vsAuthMsg');
      const okBtn = w.querySelector('.vs-modal-actions .primary');
      const say = (t, cls) => { msg.textContent = t; msg.className = 'vs-auth-msg' + (cls ? ' ' + cls : ''); };
      async function submit() {
        if (busy) return;
        const code = input.value.trim();
        if (!code) { say('Entrez le code.', 'err'); input.focus(); return; }
        busy = true; okBtn.disabled = true; say('Vérification…', 'wait');
        const ok = await login(code);
        busy = false; okBtn.disabled = false;
        if (ok) { finish(true); dlg.close(); return; }
        say(MSG[lastError] || MSG.error, 'err');
        input.select(); input.focus();
      }
      w.querySelector('#vsAuthForm').addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
      // Fermeture par Échap ou clic à côté (fenêtre non verrouillée) = annulation.
      new MutationObserver((_, obs) => { if (!w.isConnected) { obs.disconnect(); finish(false); } })
        .observe(document.body, { childList: true });
    });
  }

  /* Contrôle d’accès synchrone pour les pages réservées (saisie.html). */
  function require() {
    if (get()) return true; // déjà connecté : aucun appel réseau, la page se rend normalement
    document.body.classList.add('vs-locked');
    const back = 'tableau-de-bord.html' + location.search;
    prompt({ title: 'Saisie réservée à l’admin', locked: true, cancelLabel: 'Voir le tableau de bord',
      intro: 'La saisie des statistiques est réservée à l’admin. Entrez le code admin, ou consultez le tableau de bord.' })
      .then((ok) => { if (ok) location.reload(); else location.replace(back); });
    return false;
  }

  /* Vérification discrète, une fois par session, que le code mémorisé est toujours valable
   * (il a pu être changé côté serveur). Non bloquante ; hors ligne, on garde le code. */
  function revalidate() {
    const c = get(); if (!c) return;
    try { if (sessionStorage.getItem('volleystats.adminChecked') === c) return; } catch (e) { /* rien */ }
    check(c).then((r) => {
      if (r === 'ok') { try { sessionStorage.setItem('volleystats.adminChecked', c); } catch (e) { /* rien */ } }
      else if (r === 'bad' && get() === c) {
        clear();
        VS.toast('Le code admin a changé : reconnectez-vous.', 'error');
        setTimeout(() => location.reload(), 1500);
      }
    });
  }
  setTimeout(revalidate, 1500);

  VS.admin = {
    isAdmin: () => !!get(),
    code: get,
    login,
    logout,
    require,
    prompt,
    lastError: () => lastError,
  };
})();
