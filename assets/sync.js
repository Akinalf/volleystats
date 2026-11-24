/* VolleyStats – synchronisation avec Supabase (squelette, à compléter).
 * Contrat :
 *   VS.sync.pull()   → Promise : récupère les matchs distants dans le localStorage
 *   VS.sync.push(m)  → Promise : envoie un match (admin uniquement)
 *   VS.sync.status() → 'off' | 'syncing' | 'ok' | 'offline' | 'error'
 *   événement window 'vs:remote-update' (detail: { ids: [...] }) quand des matchs distants ont changé localement. */
(function () {
  'use strict';
  VS.sync = {
    pull: async () => {},
    push: async () => {},
    status: () => 'off',
  };
})();
