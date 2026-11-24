/* VolleyStats – synchronisation avec Supabase.
 * Contrat :
 *   VS.sync.pull()   → Promise : récupère les matchs distants dans le localStorage
 *   VS.sync.push(m)  → Promise : envoie un match (admin uniquement ; sans argument : tout ce qui est en attente)
 *   VS.sync.status() → 'off' | 'syncing' | 'ok' | 'offline' | 'error'
 *   événement window 'vs:remote-update' (detail: { ids: [...] }) quand des matchs distants ont changé localement.
 *   événement window 'vs:sync-status'   (detail: { status, message }) à chaque changement de statut.
 *
 * Principe :
 *   - Lecture : REST PostgREST (clé publishable), sondage toutes les ~12 s quand la page est visible.
 *     D'abord une liste légère (id, updated_at, deleted, data->updated), puis le contenu des seuls matchs à mettre à jour.
 *   - Méta locale (clé volleystats.syncmeta) : pour chaque match, r = updated_at distant connu, h = empreinte du contenu
 *     au dernier échange. Un match est « modifié localement non envoyé » si son empreinte actuelle ≠ h : c'est dérivé
 *     du contenu, donc la file d'attente survit aux rechargements / coupures sans rien stocker de plus.
 *     Les suppressions en attente sont dans meta.del.
 *   - Écriture (admin seulement) : RPC vs_upsert_match / vs_delete_match avec le code admin.
 *   - Le local modifié non envoyé est prioritaire sur le distant (on ne l'écrase jamais).
 *   - Le match d'exemple généré par l'app n'est jamais publié.
 *   - Toute erreur est absorbée : hors ligne ou sans Supabase, l'app marche comme avant. */
(function () {
  'use strict';
  if (!window.VS) return;

  const CFG = window.VS_CONFIG || {};
  const BASE = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = CFG.supabaseKey || '';
  const ENABLED = !!(BASE && KEY && window.fetch && window.localStorage);
  const META_KEY = 'syncmeta';
  const POLL_MS = 12000;
  const DEBOUNCE_MS = 1000;

  /* ---------------------------------------------------------------- outils */
  const isAdmin = () => { try { return !!(VS.admin && VS.admin.isAdmin()); } catch (e) { return false; } };
  const adminCode = () => { try { return (VS.admin && VS.admin.code()) || null; } catch (e) { return null; } };

  function loadMeta() {
    const m = VS.load(META_KEY, null);
    const meta = m && typeof m === 'object' ? m : {};
    if (!meta.matches || typeof meta.matches !== 'object') meta.matches = {};
    if (!Array.isArray(meta.del)) meta.del = [];
    return meta;
  }
  const saveMeta = (meta) => VS.save(META_KEY, meta);
  const allLocal = () => VS.load('matches', {}) || {};

  // Sérialisation canonique (clés triées, jsonb réordonne les clés) sans le champ « updated » (horodatage local seul).
  function canon(v, top) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map((x) => canon(x, false)).join(',') + ']';
    const keys = Object.keys(v).filter((k) => v[k] !== undefined && !(top && k === 'updated')).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k], false)).join(',') + '}';
  }
  function hash(m) {
    const s = canon(m, true);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + '.' + s.length.toString(36);
  }

  // Match d'exemple créé par VS.createDemoMatch() : adversaire « VC Exemple », compétition « Match d’exemple ».
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bc`´]/g, "'").trim().toLowerCase();
  function isDemo(m) {
    if (!m) return false;
    const comp = norm(m.comp), opp = norm(m.opp);
    return opp === 'vc exemple' || /^match d'?\s*exemple$/.test(comp);
  }

  function isDirty(m, meta) {
    if (!m || !m.id || isDemo(m)) return false;
    const e = meta.matches[m.id];
    return !e || e.h !== hash(m);
  }

  /* ---------------------------------------------------------------- statut */
  let status = ENABLED ? 'syncing' : 'off';
  let message = '';
  let lastOk = 0;
  function setStatus(s, msg) {
    const changed = s !== status || (msg || '') !== message;
    status = s; message = msg || '';
    if (s === 'ok') lastOk = Date.now();
    if (changed) {
      try { window.dispatchEvent(new CustomEvent('vs:sync-status', { detail: { status, message } })); } catch (e) { /* rien */ }
    }
    renderBadge();
  }

  /* ---------------------------------------------------------------- réseau */
  class NetError extends Error {}
  class HttpError extends Error { constructor(st, body) { super('HTTP ' + st); this.status = st; this.body = body; } }

  async function api(path, opts) {
    const o = opts || {};
    const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
    try {
      res = await fetch(BASE + path, {
        method: o.method || (o.body !== undefined ? 'POST' : 'GET'),
        headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) { throw new NetError(e && e.message || 'réseau'); } finally { if (timer) clearTimeout(timer); }
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) throw new HttpError(res.status, data);
    return data;
  }
  const rpc = (name, args) => api('/rest/v1/rpc/' + name, { body: args });
  const isCodeRefused = (e) => e instanceof HttpError && (e.status === 401 || e.status === 403 || (e.body && e.body.code === '28000'));

  /* --------------------------------------------- verrou (une opération à la fois) */
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  /* ---------------------------------------------------------------- pull */
  let pulledOnce = false;
  let refusedCode = null; // code refusé par le serveur : on n'essaie plus tant qu'il n'a pas changé

  function emitRemote(ids) {
    if (!ids.length) return;
    try { window.dispatchEvent(new CustomEvent('vs:remote-update', { detail: { ids } })); } catch (e) { /* rien */ }
  }

  async function doPull() {
    const rows = await api('/rest/v1/matches?select=id,updated_at,deleted,lu:data-%3Eupdated');
    if (!Array.isArray(rows)) throw new HttpError(0, rows);
    const admin = isAdmin();
    const meta = loadMeta();
    let local = allLocal();
    const toFetch = [], toDelete = [];
    const remoteIds = new Set();

    for (const r of rows) {
      if (!r || !r.id) continue;
      remoteIds.add(r.id);
      const lm = local[r.id], e = meta.matches[r.id];
      if (r.deleted) {
        if (meta.del.includes(r.id)) { meta.del = meta.del.filter((x) => x !== r.id); }
        if (lm && !(admin && e && isDirty(lm, meta))) toDelete.push(r.id); // admin : local modifié non envoyé prioritaire
        else if (!lm) delete meta.matches[r.id];
        continue;
      }
      if (admin && meta.del.includes(r.id)) continue; // suppression locale en attente d'envoi
      if (!lm) { toFetch.push(r.id); continue; }       // nouveau (ou supprimé localement chez un lecteur : on restaure)
      if (e && e.r === r.updated_at) continue; // déjà à jour
      if (admin) {
        if (e && isDirty(lm, meta)) continue;          // modifié localement non envoyé : prioritaire
        if (!e && typeof r.lu === 'number' && (lm.updated || 0) > r.lu) continue; // 1er contact : local plus récent → sera envoyé
      }
      toFetch.push(r.id);
    }
    // Matchs reçus autrefois puis disparus du serveur (purge) : chez un lecteur, on les retire.
    if (!admin) {
      for (const id of Object.keys(local)) {
        const e = meta.matches[id];
        if (e && e.r && !remoteIds.has(id)) toDelete.push(id);
      }
    }

    const fetched = {};
    for (let i = 0; i < toFetch.length; i += 20) {
      const ids = toFetch.slice(i, i + 20);
      const q = ids.map((id) => '"' + String(id).replace(/["\\]/g, '') + '"').join(',');
      const data = await api('/rest/v1/matches?select=id,data,deleted,updated_at&id=in.(' + encodeURIComponent(q) + ')');
      for (const r of data || []) if (r && r.id && !r.deleted && r.data && typeof r.data === 'object') fetched[r.id] = r;
    }

    // Application : on relit le localStorage juste avant d'écrire (une saisie a pu arriver entre-temps).
    const changed = [];
    local = allLocal();
    const metaNow = loadMeta();
    for (const id of toDelete) {
      if (!local[id]) continue;
      if (admin && metaNow.matches[id] && isDirty(local[id], metaNow)) continue; // modifié entre-temps : prioritaire
      delete local[id]; delete metaNow.matches[id]; changed.push(id);
    }
    for (const id of Object.keys(fetched)) {
      const r = fetched[id], lm = local[id], e = metaNow.matches[id];
      if (admin && lm && e && isDirty(lm, metaNow)) continue;
      if (admin && lm && !e && (lm.updated || 0) > (r.data.updated || 0)) continue;
      const m = r.data;
      if (!m.id) m.id = id;
      local[id] = m;
      metaNow.matches[id] = { r: r.updated_at, h: hash(m) };
      changed.push(id);
    }
    for (const r of rows) { // nettoyage des tombes connues
      if (r && r.deleted && !local[r.id]) { delete metaNow.matches[r.id]; metaNow.del = metaNow.del.filter((x) => x !== r.id); }
    }
    if (changed.length) {
      if (!VS.save('matches', local)) throw new Error('stockage local plein');
      const cur = VS.load('current', null);
      if (cur && !local[cur]) VS.save('current', null);
    }
    saveMeta(metaNow);
    pulledOnce = true;
    emitRemote(changed);
    return changed;
  }

  /* ---------------------------------------------------------------- push */
  function pendingCount() {
    if (!isAdmin()) return 0;
    const meta = loadMeta();
    return Object.values(allLocal()).filter((m) => isDirty(m, meta)).length + meta.del.length;
  }

  async function doPush(onlyId) {
    if (!isAdmin()) return 0;
    const code = adminCode();
    if (!code) return 0;
    if (refusedCode === code) throw Object.assign(new Error('code admin refusé'), { refused: true });
    let sent = 0;
    // 1. suppressions
    let meta = loadMeta();
    for (const id of meta.del.slice()) {
      try { await rpc('vs_delete_match', { code, match_id: id }); } catch (e) { if (isCodeRefused(e)) refusedCode = code; throw e; }
      meta = loadMeta();
      meta.del = meta.del.filter((x) => x !== id);
      delete meta.matches[id];
      saveMeta(meta); sent++;
    }
    // 2. matchs modifiés / jamais envoyés
    const local = allLocal();
    const ids = Object.keys(local).filter((id) => (!onlyId || id === onlyId) && isDirty(local[id], loadMeta()));
    for (const id of ids) {
      const m = allLocal()[id];
      if (!m || !isDirty(m, loadMeta())) continue;
      const h = hash(m);
      let ts;
      try { ts = await rpc('vs_upsert_match', { code, match_id: id, match_data: m }); } catch (e) { if (isCodeRefused(e)) refusedCode = code; throw e; }
      meta = loadMeta();
      meta.matches[id] = { r: typeof ts === 'string' ? ts : (meta.matches[id] && meta.matches[id].r) || null, h };
      saveMeta(meta); sent++;
    }
    return sent;
  }

  /* ---------------------------------------------------------------- cycle */
  let retryTimer = null, retryDelay = 5000;
  function handleError(e) {
    if (e && (e.refused || isCodeRefused(e))) { setStatus('error', 'Code admin refusé par le serveur : les modifications restent sur cet appareil.'); return; }
    if (e instanceof NetError || (typeof navigator !== 'undefined' && navigator.onLine === false)) setStatus('offline', 'Hors ligne : les modifications seront envoyées au retour du réseau.');
    else setStatus('error', 'Erreur de synchro' + (e && e.message ? ' (' + e.message + ')' : '') + '. Nouvel essai automatique.');
    try { console.warn('[VolleyStats sync]', e); } catch (x) { /* rien */ }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { sync(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 120000);
  }
  function finishOk() {
    retryDelay = 5000;
    if (isAdmin() && refusedCode && refusedCode === adminCode()) { setStatus('error', 'Code admin refusé par le serveur : les modifications restent sur cet appareil.'); return; }
    if (pendingCount() > 0) { schedulePush(); return; }
    setStatus('ok', 'Synchronisé');
  }

  // Cycle complet : lecture puis envoi de ce qui est en attente.
  function sync() {
    if (!ENABLED) return Promise.resolve([]);
    return serial(async () => {
      try {
        setStatus('syncing', isAdmin() && pendingCount() ? 'Envoi…' : 'Mise à jour…');
        const changed = await doPull();
        if (isAdmin() && adminCode() !== refusedCode && pendingCount()) { setStatus('syncing', 'Envoi…'); await doPush(); }
        finishOk();
        return changed;
      } catch (e) { handleError(e); return []; }
    });
  }

  let pushTimer = null;
  function schedulePush() {
    if (!ENABLED || !isAdmin()) return;
    if (refusedCode && refusedCode === adminCode()) { setStatus('error', 'Code admin refusé par le serveur : les modifications restent sur cet appareil.'); return; }
    setStatus('syncing', 'Envoi…');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (!pulledOnce) { sync(); return; } // on ne pousse qu'après avoir vu l'état distant au moins une fois
      serial(async () => {
        try { await doPush(); finishOk(); } catch (e) { handleError(e); }
      });
    }, DEBOUNCE_MS);
  }

  /* ---------------------------------------------- enveloppes saveMatch / deleteMatch */
  const origSave = VS.saveMatch, origDelete = VS.deleteMatch;
  VS.saveMatch = function (m) {
    const res = origSave.apply(this, arguments);
    try { if (ENABLED && isAdmin() && m && isDirty(m, loadMeta())) schedulePush(); } catch (e) { /* rien */ }
    return res;
  };
  VS.deleteMatch = function (id) {
    let m = null;
    try { m = VS.getMatch(id); } catch (e) { /* rien */ }
    const res = origDelete.apply(this, arguments);
    try {
      if (ENABLED && isAdmin() && id && !isDemo(m)) {
        const meta = loadMeta();
        if (!meta.del.includes(id)) meta.del.push(id);
        saveMeta(meta);
        schedulePush();
      }
    } catch (e) { /* rien */ }
    return res;
  };

  /* ---------------------------------------------------------------- pastille */
  let badge = null, fadeTimer = null;
  const LABELS = { off: '', syncing: 'Synchro…', ok: 'Synchronisé', offline: 'Hors ligne', error: 'Erreur de synchro' };
  const COLORS = { syncing: '#f59e0b', ok: '#22c55e', offline: '#94a3b8', error: '#ef4444' };
  function renderBadge() {
    try {
      if (!ENABLED || !document.body) return;
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.id = 'vs-sync-badge';
        badge.setAttribute('aria-live', 'polite');
        badge.style.cssText = 'position:fixed;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));z-index:9000;'
          + 'display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.35);'
          + 'background:rgba(20,24,33,.82);color:#f1f5f9;font:500 12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
          + 'box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;opacity:.95;transition:opacity .4s;max-width:60vw;white-space:nowrap;'
          + '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)';
        badge.innerHTML = '<span data-dot style="width:8px;height:8px;border-radius:50%;flex:none"></span><span data-txt style="overflow:hidden;text-overflow:ellipsis"></span>';
        badge.addEventListener('click', () => { sync(); });
        badge.addEventListener('mouseenter', () => { badge.style.opacity = '.95'; });
        document.body.appendChild(badge);
      }
      let label = LABELS[status] || '';
      if (status === 'syncing') label = message === 'Envoi…' ? 'Envoi…' : 'Mise à jour…';
      badge.querySelector('[data-dot]').style.background = COLORS[status] || '#94a3b8';
      badge.querySelector('[data-txt]').textContent = label;
      const when = lastOk ? ' — dernière synchro ' + new Date(lastOk).toLocaleTimeString('fr-FR') : '';
      badge.title = (message || label) + when + ' (cliquer pour synchroniser)';
      badge.setAttribute('aria-label', 'Synchronisation : ' + label);
      // Une fois synchronisée, la pastille s'efface à moitié pour rester discrète.
      clearTimeout(fadeTimer);
      badge.style.opacity = '.95';
      if (status === 'ok') fadeTimer = setTimeout(() => { if (badge && status === 'ok') badge.style.opacity = '.55'; }, 4000);
    } catch (e) { /* rien */ }
  }

  /* ---------------------------------------------------------------- démarrage */
  let pollTimer = null;
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (status === 'syncing') return;
      sync();
    }, POLL_MS);
  }

  if (ENABLED) {
    try {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBadge);
      else renderBadge();
      window.addEventListener('online', () => { retryDelay = 5000; sync(); });
      window.addEventListener('offline', () => setStatus('offline', 'Hors ligne : les modifications seront envoyées au retour du réseau.'));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
      // Le code admin a pu changer dans un autre onglet (connexion) : on réessaie.
      window.addEventListener('storage', (ev) => { if (ev.key === 'volleystats.adminCode') { refusedCode = null; sync(); } });
      setTimeout(sync, 0);
      startPolling();
    } catch (e) { /* rien */ }
  }

  VS.sync = {
    pull: () => (ENABLED ? serial(async () => {
      try { setStatus('syncing', 'Mise à jour…'); const c = await doPull(); finishOk(); return c; } catch (e) { handleError(e); return []; }
    }) : Promise.resolve([])),
    push: (m) => {
      if (!ENABLED || !isAdmin()) return Promise.resolve(0);
      return serial(async () => {
        try {
          if (refusedCode && refusedCode === adminCode()) refusedCode = null; // envoi explicite : on retente une fois
          setStatus('syncing', 'Envoi…');
          if (!pulledOnce) await doPull();
          const n = await doPush(m && m.id ? m.id : null);
          finishOk(); return n;
        } catch (e) { handleError(e); return 0; }
      });
    },
    status: () => status,
    message: () => message,
    pending: () => { try { return pendingCount(); } catch (e) { return 0; } },
    isDemo,
    now: sync,
  };
})();
