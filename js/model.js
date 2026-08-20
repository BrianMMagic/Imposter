/* ============================================================
   model.js — players, categories, storage and round dealing

   The saved state is only the *setup* (players, categories,
   settings). A round — the secret word and who the imposters are —
   lives in memory only, so it never touches the disk and a reload
   can never leak it.
   ============================================================ */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'imposter.v1';
  var RECENT_MAX = 12;        // words held back from repeating, per category
  var MAX_PLAYERS = 20;
  var MAX_IMPOSTERS = 3;
  var NAME_MAX = 18;

  var BUILT_IN = global.ImposterWords.CATEGORIES;

  /* One colour per player, so every card in the pass is a different one.
     There are as many colours here as MAX_PLAYERS, so a full game never
     has to reuse a shade. */
  var PLAYER_COLORS = [
    '#7c5cff', '#ff6b9d', '#2fb8ff', '#3ddc97', '#ff8b3d',
    '#ffc93c', '#ff5c6c', '#00c2a8', '#a06bff', '#4dd4ff',
    '#ff7ad9', '#8ed94f', '#5b8cff', '#ff9f68', '#26c6da',
    '#d98cff', '#5fbf7a', '#e0a93b', '#ff6f61', '#9aa7ff'
  ];

  var DEFAULT_CATEGORIES = ['animals', 'food', 'people', 'jobs', 'house'];

  var state = null;
  var round = null;

  /* ============================================================
     Random — crypto-backed, no modulo bias
     ============================================================ */
  function randInt(n) {
    if (n <= 1) return 0;
    var c = global.crypto;
    if (c && c.getRandomValues) {
      var limit = Math.floor(4294967296 / n) * n;
      var buf = new Uint32Array(1);
      for (var i = 0; i < 64; i++) {
        c.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % n;
      }
    }
    return Math.floor(Math.random() * n);
  }

  function pick(list) { return list[randInt(list.length)]; }

  function shuffle(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  function uid(prefix) {
    return (prefix || 'x') + Date.now().toString(36) + randInt(1e6).toString(36);
  }

  /* ============================================================
     Storage
     ============================================================ */
  function defaults() {
    return {
      players: [],
      /* what this phone's owner calls themselves, so a room does not ask
         for it again every single time */
      myName: '',
      imposterCount: 1,
      selected: DEFAULT_CATEGORIES.slice(),
      custom: [],
      recent: {},
      settings: {
        imposterSeesCategory: true,
        haptics: true,
        shuffleOrder: false,
        keepAwake: true
      }
    };
  }

  function load() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
    state = defaults();
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.players)) {
        state.players = saved.players
          .filter(function (p) { return p && p.name; })
          .slice(0, MAX_PLAYERS)
          .map(function (p) {
            return { id: p.id || uid('p'), name: cleanName(p.name), color: normalizeColor(p.color) };
          });
        /* Anything saved before colours existed, or sharing one, gets its own. */
        state.players.forEach(function (p, i) {
          var clash = state.players.some(function (o, j) { return j < i && o.color === p.color; });
          if (!p.color || clash) p.color = unusedColor();
        });
      }
      if (Array.isArray(saved.custom)) {
        state.custom = saved.custom
          .filter(function (c) { return c && c.name && Array.isArray(c.words); })
          .map(function (c) {
            return {
              id: c.id || uid('c'),
              emoji: c.emoji || '✏️',
              name: String(c.name).slice(0, 24),
              words: cleanWords(c.words),
              custom: true
            };
          });
      }
      if (typeof saved.myName === 'string') state.myName = cleanName(saved.myName);
      if (Array.isArray(saved.selected)) state.selected = saved.selected.slice();
      if (saved.recent && typeof saved.recent === 'object') state.recent = saved.recent;
      var wanted = parseInt(saved.imposterCount, 10);
      state.imposterCount = Math.min(Math.max(isFinite(wanted) ? wanted : 1, 1), MAX_IMPOSTERS);
      if (saved.settings) {
        Object.keys(state.settings).forEach(function (k) {
          if (typeof saved.settings[k] === 'boolean') state.settings[k] = saved.settings[k];
        });
      }
    }
    /* Drop selections, and the used-word history, for categories that no
       longer exist — a built-in one that has been retired, or a custom one
       that was deleted on another visit. */
    state.selected = state.selected.filter(function (id) { return !!getCategory(id); });
    if (!state.selected.length) state.selected = DEFAULT_CATEGORIES.slice();
    Object.keys(state.recent).forEach(function (id) {
      if (!getCategory(id)) delete state.recent[id];
    });
    return state;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    state = defaults();
    round = null;
    return state;
  }

  /* ============================================================
     Players
     ============================================================ */
  function normalizeColor(c) {
    var v = String(c || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(v) ? v : '';
  }

  /* The first colour nobody has yet; if every one is taken, the least used. */
  function unusedColor(exclude) {
    var taken = {};
    state.players.forEach(function (p) {
      if (p.id !== exclude) taken[p.color] = (taken[p.color] || 0) + 1;
    });
    var best = PLAYER_COLORS[0], bestUse = Infinity;
    for (var i = 0; i < PLAYER_COLORS.length; i++) {
      var use = taken[PLAYER_COLORS[i]] || 0;
      if (use === 0) return PLAYER_COLORS[i];
      if (use < bestUse) { bestUse = use; best = PLAYER_COLORS[i]; }
    }
    return best;
  }

  /* Step to the next colour no one else is wearing. */
  function cyclePlayerColor(id) {
    var player = getPlayer(id);
    if (!player) return null;
    var taken = {};
    state.players.forEach(function (p) { if (p.id !== id) taken[p.color] = true; });
    var at = PLAYER_COLORS.indexOf(player.color);
    for (var step = 1; step <= PLAYER_COLORS.length; step++) {
      var next = PLAYER_COLORS[(at + step + PLAYER_COLORS.length) % PLAYER_COLORS.length];
      if (!taken[next]) { player.color = next; save(); return next; }
    }
    return player.color;
  }

  function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  /* The name this phone joins rooms under. Remembered so nobody has to
     type it in every time, and offered as the default next time. */
  function myName() { return state.myName || ''; }

  function setMyName(name) {
    var clean = cleanName(name);
    if (!clean) return '';
    state.myName = clean;
    save();
    return clean;
  }

  function addPlayer(name) {
    var clean = cleanName(name);
    if (!clean) return { ok: false, reason: 'empty' };
    if (state.players.length >= MAX_PLAYERS) return { ok: false, reason: 'full' };
    var taken = state.players.some(function (p) {
      return p.name.toLowerCase() === clean.toLowerCase();
    });
    if (taken) return { ok: false, reason: 'duplicate' };
    var player = { id: uid('p'), name: clean, color: unusedColor() };
    state.players.push(player);
    state.imposterCount = clampImposters(state.imposterCount);
    save();
    return { ok: true, player: player };
  }

  function removePlayer(id) {
    state.players = state.players.filter(function (p) { return p.id !== id; });
    state.imposterCount = clampImposters(state.imposterCount);
    save();
  }

  function renamePlayer(id, name) {
    var clean = cleanName(name);
    if (!clean) return false;
    var player = getPlayer(id);
    if (!player) return false;
    player.name = clean;
    save();
    return true;
  }

  function clearPlayers() {
    state.players = [];
    state.imposterCount = clampImposters(state.imposterCount);
    save();
  }

  /* Move a player to another slot, carrying everyone else along. */
  function movePlayer(from, to) {
    var last = state.players.length - 1;
    from = Math.max(0, Math.min(last, from));
    to = Math.max(0, Math.min(last, to));
    if (from === to) return false;
    state.players.splice(to, 0, state.players.splice(from, 1)[0]);
    save();
    return true;
  }

  function getPlayer(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  /* ============================================================
     Imposters

     Every round needs at least two people who share the word,
     otherwise there is nothing to work out — so the imposters are
     capped at players - 2.
     ============================================================ */
  function maxImposters() {
    return Math.max(1, Math.min(MAX_IMPOSTERS, state.players.length - 2));
  }

  function clampImposters(n) {
    var v = parseInt(n, 10);
    if (!isFinite(v) || v < 1) v = 1;
    return Math.min(v, maxImposters());
  }

  /* `cap` is how many the current line-up can take: the phone-passing list
     knows its own, a room passes its roster's. Left out, the local list
     decides. */
  function setImposterCount(n, cap) {
    var max = cap == null ? maxImposters() : Math.max(1, Math.min(MAX_IMPOSTERS, cap));
    var wanted = parseInt(n, 10);
    state.imposterCount = Math.min(Math.max(isFinite(wanted) ? wanted : 1, 1), max);
    save();
    return state.imposterCount;
  }

  /* ============================================================
     Categories
     ============================================================ */
  function allCategories() {
    return BUILT_IN.concat(state.custom);
  }

  function getCategory(id) {
    var all = allCategories();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function isSelected(id) {
    return state.selected.indexOf(id) !== -1;
  }

  function toggleCategory(id) {
    var at = state.selected.indexOf(id);
    if (at === -1) state.selected.push(id);
    else state.selected.splice(at, 1);
    save();
    return isSelected(id);
  }

  function selectAllCategories(on) {
    state.selected = on ? allCategories().map(function (c) { return c.id; }) : [];
    save();
  }

  function selectedCategories() {
    return state.selected.map(getCategory).filter(Boolean);
  }

  function wordCount() {
    return selectedCategories().reduce(function (sum, c) { return sum + c.words.length; }, 0);
  }

  function cleanWords(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (w) {
      var clean = String(w == null ? '' : w).replace(/\s+/g, ' ').trim().slice(0, 40);
      var key = clean.toLowerCase();
      if (clean && !seen[key]) { seen[key] = 1; out.push(clean); }
    });
    return out;
  }

  function parseWords(text) {
    return cleanWords(String(text || '').split(/[\n,]/));
  }

  function saveCustomCategory(data) {
    var name = String(data.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    var words = cleanWords(data.words);
    if (!name || words.length < 2) return null;
    var emoji = String(data.emoji || '✏️').trim() || '✏️';
    var existing = data.id ? getCategory(data.id) : null;

    if (existing && existing.custom) {
      existing.name = name;
      existing.words = words;
      existing.emoji = emoji;
    } else {
      existing = { id: uid('c'), emoji: emoji, name: name, words: words, custom: true };
      state.custom.push(existing);
      if (!isSelected(existing.id)) state.selected.push(existing.id);
    }
    save();
    return existing;
  }

  function deleteCustomCategory(id) {
    state.custom = state.custom.filter(function (c) { return c.id !== id; });
    state.selected = state.selected.filter(function (s) { return s !== id; });
    delete state.recent[id];
    save();
  }

  /* ============================================================
     Dealing a round

     Words seen in the last few rounds of a category are held back
     so the same one does not come round again immediately — unless
     that would leave nothing to choose from.
     ============================================================ */
  function rememberWord(categoryId, word) {
    var list = state.recent[categoryId] || [];
    list = list.filter(function (w) { return w !== word; });
    list.unshift(word);
    state.recent[categoryId] = list.slice(0, RECENT_MAX);
    save();
  }

  function pickWord(category) {
    var recent = state.recent[category.id] || [];
    var fresh = category.words.filter(function (w) { return recent.indexOf(w) === -1; });
    return pick(fresh.length ? fresh : category.words);
  }

  function canStart() {
    if (state.players.length < 3) return { ok: false, reason: 'Add at least 3 players' };
    if (!selectedCategories().length) return { ok: false, reason: 'Pick at least one category' };
    if (!wordCount()) return { ok: false, reason: 'Those categories have no words' };
    return { ok: true };
  }

  /* The deal itself: a word, who is faking it, and who speaks first.
     Works off any list of players, so a room roster deals the same way
     the phone-passing one does. */
  function dealFor(list) {
    var category = pick(selectedCategories());
    var word = pickWord(category);
    rememberWord(category.id, word);

    var count = Math.max(1, Math.min(MAX_IMPOSTERS, state.imposterCount, list.length - 2));
    var imposters = {};
    shuffle(list).slice(0, count).forEach(function (p) { imposters[p.id] = true; });

    return {
      category: category,
      word: word,
      imposters: imposters,
      imposterCount: count,
      starter: pick(list)
    };
  }

  /* Can this list of players be dealt to at all? */
  function canDeal(list) {
    if (!list || list.length < 3) return { ok: false, reason: 'Needs at least 3 players' };
    if (!selectedCategories().length) return { ok: false, reason: 'Pick at least one category' };
    if (!wordCount()) return { ok: false, reason: 'Those categories have no words' };
    return { ok: true };
  }

  function startRound() {
    var check = canStart();
    if (!check.ok) return null;

    round = dealFor(state.players);
    round.order = state.settings.shuffleOrder ? shuffle(state.players) : state.players.slice();
    round.index = 0;
    round.seen = {};
    return round;
  }

  function currentRound() { return round; }
  function endRound() { round = null; }

  function currentPlayer() {
    return round ? round.order[round.index] : null;
  }

  /* What one player's card says. */
  function cardFor(player) {
    var isImposter = !!round.imposters[player.id];
    return {
      player: player,
      isImposter: isImposter,
      word: isImposter ? null : round.word,
      category: round.category,
      showCategory: !isImposter || state.settings.imposterSeesCategory
    };
  }

  /* What the player in front of the phone should see, plus where they are
     in the pass. */
  function currentCard() {
    var player = currentPlayer();
    if (!player) return null;
    var card = cardFor(player);
    card.seen = !!round.seen[player.id];
    card.position = round.index + 1;
    card.total = round.order.length;
    card.isLast = round.index === round.order.length - 1;
    return card;
  }

  /* The same card again for anyone who has forgotten theirs mid-round.
     Looking does not touch the pass, so it can be done any number of
     times without changing whose turn it is. */
  function peekCard(playerId) {
    var player = getPlayer(playerId);
    if (!round || !player) return null;
    return cardFor(player);
  }

  function markSeen() {
    var player = currentPlayer();
    if (player) round.seen[player.id] = true;
  }

  function nextPlayer() {
    if (!round || round.index >= round.order.length - 1) return false;
    round.index++;
    return true;
  }

  function imposterNames() {
    if (!round) return [];
    return state.players
      .filter(function (p) { return round.imposters[p.id]; })
      .map(function (p) { return p.name; });
  }

  /* ============================================================
     Settings
     ============================================================ */
  function setSetting(key, value) {
    if (!(key in state.settings)) return;
    state.settings[key] = !!value;
    save();
  }

  global.ImposterModel = {
    MAX_PLAYERS: MAX_PLAYERS,
    MAX_IMPOSTERS: MAX_IMPOSTERS,
    NAME_MAX: NAME_MAX,

    load: load, save: save, reset: reset,
    state: function () { return state; },

    myName: myName, setMyName: setMyName,

    addPlayer: addPlayer, removePlayer: removePlayer, renamePlayer: renamePlayer,
    clearPlayers: clearPlayers, getPlayer: getPlayer, movePlayer: movePlayer,
    cyclePlayerColor: cyclePlayerColor, PLAYER_COLORS: PLAYER_COLORS,

    maxImposters: maxImposters, setImposterCount: setImposterCount,

    allCategories: allCategories, getCategory: getCategory, isSelected: isSelected,
    toggleCategory: toggleCategory, selectAllCategories: selectAllCategories,
    selectedCategories: selectedCategories, wordCount: wordCount,
    parseWords: parseWords, saveCustomCategory: saveCustomCategory,
    deleteCustomCategory: deleteCustomCategory,

    canStart: canStart, canDeal: canDeal, dealFor: dealFor,
    startRound: startRound, currentRound: currentRound,
    endRound: endRound, currentPlayer: currentPlayer, currentCard: currentCard,
    peekCard: peekCard,
    markSeen: markSeen, nextPlayer: nextPlayer, imposterNames: imposterNames,

    setSetting: setSetting,
    shuffle: shuffle, pick: pick, randInt: randInt
  };

})(this);
