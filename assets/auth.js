/* VolleyStats – accès admin (squelette, à compléter).
 * Contrat utilisé par sync.js et les pages :
 *   VS.admin.isAdmin()      → boolean (un code validé est mémorisé sur cet appareil)
 *   VS.admin.code()         → le code mémorisé, ou null
 *   VS.admin.login(code)    → Promise<boolean> (vérifie via la RPC vs_check_code, mémorise si OK)
 *   VS.admin.logout()
 *   VS.admin.require()      → à appeler en haut de saisie.html : demande le code ou renvoie vers le tableau de bord */
(function () {
  'use strict';
  const KEY = 'volleystats.adminCode';
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  VS.admin = {
    isAdmin: () => !!get(),
    code: get,
    login: async () => false,
    logout: () => { try { localStorage.removeItem(KEY); } catch (e) { /* rien */ } },
    require: () => true,
  };
})();
