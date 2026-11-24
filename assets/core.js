/* VolleyStats – cœur de l'application (stockage, règles du jeu, statistiques, interface commune).
 * Recréé à partir des pages index.html, saisie.html et tableau-de-bord.html.
 * Toutes les données restent dans le navigateur (localStorage). */
(function (global) {
  'use strict';

  /* ====================================================================== */
  /* Référentiels                                                           */
  /* ====================================================================== */
  const SKILLS = {
    S: { label: 'Service' }, R: { label: 'Réception' }, E: { label: 'Passe' }, A: { label: 'Attaque' }, V: { label: 'Balle facile' },
    B: { label: 'Contre' }, D: { label: 'Défense' }, X: { label: 'Relance' }, F: { label: 'Faute diverse' },
  };
  const GRADE_ORDER = ['#', '+', '!', '-', '/', '='];
  const GRADES = {
    '#': { label: 'Parfait / point', color: '#16a34a', cls: 'g-hash' },
    '+': { label: 'Positif', color: '#65a30d', cls: 'g-plus' },
    '!': { label: 'Moyen', color: '#ca8a04', cls: 'g-excl' },
    '-': { label: 'Négatif', color: '#ea580c', cls: 'g-minus' },
    '/': { label: 'Contré / renvoyé', color: '#9333ea', cls: 'g-slash' },
    '=': { label: 'Faute', color: '#dc2626', cls: 'g-eq' },
  };
  /* Libellé de chaque qualité selon l'action (les symboles stockés ne changent pas). */
  const HINTS = {
    S: { '#': 'Ace', '+': 'Bon', '!': 'Moyen', '-': 'Facile', '/': 'Retour direct', '=': 'Faute' },
    R: { '#': 'Parfaite', '+': 'Bonne', '!': 'Moyenne', '-': 'Négative', '/': 'Retour direct', '=': 'Ace subi' },
    A: { '#': 'Point', '+': 'Adversaire en difficulté', '!': 'Couverte', '-': 'Facile pour l’adversaire', '/': 'Contrée', '=': 'Faute' },
    B: { '#': 'Point', '+': 'Positif', '!': 'Neutre', '-': 'Négatif', '/': 'Contre perdant', '=': 'Faute de filet' },
    D: { '#': 'Parfaite', '+': 'Positive', '!': 'Moyenne', '-': 'Négative', '/': 'Renvoi', '=': 'Faute' },
    X: { '#': 'Parfaite', '+': 'Bonne', '!': 'Moyenne', '-': 'Négative', '/': 'Renvoyée directement', '=': 'Faute' },
    V: { '#': 'Point', '!': 'Jeu continue', '=': 'Faute' },
  };
  /* Balle facile (renvoi à 10 doigts ou en manchette, sans attaque) : 3 qualités seulement. */
  const FREE_GRADES = ['#', '!', '='];
  const gradesFor = (skill) => (skill === 'V' ? FREE_GRADES : GRADE_ORDER);
  /* Ce que chaque qualité implique pour l'adversaire (info-bulles). */
  const OPP_HINTS = {
    S: { '#': 'Ace subi par l\'adversaire → point pour nous', '+': 'Récep. adverse en difficulté : pas de 1re tempo ou pire', '!': 'Récep. adverse bonne : le passeur bouge un peu', '-': 'Récep. adverse parfaite', '/': 'Récep. adverse mauvaise, relance pour notre équipe', '=': 'Point pour l\'adversaire' },
    R: { '#': 'Service adverse facile', '+': 'Service adverse facile', '!': 'Service adverse moyen', '-': 'Service adverse bon', '/': 'Service adverse : retour direct', '=': 'Ace adverse → point pour l\'adversaire' },
    A: { '#': 'Défense adverse ratée → point pour nous', '+': 'Défense adverse négative', '!': 'Revient du contre adverse, on reprend la balle', '-': 'Défense adverse positive', '/': 'Point de contre adverse', '=': 'Point pour l\'adversaire' },
    B: { '#': 'Attaque adverse contrée → point pour nous', '+': 'Attaque adverse facile pour nous', '!': 'Attaque adverse couverte (elle reprend la balle)', '-': 'Attaque adverse positive', '/': 'Attaque adverse gagnante : touchée par notre contre puis out ou tombée chez nous', '=': 'Point pour l\'adversaire' },
    D: { '#': 'Attaque adverse facile pour nous', '+': 'Attaque adverse facile pour nous', '!': 'Attaque adverse neutre', '-': 'Attaque adverse positive', '/': 'Attaque adverse positive', '=': 'Attaque adverse gagnante → point pour l\'adversaire' },
    X: { '#': 'Pas de déduction pour l\'adversaire', '+': 'Pas de déduction pour l\'adversaire', '!': 'Pas de déduction pour l\'adversaire', '-': 'Pas de déduction pour l\'adversaire', '/': 'Pas de déduction pour l\'adversaire', '=': 'Point pour l\'adversaire' },
    V: { '#': 'La balle tombe chez l’adversaire → point pour nous', '!': 'Balle facile à jouer pour l’adversaire', '=': 'Filet ou dehors → point pour l’adversaire' },
  };
  const POSITIONS = { P: 'Passeur', R4: 'Réceptionneur-attaquant', C: 'Central', PT: 'Pointu', L: 'Libéro' };
  const TARGETS = { 4: 'Avant gauche', 3: 'Centre', 2: 'Avant droit', 5: 'Arrière gauche', 6: 'Pipe (arr. centre)', 1: 'Arrière droit' };
  const TARGET_ORDER = [4, 3, 2, 5, 6, 1];
  const OPP_ACTIONS = [
    { id: 'srvErr', label: 'Faute de service adverse', skill: 'S', grade: '=', cls: 'pt-us' },
    { id: 'ace', label: 'Ace adverse (sans touche)', skill: 'S', grade: '#', cls: 'pt-them' },
    { id: 'attKill', label: 'Attaque gagnante adverse (sans touche)', skill: 'A', grade: '#', cls: 'pt-them' },
    { id: 'attErr', label: 'Faute d\'attaque adverse', skill: 'A', grade: '=', cls: 'pt-us' },
    { id: 'fault', label: 'Faute adverse (filet, 4 touches…)', skill: 'F', grade: '=', cls: 'pt-us' },
  ];
  const DEFAULT_ROSTER = [
    { num: 1, name: 'Léo', pos: 'P' }, { num: 2, name: 'Hugo', pos: 'R4' }, { num: 3, name: 'Nathan', pos: 'C' },
    { num: 4, name: 'Paul', pos: 'PT' }, { num: 5, name: 'Enzo', pos: 'R4' }, { num: 6, name: 'Louis', pos: 'C' },
    { num: 7, name: 'Jules', pos: 'L' }, { num: 8, name: 'Gabriel', pos: 'P' }, { num: 9, name: 'Arthur', pos: 'R4' },
    { num: 10, name: 'Adam', pos: 'C' }, { num: 11, name: 'Raphaël', pos: 'PT' }, { num: 12, name: 'Noah', pos: 'L' },
  ];

  /* ====================================================================== */
  /* Utilitaires                                                            */
  /* ====================================================================== */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pct = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v * 100) + ' %');
  const ratio = (n, d) => (d ? n / d : null);
  function fmtDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
  }
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ====================================================================== */
  /* Stockage                                                               */
  /* ====================================================================== */
  const PREFIX = 'volleystats.';
  function load(key, def) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; }
    catch (e) { toast('Impossible d\'enregistrer (stockage du navigateur plein ou bloqué). Exportez vos matchs.', 'error'); return false; }
  }
  const allMatches = () => load('matches', {}) || {};
  function listMatches() {
    return Object.values(allMatches()).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.created || 0) - (a.created || 0));
  }
  const getMatch = (id) => (id ? allMatches()[id] || null : null);
  function saveMatch(m) { const all = allMatches(); m.updated = Date.now(); all[m.id] = m; return save('matches', all); }
  function deleteMatch(id) { const all = allMatches(); delete all[id]; save('matches', all); if (load('current') === id) save('current', null); }
  function currentMatch() {
    const q = new URLSearchParams(location.search).get('match');
    return getMatch(q) || getMatch(load('current')) || listMatches()[0] || null;
  }

  /* ====================================================================== */
  /* Effectif                                                               */
  /* ====================================================================== */
  let activeRoster = null;
  const baseRoster = () => clone(load('rosterTemplate', null) || DEFAULT_ROSTER);
  function useMatchRoster(m) {
    if (!Array.isArray(m.roster) || !m.roster.length) m.roster = baseRoster();
    activeRoster = m.roster;
    return m.roster;
  }
  const rosterOf = (r) => r || activeRoster || [];
  function player(num, roster) {
    const p = rosterOf(roster).find((x) => x.num === num);
    return p || { num, name: num == null ? '?' : '#' + num, pos: '' };
  }
  function pname(num, roster) {
    const p = rosterOf(roster).find((x) => x.num === num);
    return p ? `#${p.num} ${p.name}` : '#' + num;
  }
  const rosterText = (roster) => roster.map((p) => `${p.num};${p.name};${p.pos || ''}`).join('\n');
  function parseRoster(text) {
    const out = [], seen = new Set();
    String(text || '').split(/\r?\n/).forEach((line) => {
      const parts = line.split(/[;\t,]/).map((s) => s.trim());
      const num = parseInt(parts[0], 10);
      if (!isFinite(num) || seen.has(num)) return;
      const pos = (parts[2] || '').toUpperCase();
      seen.add(num);
      out.push({ num, name: parts[1] || '#' + num, pos: POSITIONS[pos] ? pos : '' });
    });
    return out;
  }
  function defaultLineup(roster) {
    const used = new Set(), take = (pos) => { const p = roster.find((x) => x.pos === pos && !used.has(x.num)); if (p) { used.add(p.num); return p.num; } return null; };
    // P1 passeur, P2 réceptionneur, P3 central, P4 pointu, P5 réceptionneur, P6 central
    const lu = [take('P'), take('R4'), take('C'), take('PT'), take('R4'), take('C')];
    const rest = roster.filter((x) => x.pos !== 'L' && !used.has(x.num)).concat(roster.filter((x) => x.pos === 'L' && !used.has(x.num)));
    return lu.map((n) => { if (n != null) return n; const p = rest.shift(); if (p) { used.add(p.num); return p.num; } return null; });
  }
  function defaultLibero(roster) { const p = roster.find((x) => x.pos === 'L'); return p ? p.num : null; }

  /* Formulaire de composition (P1…P6, libéro, service) */
  const LU_LABELS = ['P1 · arrière droit (service)', 'P2 · avant droit', 'P3 · avant centre', 'P4 · avant gauche', 'P5 · arrière gauche', 'P6 · arrière centre'];
  function lineupForm(cfg, roster) {
    cfg = cfg || {};
    const lu = cfg.lineup || defaultLineup(roster);
    const opts = (sel, allowNone) => (allowNone ? `<option value="">— aucun —</option>` : '') +
      roster.map((p) => `<option value="${p.num}" ${p.num === sel ? 'selected' : ''}>#${p.num} ${esc(p.name)}${p.pos ? ' (' + esc(p.pos) + ')' : ''}</option>`).join('');
    const cell = (i) => `<label class="muted small" style="display:flex;flex-direction:column;gap:2px">${LU_LABELS[i]}<select data-lu="${i}">${opts(lu[i])}</select></label>`;
    return `<div class="lu-form">
      <div class="muted small" style="text-align:center;margin:4px 0">— filet —</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${[3, 2, 1, 4, 5, 0].map(cell).join('')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
        <label class="muted small" style="display:flex;flex-direction:column;gap:2px">Libéro<select data-lu="lib">${opts(cfg.libero == null ? null : cfg.libero, true)}</select></label>
        <label class="muted small" style="display:flex;flex-direction:column;gap:2px">Premier service<select data-lu="serve"><option value="1" ${cfg.weServeFirst !== false ? 'selected' : ''}>Nous servons</option><option value="0" ${cfg.weServeFirst === false ? 'selected' : ''}>L'adversaire sert</option></select></label>
      </div></div>`;
  }
  function readLineupForm(w, roster) {
    const lineup = [0, 1, 2, 3, 4, 5].map((i) => { const el = w.querySelector(`[data-lu="${i}"]`); return el && el.value !== '' ? +el.value : null; });
    if (lineup.some((n) => n == null)) { toast('Choisissez un joueur pour chaque poste P1 à P6.', 'error'); return null; }
    if (new Set(lineup).size !== 6) { toast('Un même joueur apparaît deux fois dans la composition.', 'error'); return null; }
    const libEl = w.querySelector('[data-lu="lib"]');
    const libero = libEl && libEl.value !== '' ? +libEl.value : null;
    if (libero != null && lineup.includes(libero)) { toast('Le libéro ne peut pas faire partie des 6 joueurs de départ.', 'error'); return null; }
    const sv = w.querySelector('[data-lu="serve"]');
    return { lineup, libero, weServeFirst: !sv || sv.value === '1' };
  }

  function newMatch({ opp, date, comp, set1, roster }) {
    return { id: uid(), version: 1, created: Date.now(), opp: opp || 'Adversaire', date: date || today(), comp: comp || '', roster: clone(roster || baseRoster()), sets: [set1], events: [] };
  }

  /* ====================================================================== */
  /* Règles : qui gagne le point                                            */
  /* ====================================================================== */
  const teamOf = (e) => e.team || 'us';
  const isAction = (e) => (e.kind || 'action') === 'action';
  function pointWinner(e) {
    if (!isAction(e)) return null;
    const t = teamOf(e), o = t === 'us' ? 'them' : 'us', g = e.grade, s = e.skill;
    if (s === 'F') return o;
    if (g === '=') return o;
    if (g === '#' && ['S', 'A', 'B', 'V'].includes(s)) return t;
    if (g === '/' && (s === 'A' || s === 'B')) return o; // attaque contrée / contre-out
    return null;
  }
  function pointReason(e) {
    if (e.kind === 'point') return 'Non détaillé';
    const t = teamOf(e), s = e.skill, g = e.grade;
    if (e.winner === 'us') {
      if (t === 'us') return s === 'S' ? 'Ace' : s === 'B' ? 'Contre' : s === 'A' ? 'Attaque' : s === 'V' ? 'Balle facile' : 'Autre';
      return s === 'S' ? 'Faute de service adverse' : s === 'A' ? 'Faute d\'attaque adverse' : 'Autre faute adverse';
    }
    if (t === 'them') return s === 'S' ? 'Ace adverse' : s === 'A' ? 'Attaque adverse' : 'Autre';
    if (s === 'S') return 'Faute de service';
    if (s === 'R') return 'Ace subi';
    if (s === 'A') return g === '/' ? 'Attaque contrée' : 'Faute d\'attaque';
    if (s === 'B') return g === '/' ? 'Attaque adverse' : 'Faute de filet (contre)';
    if (s === 'D') return 'Attaque adverse';
    if (s === 'V') return 'Faute sur balle facile';
    return 'Faute diverse';
  }

  /* ====================================================================== */
  /* Rejeu du match : score, sets, rotations, service                       */
  /* ====================================================================== */
  function replay(m) {
    const roster = m.roster || activeRoster || [];
    const posOf = (n) => (roster.find((p) => p.num === n) || {}).pos;
    let set = 1, rally = 1, us = 0, them = 0, setsUs = 0, setsThem = 0, over = false, needsConfig = false;
    const setScores = [];
    let cfg = null, lastCfg = null, lineup = [], libero = null, weServe = true, rot = 0;
    const nextDefault = (prev) => ({ lineup: prev.lineup.slice(), libero: prev.libero == null ? null : prev.libero, weServeFirst: !prev.weServeFirst });
    function startSet() {
      const c = m.sets && m.sets[set - 1];
      needsConfig = !c;
      cfg = c || nextDefault(lastCfg || m.sets[0]);
      lineup = cfg.lineup.slice(); libero = cfg.libero == null ? null : cfg.libero;
      weServe = !!cfg.weServeFirst; rot = 0; us = 0; them = 0; rally = 1;
    }
    const setterPos = () => { const i = lineup.findIndex((n) => posOf(n) === 'P'); return i >= 0 ? i + 1 : null; };
    const srot = () => setterPos() || ((6 - rot) % 6) + 1;
    const setDone = () => { const target = set === 5 ? 15 : 25; return (us >= target || them >= target) && Math.abs(us - them) >= 2; };
    function endSet() {
      setScores.push({ set, us, them });
      if (us > them) setsUs++; else if (them > us) setsThem++;
      if (setsUs >= 3 || setsThem >= 3) { over = true; return; }
      lastCfg = cfg; set++; startSet();
    }
    startSet();

    const events = [];
    for (const raw of m.events || []) {
      const e = Object.assign({}, raw);
      e.kind = e.kind || 'action';
      if (e.kind === 'action') delete e.winner;
      delete e.setEnd; delete e.ignored;
      e.set = set; e.rally = rally; e.weServed = weServe; e.srot = srot();
      if (over) { e.ignored = true; e.us = us; e.them = them; events.push(e); continue; }
      if (e.kind === 'sub') {
        const i = lineup.indexOf(e.out);
        if (i < 0 || lineup.includes(e.in) || e.in === libero) e.ignored = true; else lineup[i] = e.in;
        e.us = us; e.them = them; events.push(e); continue;
      }
      if (e.kind === 'setend') { e.us = us; e.them = them; e.setEnd = true; events.push(e); endSet(); continue; }
      const w = e.kind === 'point' ? (e.winner === 'us' || e.winner === 'them' ? e.winner : null) : pointWinner(e);
      if (e.kind === 'point' && !w) { e.ignored = true; e.us = us; e.them = them; events.push(e); continue; }
      if (w) {
        e.winner = w;
        if (w === 'us') us++; else them++;
        if (w === 'us' && !weServe) { lineup.push(lineup.shift()); rot = (rot + 1) % 6; weServe = true; }
        else if (w === 'them' && weServe) weServe = false;
        e.us = us; e.them = them;
        rally++;
        events.push(e);
        if (setDone()) { e.setEnd = true; endSet(); }
        continue;
      }
      e.us = us; e.them = them; events.push(e);
    }
    const state = {
      set, rally, us, them, setsUs, setsThem, setScores, over, weServe, rot,
      lineup: lineup.slice(), base: lineup.slice(), libero, setterPos: setterPos(),
      cfg: clone(cfg), needsConfig: needsConfig && !over,
    };
    return { events, state };
  }

  /* ====================================================================== */
  /* Statistiques                                                           */
  /* ====================================================================== */
  const emptyCounter = () => { const c = { tot: 0 }; GRADE_ORDER.forEach((g) => (c[g] = 0)); return c; };
  function emptyLine() { const l = { total: 0 }; Object.keys(SKILLS).forEach((s) => (l[s] = emptyCounter())); return l; }
  function addTo(line, e) {
    line.total++;
    const c = line[e.skill]; if (!c) return;
    c.tot++; if (e.grade && c[e.grade] != null) c[e.grade]++;
  }
  function derive(l) {
    const S = l.S, R = l.R, A = l.A, B = l.B, D = l.D, X = l.X;
    const d = {
      srvTot: S.tot, ace: S['#'], srvErr: S['='], srvEff: ratio(S['#'] - S['='], S.tot),
      recTot: R.tot, recPos: R['#'] + R['+'], recPosPct: ratio(R['#'] + R['+'], R.tot), recPerfPct: ratio(R['#'], R.tot), recErr: R['='],
      setTot: l.E.tot,
      attTot: A.tot, kill: A['#'], attErr: A['='], attBlk: A['/'], killPct: ratio(A['#'], A.tot), attEff: ratio(A['#'] - A['='] - A['/'], A.tot),
      blkTot: B.tot, blkPts: B['#'],
      digTot: D.tot, digPosPct: ratio(D['#'] + D['+'], D.tot),
      freeTot: l.V.tot, freePts: l.V['#'], freeErr: l.V['='],
      relanceTot: X.tot, relancePosPct: ratio(X['#'] + X['+'], X.tot),
      errs: S['='] + A['='] + B['='] + X['='] + l.E['='] + l.V['='] + l.F.tot,
    };
    d.pts = d.ace + d.kill + d.blkPts + d.freePts;
    return d;
  }
  function computeStats(events, team) {
    const players = new Map(), tl = emptyLine();
    (events || []).forEach((e) => {
      if (e.ignored || !isAction(e) || teamOf(e) !== team) return;
      addTo(tl, e);
      if (e.player == null) return;
      if (!players.has(e.player)) { const p = player(e.player); players.set(e.player, Object.assign(emptyLine(), { num: p.num, name: p.name, pos: p.pos })); }
      addTo(players.get(e.player), e);
    });
    const list = [...players.values()].sort((a, b) => a.num - b.num);
    list.forEach((p) => (p.d = derive(p)));
    tl.d = derive(tl);
    return { players: list, team: tl };
  }

  /* Actions adverses déduites de nos actions (+ actions adverses saisies) */
  const OPP_SERVE = { '#': '-', '+': '-', '!': '!', '-': '+', '/': '/', '=': '#' };     // ← notre réception
  const OPP_REC = { '#': '=', '+': '-', '!': '+', '-': '#', '/': '/' };                // ← notre service (pas de réception moyenne adverse)
  const OPP_ATT_B = { '#': '/', '+': '-', '!': '!', '-': '+', '/': '#' };               // ← notre contre
  const OPP_ATT_D = { '#': '-', '+': '-', '!': '!', '-': '+', '/': '+', '=': '#' };     // ← notre défense
  function deriveOpp(events) {
    const out = [];
    let key = null, prev = null;
    (events || []).forEach((e) => {
      if (e.ignored || !isAction(e)) return;
      const k = e.set + ':' + e.rally;
      if (k !== key) { key = k; prev = null; }
      const mk = (skill, grade) => out.push({ id: e.id + '~opp', kind: 'action', team: 'them', player: null, skill, grade, set: e.set, rally: e.rally, derived: true, from: e.id });
      if (teamOf(e) === 'them') { out.push(Object.assign({}, e)); prev = e; return; }
      if (e.skill === 'R' && OPP_SERVE[e.grade]) mk('S', OPP_SERVE[e.grade]);
      else if (e.skill === 'S' && OPP_REC[e.grade]) mk('R', OPP_REC[e.grade]);
      else if (e.skill === 'B' && OPP_ATT_B[e.grade]) mk('A', OPP_ATT_B[e.grade]);
      else if (e.skill === 'D' && OPP_ATT_D[e.grade]) {
        // Une défense juste après notre contre touché correspond à la même attaque adverse.
        const sameAttack = prev && teamOf(prev) === 'us' && prev.skill === 'B' && ['+', '!', '-'].includes(prev.grade);
        if (!sameAttack) mk('A', OPP_ATT_D[e.grade]);
      }
      prev = e;
    });
    return out;
  }

  /* Passes : situation avant la passe et attaque qui suit */
  function setsAnalysis(events) {
    const res = [], rallies = new Map();
    (events || []).forEach((e) => {
      if (e.ignored || !isAction(e)) return;
      const k = e.set + ':' + e.rally;
      if (!rallies.has(k)) rallies.set(k, []);
      rallies.get(k).push(e);
    });
    rallies.forEach((list) => {
      list.forEach((e, i) => {
        if (teamOf(e) !== 'us' || e.skill !== 'E') return;
        let prev = null;
        for (let j = i - 1; j >= 0; j--) if (teamOf(list[j]) === 'us') { prev = list[j]; break; }
        let ctx = 'X';
        if (prev && prev.skill === 'R' && ['#', '+', '!', '-'].includes(prev.grade)) ctx = 'R' + prev.grade;
        else if (prev && ['D', 'B', 'X'].includes(prev.skill)) ctx = 'T';
        const next = list[i + 1];
        const ours = next && teamOf(next) === 'us';
        res.push({ set: e, ctx, attack: ours && next.skill === 'A' ? next : null, free: ours && next.skill === 'V' ? next : null });
      });
    });
    return res;
  }

  /* ====================================================================== */
  /* Affichage                                                              */
  /* ====================================================================== */
  const hint = (skill, grade) => (HINTS[skill] && HINTS[skill][grade]) || '';
  const oppHint = (skill, grade) => (OPP_HINTS[skill] && OPP_HINTS[skill][grade]) || '';
  const gchip = (g) => (GRADES[g] ? `<span class="g ${GRADES[g].cls}">${esc(g)}</span>` : '');
  function describeParts(e, roster) {
    const kind = e.kind || 'action';
    if (kind === 'point') return { html: `Point non détaillé → <b>${e.winner === 'us' ? 'Nous' : 'Adversaire'}</b>`, text: `Point non détaillé → ${e.winner === 'us' ? 'Nous' : 'Adversaire'}` };
    if (kind === 'sub') { const t = `Remplacement : ${pname(e.in, roster)} entre, ${pname(e.out, roster)} sort`; return { html: esc(t), text: t }; }
    if (kind === 'setend') { const t = `Fin du set ${e.set || ''} demandée`.replace('  ', ' '); return { html: `<b>${esc(t)}</b>`, text: t }; }
    if (teamOf(e) === 'them') {
      const o = OPP_ACTIONS.find((x) => x.skill === e.skill && x.grade === e.grade);
      const lbl = o ? o.label : `${(SKILLS[e.skill] || {}).label || e.skill} adverse ${e.grade || ''}`;
      return { html: `<span class="team-tag them">ADV</span>${esc(lbl)}`, text: 'Adversaire · ' + lbl };
    }
    const who = pname(e.player, roster), sk = (SKILLS[e.skill] || {}).label || e.skill;
    if (e.skill === 'E' && e.grade === '=') return { html: `${esc(who)} · Passe ${gchip('=')} <span class="muted">Faute de passe</span>`, text: `${who} · Passe = (Faute de passe)` };
    if (e.skill === 'E') { const z = e.target ? ` → zone ${e.target} (${TARGETS[e.target] || ''})` : ''; return { html: `${esc(who)} · Passe${esc(z)}`, text: `${who} · Passe${z}` }; }
    if (e.skill === 'F') return { html: `${esc(who)} · Faute diverse ${gchip('=')}`, text: `${who} · Faute diverse` };
    const h = hint(e.skill, e.grade);
    return { html: `${esc(who)} · ${esc(sk)} ${gchip(e.grade)} <span class="muted">${esc(h)}</span>`, text: `${who} · ${sk} ${e.grade || ''}${h ? ' (' + h + ')' : ''}` };
  }
  const describe = (e, roster) => describeParts(e, roster).html;
  const describeText = (e, roster) => describeParts(e, roster).text;

  /* ====================================================================== */
  /* Interface commune : toast, fenêtre modale, en-tête                     */
  /* ====================================================================== */
  function toast(msg, type) {
    let box = document.getElementById('vs-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'vs-toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'vs-toast' + (type ? ' ' + type : ''); t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), type === 'error' ? 3500 : 2200);
    setTimeout(() => t.remove(), type === 'error' ? 4000 : 2700);
  }
  function modal(title, bodyHtml, buttons, opts) {
    opts = opts || {}; buttons = buttons && buttons.length ? buttons : [{ label: 'Fermer' }];
    const wrap = document.createElement('div');
    wrap.className = 'vs-modal-wrap';
    wrap.innerHTML = `<div class="vs-modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="vs-modal-body">${bodyHtml}</div><div class="vs-modal-actions"></div></div>`;
    const acts = wrap.querySelector('.vs-modal-actions');
    const onKey = (ev) => { if (ev.key === 'Escape' && !opts.locked && document.querySelector('.vs-modal-wrap:last-of-type') === wrap) close(); };
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'vs-btn ' + (b.cls || ''); btn.textContent = b.label;
      btn.addEventListener('click', () => { if (b.onClick && b.onClick(wrap) === false) return; close(); });
      acts.appendChild(btn);
    });
    wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap && !opts.locked) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: wrap, close };
  }
  function rosterEditor(title, intro, roster, onSave) {
    modal(title, `<p class="muted small" style="margin:0 0 6px">${intro}</p><p class="muted small" style="margin:0 0 6px">Une ligne par joueur : <code>numéro;nom;poste</code> — postes : ${Object.entries(POSITIONS).map(([k, v]) => `<code>${k}</code> ${esc(v)}`).join(', ')}.</p><textarea id="vsRosterText" rows="14" spellcheck="false">${esc(rosterText(roster))}</textarea>`, [
      { label: 'Annuler', cls: 'ghost' },
      { label: 'Enregistrer', cls: 'primary', onClick: (w) => {
        const parsed = parseRoster(w.querySelector('#vsRosterText').value);
        if (parsed.length < 6) { toast('Il faut au moins 6 joueurs', 'error'); return false; }
        onSave(parsed);
      } },
    ]);
  }
  const LOGO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20M2.5 9.5c5 0 9 2 12 7M21.5 9.5c-5-1-10 0-14 4"/></svg>';
  function header(page, m) {
    const id = m ? m.id : load('current');
    const q = id ? '?match=' + encodeURIComponent(id) : '';
    const link = (key, href, label) => `<a href="${href}" class="${page === key ? 'active' : ''}">${label}</a>`;
    const h = document.createElement('header');
    h.className = 'vs-header'; h.style.flex = 'none';
    h.innerHTML = `<a class="vs-brand" href="index.html"><span class="vs-logo">${LOGO}</span>VolleyStats${m ? ` <small>vs ${esc(m.opp)} · ${esc(fmtDate(m.date))}</small>` : ''}</a>
      <nav>${link('home', 'index.html', 'Matchs')}${id ? link('entry', 'saisie.html' + q, 'Saisie') + link('dash', 'tableau-de-bord.html' + q, 'Tableau de bord') : ''}</nav>
      <div class="head-actions">${m ? '<button class="vs-btn sm ghost" data-vs="matchRoster">Effectif du match</button>' : ''}<button class="vs-btn sm ghost" data-vs="template">Modèle d’effectif</button></div>`;
    document.body.insertBefore(h, document.body.firstChild);
    h.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-vs]'); if (!b) return;
      if (b.dataset.vs === 'template') {
        rosterEditor('Modèle d’effectif', 'Utilisé pour les prochains matchs créés. Les matchs existants gardent leur propre effectif.', baseRoster(), (r) => { save('rosterTemplate', r); toast('Modèle d’effectif enregistré', 'ok'); });
      } else if (b.dataset.vs === 'matchRoster' && m) {
        const fresh = getMatch(m.id) || m;
        rosterEditor('Effectif du match', `Effectif propre au match contre ${esc(fresh.opp)}. Les actions déjà saisies gardent les numéros des joueurs.`, useMatchRoster(fresh), (r) => { fresh.roster = r; saveMatch(fresh); location.reload(); });
      }
    });
  }

  /* ====================================================================== */
  /* Exports                                                                */
  /* ====================================================================== */
  function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function downloadCSV(name, headers, rows) {
    const cell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [headers].concat(rows).map((r) => r.map(cell).join(';')).join('\r\n');
    downloadFile(name, '﻿' + csv, 'text/csv');
  }
  function exportCSV(m, events) {
    const roster = m.roster || activeRoster;
    const rows = (events || []).filter((e) => !e.ignored).map((e) => {
      const p = e.player != null ? player(e.player, roster) : null, kind = e.kind || 'action';
      return [e.set, e.rally, e.weServed ? 'Nous' : 'Adversaire', kind === 'action' ? (teamOf(e) === 'us' ? 'Nous' : 'Adversaire') : '',
        p ? p.num : '', p ? p.name : '',
        kind === 'action' ? (SKILLS[e.skill] || {}).label || e.skill : kind === 'point' ? 'Point non détaillé' : kind === 'sub' ? 'Remplacement' : 'Fin de set',
        e.grade || '', e.grade ? hint(e.skill, e.grade) : '', e.target || '',
        e.winner ? (e.winner === 'us' ? 'Nous' : 'Adversaire') : '', e.us, e.them, 'P' + e.srot, describeText(e, roster)];
    });
    downloadCSV(`match-${m.date}-${String(m.opp).replace(/[^\w-]+/g, '_')}.csv`,
      ['Set', 'Échange', 'Service', 'Équipe', 'N°', 'Joueur', 'Action', 'Qualité', 'Signification', 'Zone passe', 'Point pour', 'Score nous', 'Score adv.', 'Passeur', 'Description'], rows);
  }

  /* ====================================================================== */
  /* Match d'exemple (simulation reproductible)                             */
  /* ====================================================================== */
  function simulateDemo(seed) {
    let a = seed >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pickW = (pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let r = rnd() * tot; for (const p of pairs) { if ((r -= p[1]) < 0) return p[0]; } return pairs[pairs.length - 1][0]; };
    const one = (arr) => arr[Math.floor(rnd() * arr.length)];
    const roster = clone(DEFAULT_ROSTER);
    const d = new Date(); d.setDate(d.getDate() - 7);
    const m = newMatch({ opp: 'VC Exemple', date: d.toISOString().slice(0, 10), comp: 'Match d’exemple', roster,
      set1: { lineup: defaultLineup(roster), libero: defaultLibero(roster), weServeFirst: true } });
    const pos = (n) => player(n, roster).pos;
    const add = (ev) => m.events.push(Object.assign({ id: uid() + m.events.length, kind: 'action', team: 'us' }, ev));
    let subDone = false;

    function rally(st) {
      const L = st.lineup, front = [L[1], L[2], L[3]], back = [L[0], L[4], L[5]];
      const setter = L.find((n) => pos(n) === 'P') || L[2];
      const attackerFor = (zone) => {
        const want = { 4: ['R4', front], 3: ['C', front], 2: ['PT', front], 6: ['R4', back], 5: ['R4', back], 1: ['PT', back] }[zone];
        return want[1].find((n) => pos(n) === want[0] && n !== setter) || front.find((n) => n !== setter) || L[3];
      };
      const attack = (ctx) => {
        const zone = ctx === '-' ? pickW([[4, 60], [2, 20], [6, 15], [1, 5]]) : pickW([[4, 36], [3, 22], [2, 20], [6, 12], [1, 5], [5, 5]]);
        add({ player: setter, skill: 'E', grade: null, target: zone });
        const g = ctx === '-' ? pickW([['#', 30], ['+', 12], ['!', 22], ['-', 14], ['/', 9], ['=', 13]]) : pickW([['#', 45], ['+', 12], ['!', 14], ['-', 11], ['/', 7], ['=', 11]]);
        add({ player: attackerFor(zone), skill: 'A', grade: g });
        return ['#', '/', '='].includes(g);
      };
      const defend = () => { // l'adversaire attaque ; renvoie 'end', 'us' (on contre-attaque) ou 'opp'
        const r = rnd();
        if (r < 0.03) { add({ team: 'them', player: null, skill: 'F', grade: '=' }); return 'end'; }
        if (r < 0.14) { add({ team: 'them', player: null, skill: 'A', grade: '=' }); return 'end'; }
        if (r < 0.25) { add({ team: 'them', player: null, skill: 'A', grade: '#' }); return 'end'; }
        if (r < 0.33) { add({ player: one(back.concat(st.libero ? [st.libero] : [])), skill: 'X', grade: pickW([['#', 30], ['+', 35], ['!', 20], ['-', 10], ['=', 5]]) }); return m.events[m.events.length - 1].grade === '=' ? 'end' : 'us'; }
        if (r < 0.52) {
          const g = pickW([['#', 28], ['+', 25], ['!', 17], ['-', 10], ['/', 12], ['=', 8]]);
          add({ player: one(front.filter((n) => n !== setter).concat([setter])), skill: 'B', grade: g });
          if (['#', '/', '='].includes(g)) return 'end';
          if (rnd() < 0.5) return 'us';
        }
        const g = pickW([['#', 10], ['+', 26], ['!', 24], ['-', 15], ['/', 8], ['=', 17]]);
        add({ player: one(back.filter((n) => n !== setter).concat(st.libero ? [st.libero, st.libero] : [])), skill: 'D', grade: g });
        return g === '=' ? 'end' : g === '/' ? 'opp' : 'us';
      };
      let phase, ctx = '+';
      if (st.weServe) {
        const g = pickW([['#', 7], ['+', 16], ['!', 40], ['-', 24], ['/', 3], ['=', 10]]);
        add({ player: L[0], skill: 'S', grade: g });
        if (g === '#' || g === '=') return;
        phase = 'opp';
      } else {
        const r = rnd();
        if (r < 0.09) { add({ team: 'them', player: null, skill: 'S', grade: '=' }); return; }
        if (r < 0.13) { add({ team: 'them', player: null, skill: 'S', grade: '#' }); return; }
        const receivers = L.filter((n) => pos(n) === 'R4').concat(st.libero ? [st.libero, st.libero] : []);
        const g = pickW([['#', 20], ['+', 30], ['!', 23], ['-', 14], ['/', 4], ['=', 9]]);
        add({ player: one(receivers.length ? receivers : back), skill: 'R', grade: g });
        if (g === '=') return;
        phase = g === '/' ? 'opp' : 'us'; ctx = g;
      }
      for (let i = 0; i < 10; i++) {
        if (phase === 'us') { if (attack(ctx)) return; phase = 'opp'; ctx = '+'; }
        else { const r = defend(); if (r === 'end') return; phase = r; ctx = r === 'us' ? '!' : '+'; }
      }
      m.events.push({ id: uid() + m.events.length, kind: 'point', winner: rnd() < 0.5 ? 'us' : 'them' });
    }

    for (let guard = 0; guard < 600; guard++) {
      const st = replay(m).state;
      if (st.over) break;
      if (st.needsConfig) { m.sets[st.set - 1] = st.cfg; continue; }
      if (!subDone && st.set === 3 && st.us + st.them === 12) {
        const out = st.lineup.find((n) => pos(n) === 'R4');
        if (out != null) m.events.push({ id: uid() + m.events.length, kind: 'sub', out, in: 9 });
        subDone = true; continue;
      }
      rally(st);
    }
    return m;
  }
  function createDemoMatch() {
    for (let seed = 1; seed < 300; seed++) {
      const m = simulateDemo(seed), st = replay(m).state;
      if (st.over && st.setsUs === 3 && st.setsThem === 1) return m;
    }
    return simulateDemo(1);
  }

  global.VS = {
    SKILLS, GRADES, GRADE_ORDER, FREE_GRADES, gradesFor, POSITIONS, TARGETS, TARGET_ORDER, OPP_ACTIONS,
    esc, uid, pct, fmtDate, load, save, listMatches, getMatch, saveMatch, deleteMatch, currentMatch,
    baseRoster, useMatchRoster, player, pname, rosterText, parseRoster, defaultLineup, defaultLibero, lineupForm, readLineupForm, newMatch,
    teamOf, isAction, pointWinner, pointReason, replay, computeStats, deriveOpp, setsAnalysis,
    hint, oppHint, gchip, describe, describeText, toast, modal, header, downloadFile, downloadCSV, exportCSV, createDemoMatch,
  };
})(window);
