/* ============================================================
   app.js — screens, the hold-to-reveal card and the editors
   ============================================================ */
(function (global) {
  'use strict';

  var M = global.ImposterModel;
  var $ = function (id) { return document.getElementById(id); };

  var APP_VERSION = '1.0.0';
  var HOLD_MS = 180;          // must match .hold-bar's transition in styles.css

  var view = 'setup';
  var editingCategory = null;
  var wakeLock = null;

  /* ============================================================
     Small helpers
     ============================================================ */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(path, width) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', width || '2.2');
    p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
    return svg;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function buzz(pattern) {
    if (!M.state().settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  /* ============================================================
     Navigation
     ============================================================ */
  var VIEWS = ['setup', 'reveal', 'done'];

  function showView(name) {
    view = name;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== name; });
    $('start-dock').hidden = name !== 'setup';
    document.body.classList.toggle('is-playing', name !== 'setup');
    if (name === 'setup') releaseWake(); else requestWake();
    window.scrollTo({ top: 0 });
  }

  /* Keeps the screen on while the phone is being passed around. */
  function requestWake() {
    if (!M.state().settings.keepAwake) return;
    if (wakeLock || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }

  function releaseWake() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && view !== 'setup') requestWake();
  });

  /* ============================================================
     Setup — players
     ============================================================ */
  /* newId animates just that row in; a plain re-render must not re-pop the list */
  function renderPlayers(newId) {
    var s = M.state();
    var list = $('players');
    list.innerHTML = '';

    s.players.forEach(function (p, index) {
      var row = playerRow(p, index);
      if (p.id === newId) row.classList.add('is-new');
      list.appendChild(row);
    });

    $('player-count').textContent = s.players.length;
    $('players-empty').hidden = s.players.length > 0;
    $('btn-clear-players').hidden = s.players.length === 0;
    $('order-note').hidden = !s.settings.shuffleOrder || s.players.length < 2;
    renderStart();
  }

  function playerRow(player, index) {
    var row = el('div', 'player-row');
    row.style.setProperty('--player', player.color);
    row.dataset.id = player.id;
    row.addEventListener('pointerdown', function (e) { onRowDown(e, row, index); });
    row.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    var grip = el('button', 'row-grip');
    grip.type = 'button';
    grip.setAttribute('aria-label',
      'Reorder ' + player.name + '. Position ' + (index + 1) + ' of ' + M.state().players.length +
      '. Drag, or use the arrow keys.');
    grip.appendChild(icon('M4 8h16M4 12h16M4 16h16', '2'));
    grip.addEventListener('keydown', function (e) { nudgeRow(e, index); });

    var swatch = el('button', 'row-swatch');
    swatch.type = 'button';
    swatch.setAttribute('aria-label', "Change " + player.name + "'s colour");
    swatch.addEventListener('click', function () {
      if (!tapAllowed()) return;
      M.cyclePlayerColor(player.id);
      row.style.setProperty('--player', M.getPlayer(player.id).color);
      buzz(6);
    });

    var name = el('button', 'row-name', player.name);
    name.type = 'button';
    name.setAttribute('aria-label', 'Rename ' + player.name);
    name.addEventListener('click', function () {
      if (!tapAllowed()) return;
      var next = prompt('Rename player', player.name);
      if (next != null && M.renamePlayer(player.id, next)) renderPlayers();
    });

    var x = el('button', 'row-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove ' + player.name);
    x.appendChild(icon('M6 6l12 12M18 6 6 18'));
    x.addEventListener('click', function () {
      if (!tapAllowed()) return;
      M.removePlayer(player.id);
      buzz(8);
      renderPlayers();
      renderImposters();
    });

    row.appendChild(grip);
    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(x);
    return row;
  }

  /* ============================================================
     Reordering the list

     A row can be dragged straight away by its grip, or picked up by
     holding anywhere on it — which is what most people try first. A
     touch that moves before the row lifts is a scroll, so the page
     scrolls and nothing is picked up; once a row has lifted, scrolling
     is blocked until the finger comes off.

     Everything is tracked on the document rather than through pointer
     capture, so a finger that strays outside the row keeps dragging,
     and capture never steals the click from the buttons in the row.
     ============================================================ */
  var LIFT_MS = 200;        // hold before a row lifts, when not using the grip
  var SLOP = 8;             // movement that turns a hold into a scroll
  var press = null;         // a finger is down on a row
  var drag = null;          // ...and a row has lifted
  var suppressTapUntil = 0; // a drag must not leave a stray tap behind

  function tapAllowed() { return Date.now() > suppressTapUntil; }

  function onRowDown(e, row, index) {
    if (e.button != null && e.button !== 0) return;
    if (press || drag) return;
    /* the swatch and the remove button are taps, never handles */
    if (e.target.closest('.row-swatch, .row-x')) return;

    press = {
      row: row,
      index: index,
      startX: e.clientX,
      startY: e.clientY,
      timer: null
    };

    document.addEventListener('pointermove', onPressMove);
    document.addEventListener('pointerup', onPressUp);
    document.addEventListener('pointercancel', onPressUp);

    if (e.target.closest('.row-grip')) {
      e.preventDefault();       /* the grip is a handle, so lift at once */
      lift();
    } else {
      press.timer = setTimeout(lift, LIFT_MS);
    }
  }

  function onPressMove(e) {
    if (!press) return;
    if (drag) { onDragMove(e); return; }
    /* it moved before it lifted, so they are scrolling the page */
    if (Math.abs(e.clientY - press.startY) > SLOP ||
        Math.abs(e.clientX - press.startX) > SLOP) endPress();
  }

  function onPressUp() {
    if (drag) endDrag(); else endPress();
  }

  function endPress() {
    if (!press) return;
    clearTimeout(press.timer);
    document.removeEventListener('pointermove', onPressMove);
    document.removeEventListener('pointerup', onPressUp);
    document.removeEventListener('pointercancel', onPressUp);
    press = null;
  }

  function lift() {
    if (!press || drag) return;
    var rows = Array.prototype.slice.call($('players').children);
    if (rows.length < 2) { endPress(); return; }

    var first = rows[0].getBoundingClientRect();
    var second = rows[1].getBoundingClientRect();

    drag = {
      row: press.row,
      rows: rows,
      from: press.index,
      to: press.index,
      startY: press.startY,
      stride: second.top - first.top
    };

    drag.row.classList.add('is-dragging');
    $('players').classList.add('is-reordering');
    buzz(12);
  }

  function onDragMove(e) {
    var dy = e.clientY - drag.startY;
    var last = drag.rows.length - 1;
    /* keep the row inside the list rather than letting it fly off */
    var min = -drag.from * drag.stride;
    var max = (last - drag.from) * drag.stride;
    drag.row.style.transform = 'translateY(' + Math.max(min, Math.min(max, dy)) + 'px)';

    var to = Math.max(0, Math.min(last, drag.from + Math.round(dy / drag.stride)));
    if (to !== drag.to) {
      drag.to = to;
      layoutGap();
      buzz(5);
    }
  }

  function layoutGap() {
    drag.rows.forEach(function (r, i) {
      if (i === drag.from) return;
      var shift = 0;
      if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.stride;
      else if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = drag.stride;
      r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  function endDrag() {
    var moved = drag.from !== drag.to;

    drag.rows.forEach(function (r) { r.style.transform = ''; });
    drag.row.classList.remove('is-dragging');
    $('players').classList.remove('is-reordering');
    if (moved) {
      M.movePlayer(drag.from, drag.to);
      buzz(12);
    }
    drag = null;
    endPress();

    /* the release would otherwise land as a tap on whatever is now there */
    suppressTapUntil = Date.now() + 400;
    if (moved) renderPlayers();
  }

  /* While a row is lifted the page must not scroll under it. The hold has
     to sit still to lift at all, so no scroll is ever under way by then and
     this preventDefault still bites. */
  document.addEventListener('touchmove', function (e) {
    if (drag && e.cancelable) e.preventDefault();
  }, { passive: false });

  /* Arrow keys on the grip do the same job without a pointer. */
  function nudgeRow(e, index) {
    var delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    if (!M.movePlayer(index, index + delta)) return;
    buzz(10);
    renderPlayers();
    /* keep the keyboard on the row that just moved */
    var rows = $('players').children;
    var landed = rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
    if (landed) landed.querySelector('.row-grip').focus();
  }

  $('btn-use-order').addEventListener('click', function () {
    M.setSetting('shuffleOrder', false);
    renderPlayers();
    toast('Cards follow your order');
  });

  $('form-player').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('input-player');
    var res = M.addPlayer(input.value);

    if (res.ok) {
      input.value = '';
      buzz(10);
      renderPlayers(res.player.id);
      renderImposters();
      input.focus();
    } else if (res.reason === 'duplicate') {
      toast('That name is already in the list');
    } else if (res.reason === 'full') {
      toast('That is as many players as it holds');
    }
  });

  $('btn-clear-players').addEventListener('click', function () {
    if (!confirm('Remove all players?')) return;
    M.clearPlayers();
    renderPlayers();
    renderImposters();
  });

  /* ============================================================
     Setup — imposters
     ============================================================ */
  function renderImposters() {
    var s = M.state();
    var max = M.maxImposters();
    var enough = s.players.length >= 3;

    document.querySelectorAll('#imposter-seg .seg').forEach(function (btn) {
      var n = parseInt(btn.dataset.count, 10);
      var allowed = enough && n <= max;
      btn.disabled = !allowed;
      btn.setAttribute('aria-pressed', String(allowed && n === s.imposterCount));
    });

    var hint = $('imposter-hint');
    if (!enough) {
      hint.textContent = 'Add at least 3 players to choose.';
      hint.hidden = false;
    } else if (max < M.MAX_IMPOSTERS) {
      hint.textContent = s.players.length + ' players means up to ' + max +
        (max === 1 ? ' imposter' : ' imposters') + ' — two people always share the word.';
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  $('imposter-seg').addEventListener('click', function (e) {
    var btn = e.target.closest('.seg');
    if (!btn || btn.disabled) return;
    M.setImposterCount(btn.dataset.count);
    buzz(8);
    renderImposters();
  });

  /* ============================================================
     Setup — categories
     ============================================================ */
  function renderCategories() {
    var wrap = $('categories');
    wrap.innerHTML = '';

    M.allCategories().forEach(function (cat) {
      var chip = el('button', 'chip');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(M.isSelected(cat.id)));

      chip.appendChild(el('span', 'chip-emoji', cat.emoji));
      chip.appendChild(el('span', null, cat.name));

      chip.addEventListener('click', function () {
        M.toggleCategory(cat.id);
        chip.setAttribute('aria-pressed', String(M.isSelected(cat.id)));
        buzz(6);
        renderCategoryCount();
        renderStart();
      });

      if (cat.custom) {
        var edit = el('span', 'chip-edit');
        edit.setAttribute('role', 'button');
        edit.setAttribute('aria-label', 'Edit ' + cat.name);
        edit.appendChild(icon('M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z', '1.9'));
        edit.addEventListener('click', function (e) {
          e.stopPropagation();
          openCategorySheet(cat);
        });
        chip.appendChild(edit);
      }

      wrap.appendChild(chip);
    });

    renderCategoryCount();
  }

  function renderCategoryCount() {
    var n = M.selectedCategories().length;
    $('category-count').textContent = n ? n + ' · ' + M.wordCount() + ' words' : '0';
  }

  $('btn-select-all').addEventListener('click', function () {
    M.selectAllCategories(true);
    renderCategories();
    renderStart();
  });

  $('btn-select-none').addEventListener('click', function () {
    M.selectAllCategories(false);
    renderCategories();
    renderStart();
  });

  $('btn-new-category').addEventListener('click', function () { openCategorySheet(null); });

  /* ============================================================
     Start button
     ============================================================ */
  function renderStart() {
    var check = M.canStart();
    $('btn-start').disabled = !check.ok;
    $('start-reason').textContent = check.reason || '';
    $('start-reason').hidden = !!check.ok;
  }

  $('btn-start').addEventListener('click', function () {
    if (!M.startRound()) return;
    buzz(14);
    renderCard();
    showView('reveal');
  });

  /* ============================================================
     Reveal — the card

     A card only opens after the finger has been down for HOLD_MS,
     so brushing the screen while the phone changes hands can never
     show somebody else's word.
     ============================================================ */
  var holding = false;
  var holdTimer = null;

  function renderCard() {
    var card = M.currentCard();
    if (!card) return;

    closeCard();
    $('card').style.setProperty('--player', card.player.color);
    $('card').classList.toggle('is-seen', card.seen);
    $('card').classList.toggle('is-imposter', card.isImposter);
    $('card-eyebrow').textContent = card.position === 1 ? 'First up' : 'Pass to';
    $('card-name').textContent = card.player.name;

    /* Fill the back now — it is behind an opaque face until opened. */
    if (card.isImposter) {
      $('back-label').textContent = 'You are the';
      $('back-word').textContent = 'Imposter';
      $('back-word').className = 'back-word is-imposter';
      $('back-note').textContent = card.showCategory
        ? 'The category is ' + card.category.name + ' — bluff it.'
        : 'Blend in. You get no word at all.';
    } else {
      $('back-label').textContent = 'Secret word';
      $('back-word').textContent = card.word;
      $('back-word').className = 'back-word ' + lengthClass(card.word);
      $('back-note').textContent = card.category.emoji + ' ' + card.category.name;
    }

    /* progress dots */
    var dots = $('progress');
    dots.innerHTML = '';
    for (var i = 0; i < card.total; i++) {
      var dot = el('span', 'dot');
      if (i < card.position - 1) dot.classList.add('is-done');
      else if (i === card.position - 1) dot.classList.add('is-now');
      dots.appendChild(dot);
    }
    $('progress-text').textContent = card.position + ' / ' + card.total;

    renderNextButton(card);
  }

  function lengthClass(word) {
    var n = word.length;
    if (n > 18) return 'len-lg';
    if (n > 11) return 'len-md';
    return '';
  }

  function renderNextButton(card) {
    var btn = $('btn-next');
    var seen = card.seen;
    btn.disabled = !seen;

    if (!seen) {
      btn.textContent = 'Hold the card first';
    } else if (card.isLast) {
      btn.textContent = "That's everyone — who starts?";
    } else {
      var next = M.currentRound().order[M.currentRound().index + 1];
      btn.textContent = 'Next: ' + next.name;
    }
  }

  function openCard() {
    if (!holding) return;
    $('card').classList.add('is-open');
    M.markSeen();
    renderNextButton(M.currentCard());
    buzz(12);
  }

  function closeCard() {
    holding = false;
    clearTimeout(holdTimer);
    $('card').classList.remove('is-open', 'is-holding');
  }

  function startHold(e) {
    if (e.button != null && e.button !== 0) return;
    if (holding) return;
    holding = true;
    $('card').classList.add('is-holding');
    clearTimeout(holdTimer);
    holdTimer = setTimeout(openCard, HOLD_MS);
  }

  var card = $('card');
  card.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    card.setPointerCapture && card.setPointerCapture(e.pointerId);
    startHold(e);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
    card.addEventListener(evt, closeCard);
  });
  card.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  card.addEventListener('click', function (e) { e.preventDefault(); });

  /* Space or Enter held down works the same way on a keyboard. */
  card.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) startHold(e);
  });
  card.addEventListener('keyup', function (e) {
    if (e.key === ' ' || e.key === 'Enter') closeCard();
  });
  card.addEventListener('blur', closeCard);

  $('btn-next').addEventListener('click', function () {
    closeCard();
    if (M.nextPlayer()) {
      renderCard();
      buzz(8);
    } else {
      showDone();
    }
  });

  $('btn-quit').addEventListener('click', function () {
    if (!confirm('Quit this round? Nobody else will see their card.')) return;
    closeCard();
    M.endRound();
    showView('setup');
  });

  /* ============================================================
     Round start
     ============================================================ */
  function showDone() {
    var round = M.currentRound();
    if (!round) return;

    $('starter').style.setProperty('--player', round.starter.color);
    $('starter-name').textContent = round.starter.name;
    $('done-sub').textContent = round.imposterCount === 1
      ? 'Say one word about the secret word, then go round the group. One of you is faking it.'
      : 'Say one word about the secret word, then go round the group. ' +
        round.imposterCount + ' of you are faking it.';

    closeAnswer();
    $('answer-back').innerHTML = '';
    var word = el('span', null, 'The word was ');
    word.appendChild(el('b', 'answer-word', round.word));
    var who = el('span', null, ' · ');
    var names = M.imposterNames();
    who.appendChild(el('b', 'answer-who',
      names.join(' & ') + (names.length === 1 ? ' was the imposter' : ' were the imposters')));
    $('answer-back').appendChild(word);
    $('answer-back').appendChild(who);

    buzz([12, 60, 12]);
    showView('done');
  }

  $('btn-again').addEventListener('click', function () {
    if (!M.startRound()) { showView('setup'); return; }
    buzz(14);
    renderCard();
    showView('reveal');
  });

  $('btn-setup').addEventListener('click', function () {
    M.endRound();
    showView('setup');
  });

  /* end-of-round answer, held open the same way as a card */
  var answer = $('answer-card');
  var answerTimer = null;

  function closeAnswer() {
    clearTimeout(answerTimer);
    answer.classList.remove('is-open');
  }

  answer.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    answer.setPointerCapture && answer.setPointerCapture(e.pointerId);
    clearTimeout(answerTimer);
    answerTimer = setTimeout(function () { answer.classList.add('is-open'); }, HOLD_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
    answer.addEventListener(evt, closeAnswer);
  });
  answer.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ============================================================
     Sheets
     ============================================================ */
  function openSheet(id) {
    $('scrim').hidden = false;
    $(id).hidden = false;
  }

  function closeSheets() {
    $('scrim').hidden = true;
    $('sheet-settings').hidden = true;
    $('sheet-category').hidden = true;
  }

  $('scrim').addEventListener('click', closeSheets);
  document.querySelectorAll('[data-close-sheet]').forEach(function (btn) {
    btn.addEventListener('click', closeSheets);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheets();
  });

  /* ---------- settings ---------- */
  var SETTING_IDS = {
    'set-cat': 'imposterSeesCategory',
    'set-shuffle': 'shuffleOrder',
    'set-haptics': 'haptics',
    'set-awake': 'keepAwake'
  };

  Object.keys(SETTING_IDS).forEach(function (id) {
    $(id).addEventListener('change', function () {
      M.setSetting(SETTING_IDS[id], $(id).checked);
      if (SETTING_IDS[id] === 'keepAwake') {
        if ($(id).checked) requestWake(); else releaseWake();
      }
    });
  });

  $('btn-settings').addEventListener('click', function () {
    var s = M.state();
    Object.keys(SETTING_IDS).forEach(function (id) {
      $(id).checked = s.settings[SETTING_IDS[id]];
    });
    openSheet('sheet-settings');
  });

  $('btn-reset').addEventListener('click', function () {
    if (!confirm('Reset everything? Players, categories and settings all go back to the start.')) return;
    M.reset();
    closeSheets();
    renderAll();
    showView('setup');
    toast('Everything reset');
  });

  /* ---------- category editor ---------- */
  var EMOJI_CHOICES = ('🎩✏️🍕🐾🎬💼🌍⚽🏠✈️🎵🎒📱🚗🌦️🎉🍺🧩🔮🦄🏆🎨🐙🚀' +
    '💡🧠🎯🕹️📺🍀🔥⭐️').match(/\p{Extended_Pictographic}(️)?/gu) || ['✏️'];

  function openCategorySheet(cat) {
    editingCategory = cat || null;
    $('cat-sheet-title').textContent = cat ? 'Edit category' : 'New category';
    $('cat-emoji').textContent = cat ? cat.emoji : M.pick(EMOJI_CHOICES);
    $('cat-name').value = cat ? cat.name : '';
    $('cat-words').value = cat ? cat.words.join('\n') : '';
    $('cat-delete').hidden = !cat;
    updateWordCount();
    openSheet('sheet-category');
  }

  function updateWordCount() {
    var n = M.parseWords($('cat-words').value).length;
    $('cat-word-count').textContent = n + (n === 1 ? ' word' : ' words');
  }

  $('cat-words').addEventListener('input', updateWordCount);

  $('cat-emoji').addEventListener('click', function () {
    var at = EMOJI_CHOICES.indexOf($('cat-emoji').textContent);
    $('cat-emoji').textContent = EMOJI_CHOICES[(at + 1) % EMOJI_CHOICES.length];
  });

  $('cat-save').addEventListener('click', function () {
    var name = $('cat-name').value.trim();
    var words = M.parseWords($('cat-words').value);

    if (!name) { toast('Give the category a name'); $('cat-name').focus(); return; }
    if (words.length < 2) { toast('Add at least 2 words'); $('cat-words').focus(); return; }

    M.saveCustomCategory({
      id: editingCategory ? editingCategory.id : null,
      emoji: $('cat-emoji').textContent,
      name: name,
      words: words
    });

    closeSheets();
    renderCategories();
    renderStart();
    toast(editingCategory ? 'Category saved' : 'Category added');
  });

  $('cat-delete').addEventListener('click', function () {
    if (!editingCategory) return;
    if (!confirm('Delete "' + editingCategory.name + '"?')) return;
    M.deleteCustomCategory(editingCategory.id);
    closeSheets();
    renderCategories();
    renderStart();
    toast('Category deleted');
  });

  /* ============================================================
     Service worker — activate a new build and reload, unless a
     round is in progress or something is being typed into a sheet.
     ============================================================ */
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function offerUpdate(worker) {
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            if (view === 'setup' && $('sheet-category').hidden) worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      }
      offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () { offerUpdate(reg.installing); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    }).catch(function () {});

    /* On a first-ever visit the worker claims a page that was loaded
       without one. That is not a new build, so there is nothing to
       refresh — reloading there would throw away whatever the host
       had already typed. */
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
  }

  /* ============================================================
     Boot
     ============================================================ */
  function renderAll() {
    renderPlayers();
    renderImposters();
    renderCategories();
    renderStart();
  }

  M.load();
  renderAll();
  showView('setup');
  $('version').textContent = 'Imposter v' + APP_VERSION;
  registerSW();

})(this);
