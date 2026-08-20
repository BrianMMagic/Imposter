/* ============================================================
   app.js — screens, the hold-to-reveal card and the editors
   ============================================================ */
(function (global) {
  'use strict';

  var M = global.ImposterModel;
  var R = global.ImposterRoom;
  var $ = function (id) { return document.getElementById(id); };

  var APP_VERSION = '1.0.0';
  var HOLD_MS = 180;          // must match .hold-bar's transition in styles.css

  var view = 'setup';
  var editingCategory = null;
  var cameFromGameSheet = false;
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

  /* Android phones do this; iPhones ignore it entirely. Nothing is offered
     to switch it off, because on the phones where it would matter there is
     nothing to switch off. */
  function buzz(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  /* ============================================================
     Appearance

     Dark unless the phone says light, until somebody picks one —
     then that, on this phone, for good.
     ============================================================ */
  var THEME_COLORS = { dark: '#12121a', light: '#f4f5fb' };

  function applyTheme() {
    var choice = M.state().theme;
    var root = document.documentElement;

    if (choice === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);

    var showing = choice === 'auto'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : choice;
    var tag = document.querySelector('meta[name="theme-color"]');
    if (tag) tag.setAttribute('content', THEME_COLORS[showing]);

    document.querySelectorAll('#theme-seg .seg').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.theme === choice));
    });
  }

  $('theme-seg').addEventListener('click', function (e) {
    var btn = e.target.closest('.seg');
    if (!btn) return;
    M.setTheme(btn.dataset.theme);
    applyTheme();
    buzz(6);
  });

  /* on auto, follow the phone if it changes under us */
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (M.state().theme === 'auto') applyTheme();
  });

  /* ============================================================
     Dialog

     What confirm() and prompt() are for, wearing the app's own
     clothes instead of the browser's. Resolves to true, or to the
     typed string when there is a field; to false or null if it is
     dismissed, so `if (!answer) return;` reads the same either way.
     ============================================================ */
  var dismissDialog = null;

  function ask(opts) {
    if (dismissDialog) dismissDialog();        /* never two of them at once */

    var typing = !!opts.field;
    var box = $('dialog');
    var scrim = $('dialog-scrim');
    var form = $('dialog-field');
    var input = $('dialog-input');
    var ok = $('dialog-ok');
    var cancel = $('dialog-cancel');
    var cameFrom = document.activeElement;

    $('dialog-title').textContent = opts.title || '';
    $('dialog-body').textContent = opts.body || '';
    ok.textContent = opts.ok || 'OK';
    cancel.textContent = opts.cancel || 'Cancel';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');

    form.hidden = !typing;
    if (typing) {
      input.value = opts.field.value || '';
      input.maxLength = opts.field.max || M.NAME_MAX;
      input.placeholder = opts.field.placeholder || '';
    }

    scrim.hidden = false;
    box.hidden = false;
    if (typing) { input.focus(); input.select(); } else { ok.focus(); }

    return new Promise(function (resolve) {
      function close(value) {
        dismissDialog = null;
        box.hidden = true;
        scrim.hidden = true;
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        scrim.removeEventListener('click', onCancel);
        form.removeEventListener('submit', onOk);
        document.removeEventListener('keydown', onKey, true);
        /* put the keyboard back where it was, so a dialog opened from a
           row leaves you on that row rather than at the top of the page */
        if (cameFrom && cameFrom.focus && document.contains(cameFrom)) {
          try { cameFrom.focus(); } catch (e) {}
        }
        resolve(value);
      }

      function onOk(e) {
        if (e) e.preventDefault();
        if (typing && !input.value.trim()) { input.focus(); return; }
        close(typing ? input.value : true);
      }

      function onCancel() { close(typing ? null : false); }

      /* Captured, so Escape closes this and not the sheet underneath it. */
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
        if (e.key !== 'Tab') return;
        var stops = (typing ? [input] : []).concat([cancel, ok]);
        var at = stops.indexOf(document.activeElement);
        e.preventDefault();
        stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }

      dismissDialog = onCancel;
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      scrim.addEventListener('click', onCancel);
      form.addEventListener('submit', onOk);
      document.addEventListener('keydown', onKey, true);
    });
  }

  /* ============================================================
     Navigation
     ============================================================ */
  var VIEWS = ['setup', 'join', 'lobby', 'reveal', 'done', 'verdict', 'vote'];
  var PLAYING = ['reveal', 'done', 'verdict', 'vote'];

  function showView(name) {
    view = name;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== name; });
    $('start-dock').hidden = name !== 'setup';
    document.body.classList.toggle('is-playing', PLAYING.indexOf(name) !== -1);
    if (name === 'setup' || name === 'join') releaseWake(); else requestWake();
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
      ask({
        title: 'Rename player',
        ok: 'Save',
        field: { value: player.name, max: M.NAME_MAX, placeholder: 'Name' }
      }).then(function (next) {
        if (next != null && M.renamePlayer(player.id, next)) renderPlayers();
      });
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
    ask({
      title: 'Remove all players?',
      body: 'The list goes back to empty. Your categories and settings are untouched.',
      ok: 'Remove all', danger: true
    }).then(function (yes) {
      if (!yes) return;
      M.clearPlayers();
      renderPlayers();
      renderImposters();
    });
  });

  /* ============================================================
     Setup — imposters
     ============================================================ */
  function renderImposters() {
    var s = M.state();
    var hint = $('imposter-hint');

    /* A room has no line-up yet — the people who will play are not in any
       list on this phone, they are still opening the app. So the choice is
       open here, and the lobby brings it down to size once they arrive. */
    if (mode === 'room') {
      document.querySelectorAll('#imposter-seg .seg').forEach(function (btn) {
        btn.disabled = false;
        btn.setAttribute('aria-pressed',
          String(parseInt(btn.dataset.count, 10) === s.imposterCount));
      });
      hint.textContent = 'Whoever joins sets the limit — two people always share the word, so ' +
        'this comes down in the lobby if the room is small.';
      hint.hidden = false;
      return;
    }

    var max = M.maxImposters();
    var enough = s.players.length >= 3;

    document.querySelectorAll('#imposter-seg .seg').forEach(function (btn) {
      var n = parseInt(btn.dataset.count, 10);
      var allowed = enough && n <= max;
      btn.disabled = !allowed;
      btn.setAttribute('aria-pressed', String(allowed && n === Math.min(s.imposterCount, max)));
    });

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
    /* nothing to measure against in a room, so let them ask for any of them */
    M.setImposterCount(btn.dataset.count,
      mode === 'room' ? M.MAX_IMPOSTERS : M.maxImposters());
    buzz(8);
    renderImposters();
    renderRoomImposters();
    renderLobbySummary();
  });

  /* ============================================================
     Setup — categories
     ============================================================ */
  function renderCategories() {
    renderChipsInto($('categories'));
    renderChipsInto($('categories-room'));
    renderCategoryCount();
  }

  function renderChipsInto(wrap) {
    if (!wrap) return;
    wrap.innerHTML = '';

    M.allCategories().forEach(function (cat) {
      var chip = el('button', 'chip');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(M.isSelected(cat.id)));

      chip.appendChild(el('span', 'chip-emoji', cat.emoji));
      chip.appendChild(el('span', null, cat.name));

      chip.addEventListener('click', function () {
        M.toggleCategory(cat.id);
        buzz(6);
        /* both grids show the same selection, so redraw whichever exist */
        renderCategories();
        renderStart();
        renderLobbySummary();
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
  }

  function renderCategoryCount() {
    var n = M.selectedCategories().length;
    var label = n ? n + ' · ' + M.wordCount() + ' words' : '0';
    $('category-count').textContent = label;
    if ($('category-count-room')) $('category-count-room').textContent = label;
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
    if (mode === 'room') {
      var ready = M.selectedCategories().length > 0;
      $('btn-start').disabled = !ready;
      $('btn-start').textContent = 'Create room';
      $('start-reason').textContent = ready ? '' : 'Pick at least one category';
      $('start-reason').hidden = ready;
      return;
    }
    var check = M.canStart();
    $('btn-start').disabled = !check.ok;
    $('btn-start').textContent = 'Start game';
    $('start-reason').textContent = check.reason || '';
    $('start-reason').hidden = !!check.ok;
  }

  $('btn-start').addEventListener('click', function () {
    if (mode === 'room') { createRoom(); return; }
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
  var peeking = null;        // a player id while somebody re-checks their card

  function renderCard() {
    var card = M.currentCard();
    if (!card) return;
    peeking = null;

    paintCard(card, card.position === 1 ? 'First up' : 'Pass to');

    var dots = $('progress');
    dots.innerHTML = '';
    for (var i = 0; i < card.total; i++) {
      var dot = el('span', 'dot');
      if (i < card.position - 1) dot.classList.add('is-done');
      else if (i === card.position - 1) dot.classList.add('is-now');
      dots.appendChild(dot);
    }
    $('progress-text').textContent = card.position + ' / ' + card.total;
    $('btn-quit').setAttribute('aria-label', 'Quit round');

    renderNextButton(card);
  }

  /* Fills the card for whoever it belongs to. The back is written now, but
     it sits behind an opaque face until the card is held open. */
  function paintCard(card, eyebrow) {
    closeCard();
    var node = $('card');
    node.style.setProperty('--player', card.player.color);
    node.classList.toggle('is-seen', !!card.seen);
    node.classList.toggle('is-imposter', card.isImposter);
    $('card-eyebrow').textContent = eyebrow;
    $('card-name').textContent = card.player.name;

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
  }

  /* Someone has forgotten their word mid-round. Same card, same hold to
     open it, but it changes nothing about whose turn it is. */
  function showPeek(playerId) {
    var card = M.peekCard(playerId);
    if (!card) return;
    peeking = playerId;

    paintCard(card, 'Reminder for');
    $('progress').innerHTML = '';            /* keeps its space, shows no steps */
    $('progress-text').textContent = 'Reminder';
    $('btn-quit').setAttribute('aria-label', 'Back to the round');
    $('btn-next').disabled = false;
    $('btn-next').textContent = 'Back to the round';
    showView('reveal');
  }

  function endPeek() {
    closeCard();
    peeking = null;
    showView('done');
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
    if (!peeking && !room) {
      M.markSeen();
      renderNextButton(M.currentCard());
    }
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
    if (peeking) { endPeek(); return; }
    closeCard();
    if (M.nextPlayer()) {
      renderCard();
      buzz(8);
    } else {
      showDone();
    }
  });

  $('btn-quit').addEventListener('click', function () {
    if (peeking) { endPeek(); return; }
    if (room) { askLeaveRoom(); return; }
    ask({
      title: 'Quit this round?',
      body: 'Nobody else will see their card.',
      ok: 'Quit', danger: true
    }).then(function (yes) {
      if (!yes) return;
      closeCard();
      M.endRound();
      showView('setup');
    });
  });

  /* ============================================================
     Round start
     ============================================================ */
  function renderPeekList() {
    var list = $('peek-list');
    list.innerHTML = '';
    M.state().players.forEach(function (p) {
      var chip = el('button', 'peek-chip');
      chip.type = 'button';
      chip.style.setProperty('--player', p.color);
      chip.setAttribute('aria-label', 'Show ' + p.name + "'s card again");
      chip.appendChild(el('span', null, p.name));
      chip.addEventListener('click', function () { showPeek(p.id); });
      list.appendChild(chip);
    });
  }

  function showDone() {
    var round = M.currentRound();
    if (!round) return;
    peeking = null;
    renderPeekList();

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
    document.querySelectorAll('.sheet').forEach(function (sheet) { sheet.hidden = true; });
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

  /* Both of these change how a round is dealt, and only the phone that
     deals it acts on them — so in a room they are the host's, and on
     anybody else's phone they would be two switches wired to nothing.
     Shuffling the pass order has no meaning in a room at all. */
  function renderSettingsScope() {
    var deals = !room || room.isHost;
    $('row-set-cat').hidden = !deals;
    $('row-set-shuffle').hidden = !!room;
    $('settings-game').hidden = $('row-set-cat').hidden && $('row-set-shuffle').hidden;
  }

  $('btn-settings').addEventListener('click', function () {
    var s = M.state();
    Object.keys(SETTING_IDS).forEach(function (id) {
      $(id).checked = s.settings[SETTING_IDS[id]];
    });
    applyTheme();
    renderSettingsScope();
    openSheet('sheet-settings');
  });

  $('btn-reset').addEventListener('click', function () {
    ask({
      title: 'Reset everything?',
      body: 'Players, categories, your name and settings all go back to the start.',
      ok: 'Reset', danger: true
    }).then(function (yes) {
      if (!yes) return;
      M.reset();
      closeSheets();
      applyTheme();
      renderAll();
      renderVoteRounds();
      $('input-host-name').value = '';
      showView('setup');
      toast('Everything reset');
    });
  });

  /* ---------- category editor ---------- */
  var EMOJI_CHOICES = ('🎩✏️🍕🐾🎬💼🌍⚽🏠✈️🎵🎒📱🚗🌦️🎉🍺🧩🔮🦄🏆🎨🐙🚀' +
    '💡🧠🎯🕹️📺🍀🔥⭐️').match(/\p{Extended_Pictographic}(️)?/gu) || ['✏️'];

  function openCategorySheet(cat, fromGame) {
    editingCategory = cat || null;
    cameFromGameSheet = !!fromGame || (!!room && !$('sheet-game').hidden);
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
    renderLobbySummary();
    backToGameSheet();
    toast(editingCategory ? 'Category saved' : 'Category added');
  });

  $('cat-delete').addEventListener('click', function () {
    if (!editingCategory) return;
    var doomed = editingCategory;
    ask({
      title: 'Delete “' + doomed.name + '”?',
      body: 'Its ' + doomed.words.length + ' words go with it. This cannot be undone.',
      ok: 'Delete', danger: true
    }).then(function (yes) {
      if (!yes) return;
      M.deleteCustomCategory(doomed.id);
      closeSheets();
      renderCategories();
      renderStart();
      renderLobbySummary();
      backToGameSheet();
      toast('Category deleted');
    });
  });

  /* ============================================================
     Playing on separate phones

     One phone hosts: it deals exactly as it would when the phone is
     passed round, then seals each card to the player it belongs to
     and puts them where the others can fetch them. The round itself
     never leaves the host's phone, and no phone can open a card that
     is not its own.
     ============================================================ */
  var mode = 'pass';
  var room = null;          // { code, playerId, isHost, roster, round, stop }

  function roomsAvailable() { return !!R && R.configured(); }

  function setMode(next) {
    mode = next === 'room' && roomsAvailable() ? 'room' : 'pass';
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-seg .seg').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    });
    if (mode === 'room' && !$('input-host-name').value) $('input-host-name').value = rememberedName();
    /* the imposter choice reads differently in each mode, and the voting
       card only exists in one of them */
    renderImposters();
    renderVoteRounds();
    renderStart();
  }

  /* What to put in a name field before anyone types: what this phone
     called itself last time, falling back to the top of the players list
     for somebody who has only ever passed the phone round. */
  function rememberedName() {
    var first = M.state().players[0];
    return M.myName() || (first && first.name) || '';
  }

  document.querySelector('.mode-seg').addEventListener('click', function (e) {
    var btn = e.target.closest('.seg');
    if (!btn) return;
    setMode(btn.dataset.mode);
    buzz(8);
  });

  /* ---------- starting a room ---------- */
  function hostName() { return $('input-host-name').value.replace(/\s+/g, ' ').trim(); }

  /* A form with one field and no submit button still submits when Enter is
     pressed, and an unhandled submit reloads the page — which booted the app
     again, put it back on One phone and threw the typed name away. There is
     nothing to submit here, so Enter just puts the keyboard away and leaves
     Create room sitting there waiting. */
  $('form-host-name').addEventListener('submit', function (e) {
    e.preventDefault();
    $('input-host-name').blur();
  });

  /* Keep it even if they wander off without opening a room. */
  $('input-host-name').addEventListener('change', function () {
    M.setMyName(hostName());
  });

  function createRoom() {
    var name = hostName();
    if (!name) { toast('Put your name in first'); $('input-host-name').focus(); return; }

    var btn = $('btn-start');
    btn.disabled = true;
    btn.textContent = 'Opening the room…';

    M.setMyName(name);

    R.createRoom()
      .then(function (code) {
        return R.joinRoom(code, name).then(function (me) {
          room = { code: code, playerId: me.playerId, isHost: true, roster: [], round: 0 };
        });
      })
      .then(function () {
        enterRoom();
      })
      .catch(function (err) {
        roomTrouble(err);
        btn.disabled = false;
        btn.textContent = 'Create room';
        renderStart();
      });
  }

  /* ---------- joining one ---------- */
  $('btn-open-join').addEventListener('click', function () { openJoin(''); });

  function openJoin(code) {
    $('input-code').value = code || '';
    $('input-join-name').value = rememberedName();
    $('join-error').hidden = true;
    showView('join');
    /* with a name already filled in, the code is the only thing left to do */
    if (!code) $('input-code').focus();
    else if (!$('input-join-name').value) $('input-join-name').focus();
  }

  $('btn-join-back').addEventListener('click', function () { showView('setup'); });

  $('form-join').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('input-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    var name = $('input-join-name').value.replace(/\s+/g, ' ').trim();
    var problem = $('join-error');
    problem.hidden = true;

    if (code.length !== R.CODE_LEN) { return joinProblem('That code is ' + R.CODE_LEN + ' letters'); }
    if (!name) { return joinProblem('Put your name in too'); }

    var btn = $('btn-join');
    btn.disabled = true;
    btn.textContent = 'Joining…';

    M.setMyName(name);

    R.roomExists(code)
      .then(function (found) {
        if (!found) throw new Error('No room with that code — check it and try again');
        return R.joinRoom(code, name);
      })
      .then(function (me) {
        room = { code: code, playerId: me.playerId, isHost: false, roster: [], round: 0 };
        enterRoom();
      })
      .catch(function (err) { joinProblem(friendlyTrouble(err)); })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Join';
      });
  });

  function joinProblem(message) {
    var problem = $('join-error');
    problem.textContent = message;
    problem.hidden = false;
    buzz(20);
  }

  /* Chrome says "Failed to fetch", Safari says "Load failed"; neither means
     anything to somebody standing in a kitchen with no signal. */
  function friendlyTrouble(err) {
    var message = (err && err.message) || '';
    if (/fetch|network|Load failed|ERR_/i.test(message)) {
      return 'Cannot reach the room — check the connection';
    }
    return message || 'Something went wrong';
  }

  function roomTrouble(err) { toast(friendlyTrouble(err)); }

  /* ---------- being in a room ----------
     Every control that belongs to the host alone is set from one place,
     so no screen can leave one of them showing on somebody else's phone
     — and a phone that hosted one room and joined the next cannot carry
     the host's buttons across with it. */
  function applyHostControls() {
    var host = !!room && room.isHost;
    $('btn-lobby-start').hidden = !host;
    $('lobby-settings').hidden = !host;
    $('lobby-hint').hidden = !host;
    $('room-actions').hidden = !host;
    $('verdict-actions').hidden = !host;
    $('vote-actions').hidden = !host;
    $('room-wait').hidden = host;
    $('verdict-wait').hidden = host;
    $('verdict-guest').hidden = host;
    $('room-roster').hidden = !host || !room || !room.dealtWith;

    /* The card screen only offers a vote while there is one left to run. */
    var planned = (room && room.votesPlanned) || M.state().voteRounds;
    var used = (room && room.vote) || 0;
    $('btn-room-vote').hidden = used >= planned;
    $('btn-room-vote').textContent = used ? 'Vote again' : 'Start the vote';
    $('btn-room-reveal').className = 'btn ' + (used >= planned ? 'btn-primary' : 'btn-ghost');

    /* On the vote screen, what the host is offered depends on whether the
       ballots are all in — there is nothing to move on to until they are,
       and until then everybody else is simply waiting for a phone to ring. */
    var voting = !!room && !!room.vote;
    var done = voting && voteDone();
    $('vote-wait').hidden = host || !voting || !done;
    if (!host || !voting) return;

    $('btn-vote-next').hidden = !done || room.vote >= room.votesPlanned;
    $('btn-vote-reveal').hidden = !done;
    $('btn-vote-again').hidden = !done;
    $('btn-vote-end').hidden = !done;
    $('btn-vote-close').hidden = done;
    document.querySelector('#vote-actions .room-actions-row').hidden = !done;
  }

  function enterRoom() {
    $('lobby-code-text').textContent = room.code;
    applyHostControls();
    renderLobby();
    showView('lobby');
    watchRoom();
    refreshRoster();
  }

  function watchRoom() {
    if (room.stop) room.stop();
    room.stop = R.watch(room.code, onRoomChanged, function () {
      $('lobby-status').textContent = 'Trouble reaching the room — still trying…';
    });
  }

  function onRoomChanged(meta) {
    if (!room) return;
    if (!meta) { leaveRoom('The host closed the room'); return; }

    refreshRoster();

    if (meta.phase === 'revealed') {
      room.round = meta.round;
      showVerdict(meta);
    } else if (meta.phase === 'voting') {
      room.round = meta.round;
      enterVoting(meta);
    } else if (meta.phase === 'dealt' && meta.round !== room.round) {
      room.round = meta.round;
      room.starter = meta.starter;
      room.votesPlanned = meta.votesPlanned || 1;
      room.vote = 0;
      room.voteClosed = null;
      room.voters = null;
      collectCard();
    } else if (meta.phase === 'lobby' && room.round) {
      room.round = 0;
      showView('lobby');
      renderLobby();
    }
  }

  function refreshRoster() {
    R.players(room.code).then(function (list) {
      if (!room) return;
      room.roster = list.map(function (p, i) {
        p.color = M.PLAYER_COLORS[i % M.PLAYER_COLORS.length];
        return p;
      });
      renderLobby();
      renderRoomStatus();
    }).catch(function () {});
  }

  /* The same chips in the lobby, on the answer screen, and anywhere else
     the room's line-up is worth showing. */
  function renderRoomPlayers(into) {
    into.innerHTML = '';
    room.roster.forEach(function (p) {
      var chip = el('span', 'lobby-player');
      chip.style.setProperty('--player', p.color);
      if (p.id === room.playerId) chip.classList.add('is-me');
      chip.appendChild(el('span', null, p.name + (p.id === room.playerId ? ' (you)' : '')));
      into.appendChild(chip);
    });
  }

  /* The room stays open all game, so people can turn up mid-round. This is
     how the host finds out, without leaving the screen they are on. */
  function renderRoomStatus() {
    if (!room) return;
    if (!$('view-verdict').hidden) renderRoomPlayers($('verdict-players'));

    var line = $('room-roster');
    if (!room.isHost || !room.dealtWith) { line.hidden = true; return; }

    var waiting = room.roster.length - room.dealtWith;
    line.innerHTML = '';
    line.appendChild(document.createTextNode(room.roster.length + ' in the room'));
    if (waiting > 0) {
      line.appendChild(document.createTextNode(' · '));
      line.appendChild(el('b', null, waiting + (waiting === 1 ? ' joined since' : ' joined since')));
      line.appendChild(document.createTextNode(' — deal again to bring them in'));
    }
    line.hidden = false;
  }

  function renderLobby() {
    if (!room) return;
    renderRoomPlayers($('lobby-players'));

    $('lobby-count').textContent = room.roster.length;
    $('lobby-empty').hidden = room.roster.length > 0;
    applyHostControls();
    renderLobbySummary();
    renderRoomImposters();

    if (room.isHost) {
      var check = M.canDeal(room.roster);
      $('btn-lobby-start').disabled = !check.ok;
      $('lobby-reason').textContent = check.reason || '';
      $('lobby-reason').hidden = !!check.ok;
      $('lobby-status').textContent = check.ok
        ? 'Start when everyone is in — you can deal again at any point.'
        : '';
    } else if (room.waiting) {
      $('lobby-status').textContent =
        'A round is already under way — you are in for the next one.';
    } else {
      $('lobby-status').textContent = 'You are in. Waiting for the host to start…';
    }
  }

  /* ---------- changing the game from the lobby ----------
     The imposter cap is whoever has actually joined, which only the
     lobby knows — the setup screen has no line-up to measure. */
  function roomImposterCap() {
    return room ? room.roster.length - 2 : 1;
  }

  function renderRoomImposters() {
    if (!room) return;
    var cap = roomImposterCap();
    var max = Math.max(1, Math.min(M.MAX_IMPOSTERS, cap));
    var enough = cap >= 1;
    var count = M.state().imposterCount;

    document.querySelectorAll('#imposter-seg-room .seg').forEach(function (btn) {
      var n = parseInt(btn.dataset.count, 10);
      var allowed = enough && n <= max;
      btn.disabled = !allowed;
      btn.setAttribute('aria-pressed', String(allowed && n === Math.min(count, max)));
    });

    var hint = $('imposter-hint-room');
    if (!enough) {
      hint.textContent = 'Waiting for at least 3 players.';
      hint.hidden = false;
    } else if (max < M.MAX_IMPOSTERS) {
      hint.textContent = room.roster.length + ' players means up to ' + max +
        (max === 1 ? ' imposter' : ' imposters') + ' — two people always share the word.';
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  $('imposter-seg-room').addEventListener('click', function (e) {
    var btn = e.target.closest('.seg');
    if (!btn || btn.disabled) return;
    M.setImposterCount(btn.dataset.count, roomImposterCap());
    buzz(8);
    renderRoomImposters();
    renderLobbySummary();
  });

  /* Set before the room opens, or changed in the lobby afterwards — the same
     number either way, so both controls always show the same thing. */
  function renderVoteRounds() {
    var chosen = M.state().voteRounds;
    document.querySelectorAll('#vote-seg .seg, #vote-seg-setup .seg').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.votes, 10) === chosen));
    });
  }

  function onVoteRoundsClick(e) {
    var btn = e.target.closest('.seg');
    if (!btn) return;
    M.setVoteRounds(btn.dataset.votes);
    buzz(8);
    renderVoteRounds();
    renderLobbySummary();
  }

  $('vote-seg').addEventListener('click', onVoteRoundsClick);
  $('vote-seg-setup').addEventListener('click', onVoteRoundsClick);

  function renderLobbySummary() {
    if (!room || !room.isHost) return;
    var count = Math.min(M.state().imposterCount, Math.max(1, roomImposterCap()));
    var cats = M.selectedCategories().length;
    var votes = M.state().voteRounds;
    $('lobby-summary').textContent =
      count + (count === 1 ? ' imposter' : ' imposters') + ' · ' +
      cats + (cats === 1 ? ' category' : ' categories') + ' · ' +
      M.wordCount() + ' words · ' +
      votes + (votes === 1 ? ' vote' : ' votes');
  }

  $('btn-lobby-edit').addEventListener('click', function () {
    renderRoomImposters();
    renderVoteRounds();
    renderCategories();
    openSheet('sheet-game');
  });

  $('btn-select-all-room').addEventListener('click', function () {
    M.selectAllCategories(true);
    renderCategories();
    renderStart();
    renderLobbySummary();
  });

  $('btn-select-none-room').addEventListener('click', function () {
    M.selectAllCategories(false);
    renderCategories();
    renderStart();
    renderLobbySummary();
  });

  /* The category editor is a sheet too, so step out of this one and come
     back to it afterwards. */
  $('btn-new-category-room').addEventListener('click', function () {
    closeSheets();
    openCategorySheet(null, true);
  });

  /* ---------- the host deals ---------- */
  $('btn-lobby-start').addEventListener('click', function () { dealToRoom(this); });
  $('btn-room-again').addEventListener('click', function () { dealToRoom(this); });
  $('btn-verdict-again').addEventListener('click', function () { dealToRoom(this); });

  function dealToRoom(btn) {
    if (!room || !room.isHost) return;
    var check = M.canDeal(room.roster);
    if (!check.ok) { toast(check.reason); return; }

    btn = btn || $('btn-lobby-start');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Dealing…';

    var deal = M.dealFor(room.roster);
    var number = room.round + 1;

    /* The host's phone is the only one that knows the whole round, so hold
       on to it — that is what the answer is read from when it is called.
       The names are worked out now rather than at reveal time, so somebody
       leaving mid-round cannot quietly drop out of the answer. */
    deal.imposterNames = room.roster
      .filter(function (p) { return deal.imposters[p.id]; })
      .map(function (p) { return p.name; });
    room.deal = deal;
    room.dealtWith = room.roster.length;
    room.votesPlanned = M.state().voteRounds;

    R.deal(room.code, {
      number: number,
      starterName: deal.starter.name,
      imposterCount: deal.imposterCount,
      votesPlanned: M.state().voteRounds
    }, function (player) {
      var isImposter = !!deal.imposters[player.id];
      return {
        name: player.name,
        color: player.color,
        isImposter: isImposter,
        word: isImposter ? null : deal.word,
        category: { emoji: deal.category.emoji, name: deal.category.name },
        showCategory: !isImposter || M.state().settings.imposterSeesCategory
      };
    }, room.roster)
      .catch(roomTrouble)
      .then(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
  }

  /* ============================================================
     Voting

     The host opens a vote; every phone that was dealt a card gets a
     ballot. Ballots go up under the round they belong to, and every
     phone works out the tally for itself once they are all in — so
     nothing waits on the host's phone being awake, and everyone sees
     the same result at the same time.

     Who is entitled to vote is whoever holds a card, not whoever is in
     the room, so somebody who arrived halfway through cannot leave a
     tally one ballot short for ever.
     ============================================================ */
  $('btn-room-vote').addEventListener('click', function () { openVote(1); });
  $('btn-vote-next').addEventListener('click', function () { openVote((room && room.vote || 0) + 1); });

  function openVote(n) {
    if (!room || !room.isHost) return;
    var planned = room.votesPlanned || M.state().voteRounds;
    if (n > planned) return;

    var btn = n > 1 ? $('btn-vote-next') : $('btn-room-vote');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening…';

    R.startVote(room.code, n)
      .then(function () { room.voteRev = null; })
      .catch(roomTrouble)
      .then(function () { btn.disabled = false; btn.textContent = label; });
  }

  /* Everyone lands here when the phase turns to voting. */
  function enterVoting(meta) {
    /* a card is the ticket; somebody still waiting for the next round
       neither votes nor holds one up */
    if (room.waiting) { showView('lobby'); renderLobby(); return; }

    var opened = room.vote !== meta.vote;
    room.vote = meta.vote;
    room.votesPlanned = meta.votesPlanned || 1;
    room.voteClosed = meta.voteClosed == null ? null : meta.voteClosed;
    if (opened) { room.myVote = null; room.cast = {}; }

    knowTheVoters().then(function () {
      return R.votes(room.code, room.vote);
    }).then(function (cast) {
      if (!room || room.vote !== meta.vote) return;    /* moved on while we asked */
      room.cast = cast;
      /* Your own ballot is whatever you last tapped, even if a poll landed
         while the write was still on its way; everyone else's comes from
         the database. */
      if (room.myVote == null) room.myVote = cast[room.playerId] || null;
      else if (!voteDone()) room.cast[room.playerId] = room.myVote;
      showView('vote');
      renderVote(opened);
    }).catch(function (err) {
      $('vote-status').textContent = friendlyTrouble(err);
    });
  }

  function knowTheVoters() {
    if (room.voters && room.votersRound === room.round) return Promise.resolve();
    return R.dealtIds(room.code).then(function (ids) {
      if (!room) return;
      room.voters = ids;
      room.votersRound = room.round;
    });
  }

  function isVoter(id) { return (room.voters || []).indexOf(id) !== -1; }

  function ballotsIn() { return Object.keys(room.cast || {}).length; }

  function voteDone() {
    if (room.voteClosed === room.vote) return true;      /* the host called time */
    return room.voters && room.voters.length > 0 && ballotsIn() >= room.voters.length;
  }

  function nameOf(id) {
    for (var i = 0; i < room.roster.length; i++) {
      if (room.roster[i].id === id) return room.roster[i].name;
    }
    return 'Somebody who left';
  }

  function colorOf(id) {
    for (var i = 0; i < room.roster.length; i++) {
      if (room.roster[i].id === id) return room.roster[i].color;
    }
    return null;
  }

  /* targetId -> the ids that picked them, biggest first */
  function tallyOf(cast) {
    var by = {};
    Object.keys(cast).forEach(function (voter) {
      var target = cast[voter];
      (by[target] = by[target] || []).push(voter);
    });
    return Object.keys(by)
      .map(function (id) { return { id: id, voters: by[id] }; })
      .sort(function (a, b) { return b.voters.length - a.voters.length; });
  }

  /* Everyone the vote landed hardest on — more than one if it was a tie. */
  function topOf(rows) {
    if (!rows.length) return { ids: [], count: 0 };
    var most = rows[0].voters.length;
    return {
      ids: rows.filter(function (r) { return r.voters.length === most; })
               .map(function (r) { return r.id; }),
      count: most
    };
  }

  function renderVote(opened) {
    var done = voteDone();
    var total = (room.voters || []).length;

    $('vote-eyebrow').textContent = 'Vote ' + room.vote + ' of ' + room.votesPlanned;
    $('vote-title').textContent = done ? 'The votes are in' : 'Who is the imposter?';

    $('vote-list').hidden = done;
    $('tally').hidden = !done;

    if (done) renderTally(); else renderBallot();

    if (done) {
      var top = topOf(tallyOf(room.cast));
      $('vote-sub').textContent = '';
      $('vote-status').textContent = top.ids.length === 1
        ? 'The room says ' + nameOf(top.ids[0]) + '.'
        : 'The room could not agree.';
    } else if (room.myVote) {
      $('vote-sub').textContent = 'You can change your mind until everyone is in.';
      $('vote-status').textContent = ballotsIn() + ' of ' + total + ' voted — waiting for the rest…';
    } else {
      $('vote-sub').textContent = 'Tap the name you think is faking it.';
      $('vote-status').textContent = ballotsIn() + ' of ' + total + ' voted.';
    }

    applyHostControls();
    if (opened) buzz([10, 50, 10]);
  }

  function renderBallot() {
    var list = $('vote-list');
    list.innerHTML = '';

    room.roster.forEach(function (p) {
      /* only the people in this round, and never yourself */
      if (!isVoter(p.id) || p.id === room.playerId) return;

      var option = el('button', 'vote-option');
      option.type = 'button';
      option.style.setProperty('--player', p.color);
      if (room.myVote === p.id) option.classList.add('is-mine');
      option.setAttribute('aria-pressed', String(room.myVote === p.id));
      option.appendChild(el('span', null, p.name));

      var tick = icon('M5 13l4 4L19 7', '2.6');
      tick.setAttribute('class', 'vote-tick');
      option.appendChild(tick);

      option.addEventListener('click', function () { cast(p.id); });
      list.appendChild(option);
    });
  }

  function cast(targetId) {
    if (!room || voteDone() || room.myVote === targetId) return;
    room.myVote = targetId;
    room.cast[room.playerId] = targetId;      /* show it at once, confirm after */
    buzz(12);
    renderVote(false);

    /* Changing your mind quickly fires two writes at the same key, and
       nothing says they arrive in the order they were sent — the earlier
       one landing last would quietly put the vote back. Chaining them
       means the last tap is the last write. */
    var mine = room;
    mine.voteQueue = (mine.voteQueue || Promise.resolve()).then(function () {
      if (room !== mine || room.myVote !== targetId) return;
      return R.castVote(room.code, room.vote, room.playerId, targetId)
        .catch(function (err) {
          if (room !== mine) return;
          roomTrouble(err);
          room.myVote = null;
          delete room.cast[room.playerId];
          renderVote(false);
        });
    });
  }

  function renderTally() {
    var rows = tallyOf(room.cast);
    var top = topOf(rows);
    var most = top.count || 1;
    var box = $('tally');
    box.innerHTML = '';

    rows.forEach(function (row) {
      var wrap = el('div', 'tally-row');
      var shade = colorOf(row.id);
      if (shade) wrap.style.setProperty('--player', shade);
      if (top.ids.indexOf(row.id) !== -1) wrap.classList.add('is-top');

      var head = el('div', 'tally-head');
      head.appendChild(el('span', 'tally-name', nameOf(row.id)));
      head.appendChild(el('span', 'tally-count', String(row.voters.length)));
      wrap.appendChild(head);

      var bar = el('div', 'tally-bar');
      var fill = el('i');
      fill.style.width = Math.round(row.voters.length / most * 100) + '%';
      bar.appendChild(fill);
      wrap.appendChild(bar);

      wrap.appendChild(el('p', 'tally-voters',
        row.voters.map(nameOf).join(', ')));
      box.appendChild(wrap);
    });
  }

  /* The host can cut a vote short — somebody has put their phone down, or
     walked off with it, and the tally would otherwise never complete. */
  $('btn-vote-close').addEventListener('click', function () {
    if (!room || !room.isHost) return;
    var missing = room.voters.length - ballotsIn();
    ask({
      title: 'Close the vote now?',
      body: missing === 1
        ? 'One person has not voted. Their say is lost.'
        : missing + ' people have not voted. Their say is lost.',
      ok: 'Close it', danger: true
    }).then(function (yes) {
      if (!yes || !room) return;
      return R.closeVote(room.code, room.vote).catch(roomTrouble);
    });
  });

  $('btn-vote-again').addEventListener('click', function () { dealToRoom(this); });
  $('btn-vote-end').addEventListener('click', function () { askEndGame(); });
  $('btn-vote-reveal').addEventListener('click', function () { revealAnswer(); });

  /* ---------- the host calls the answer ----------
     Everyone's phone shows the word and who was faking it at the same
     moment, so nobody has to take the host's word for it. */
  $('btn-room-reveal').addEventListener('click', function () { revealAnswer(); });

  function revealAnswer() {
    if (!room || !room.isHost) return;
    if (!room.deal) { toast('This phone no longer has the round — deal again first'); return; }

    var many = room.deal.imposterNames.length > 1;
    ask({
      title: many ? 'Reveal the imposters?' : 'Reveal the imposter?',
      body: 'The word and who was faking it appear on every phone in the room.',
      ok: 'Reveal'
    }).then(function (yes) {
      if (!yes || !room || !room.deal) return;

      var deal = room.deal;
      var answer = {
        word: deal.word,
        category: deal.category.emoji + ' ' + deal.category.name,
        imposters: deal.imposterNames
      };

      /* If the room voted, the answer is worth a lot more next to what
         they decided — so carry the last verdict into it. */
      if (room.vote && room.cast && Object.keys(room.cast).length) {
        var top = topOf(tallyOf(room.cast));
        if (top.ids.length === 1) answer.votedOut = nameOf(top.ids[0]);
        else answer.voteSplit = true;
      }

      var btn = $('btn-room-reveal');
      btn.disabled = true;
      btn.textContent = 'Revealing…';

      return R.reveal(room.code, answer)
        .then(function () {
          /* The host's own poll would land on this a moment later anyway;
             showing it now keeps the press and the answer in one beat. */
          showVerdict({ word: answer.word, category: answer.category, imposters: answer.imposters });
        })
        .catch(roomTrouble)
        .then(function () {
          btn.disabled = false;
          btn.textContent = 'Reveal the imposter';
        });
    });
  }

  function showVerdict(meta) {
    if (!room) return;
    var fresh = view !== 'verdict';
    peeking = null;
    closeCard();
    closeSheets();

    var names = Array.isArray(meta.imposters) ? meta.imposters.slice()
      : meta.imposters ? [String(meta.imposters)] : [];
    var word = meta.word == null ? '' : String(meta.word);

    $('verdict-word').textContent = word || '—';
    $('verdict-word').className = 'verdict-word ' + lengthClass(word);
    $('verdict-category').textContent = meta.category || '';
    $('verdict-category').hidden = !meta.category;
    $('verdict-who').textContent = names.length
      ? names.join(' & ') + (names.length === 1 ? ' was the imposter' : ' were the imposters')
      : 'Nobody was faking it';

    var line = $('verdict-vote');
    line.innerHTML = '';
    if (meta.votedOut) {
      var caught = names.indexOf(meta.votedOut) !== -1;
      line.appendChild(document.createTextNode('The room voted for '));
      line.appendChild(el('b', null, meta.votedOut));
      line.appendChild(document.createTextNode(' — '));
      line.appendChild(el('b', caught ? 'got-it' : 'missed-it',
        caught ? 'caught them' : 'wrong'));
      line.hidden = false;
    } else if (meta.voteSplit) {
      line.textContent = 'The room could not agree on anybody.';
      line.hidden = false;
    } else {
      line.hidden = true;
    }

    $('verdict-code-text').textContent = room.code;
    applyHostControls();
    $('verdict-sub').textContent = room.isHost
      ? 'Deal again for another round — anyone who has joined since is dealt in.'
      : '';

    renderRoomPlayers($('verdict-players'));
    showView('verdict');
    if (fresh) buzz([14, 70, 14]);
  }

  $('btn-verdict-end').addEventListener('click', function () { askEndGame(); });
  $('btn-verdict-leave').addEventListener('click', function () { askLeaveRoom(); });

  /* ---------- everybody picks up their own card ---------- */
  function collectCard() {
    R.myCard(room.code, room.playerId).then(function (card) {
      if (!room) return;
      if (!card) { waitForNextRound(); return; }
      showRoomCard(card);
    }).catch(function (err) {
      toast('Could not open your card — ' + (err.message || 'try again'));
    });
  }

  /* Joined after the deal, so there is no card for this round. The room
     stays open, so they simply wait in the lobby and are dealt in next
     time round rather than being sent back to type the code again. */
  function waitForNextRound() {
    room.waiting = true;
    showView('lobby');
    renderLobby();
  }

  function showRoomCard(card) {
    peeking = null;
    room.waiting = false;
    room.card = card;

    paintCard({
      player: { name: card.name, color: card.color },
      isImposter: card.isImposter,
      word: card.word,
      category: card.category,
      showCategory: card.showCategory
    }, 'Your card');

    $('progress').innerHTML = '';
    $('progress-text').textContent = 'Room ' + room.code;
    $('btn-quit').setAttribute('aria-label', 'Leave the room');

    $('btn-next').hidden = true;
    $('room-dock').hidden = false;
    applyHostControls();
    $('room-starter').innerHTML = '';
    $('room-starter').appendChild(el('b', null, room.starter || ''));
    $('room-starter').appendChild(document.createTextNode(' starts the round'));
    renderRoomStatus();

    showView('reveal');
    buzz([12, 60, 12]);
  }

  /* ---------- leaving ---------- */
  /* Closing a room ends it for everybody; leaving one only drops you. */
  function askLeaveRoom() {
    if (!room) return;
    var host = room.isHost;
    ask({
      title: host ? 'Close the room?' : 'Leave the room?',
      body: host
        ? 'The game ends for everyone and the code stops working.'
        : 'You can come back with the same code — your card comes back with you.',
      ok: host ? 'Close it' : 'Leave', danger: true
    }).then(function (yes) { if (yes) leaveRoom(); });
  }

  function askEndGame() {
    ask({
      title: 'End the game?',
      body: 'The room closes and everyone is dropped back to the start.',
      ok: 'End game', danger: true
    }).then(function (yes) { if (yes) leaveRoom(); });
  }

  $('btn-lobby-leave').addEventListener('click', askLeaveRoom);
  $('btn-room-end').addEventListener('click', askEndGame);

  function leaveRoom(message) {
    if (!room) return;
    var current = room;
    room = null;
    if (current.stop) current.stop();

    if (current.isHost) R.closeRoom(current.code);
    else R.leaveRoom(current.code, current.playerId);

    $('btn-next').hidden = false;
    $('room-dock').hidden = true;
    $('room-roster').hidden = true;
    showView('setup');
    if (message) toast(message);
  }

  /* ---------- handing the code to somebody ----------
     The code is the one thing anybody else needs, so it is also the
     button that gives it to them: the phone's own share sheet where
     there is one, the clipboard where there is not. */
  function roomLink(code) {
    return location.href.split('#')[0] + '#' + code;
  }

  function shareRoom() {
    if (!room) return;
    var link = roomLink(room.code);
    buzz(8);

    if (navigator.share) {
      navigator.share({
        title: 'Imposter',
        text: 'Join my game of Imposter — the room code is ' + room.code + '.',
        url: link
      }).catch(function (err) {
        /* Backing out of the share sheet is not a failure and needs no
           second try. Anything else means it never opened, so fall back
           rather than leaving the tap looking like it did nothing. */
        if (err && err.name === 'AbortError') return;
        copyLink(link);
      });
      return;
    }

    copyLink(link);
  }

  function copyLink(link) {
    copyText(link).then(function (copied) {
      toast(copied ? 'Link copied — the code is in it'
                   : 'Could not copy — the code is ' + room.code);
    });
  }

  function copyText(text) {
    var asked = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text).then(function () { return true; },
                                                 function () { return false; })
      : Promise.resolve(false);

    /* A browser that is not the window in front can leave that promise
       neither resolved nor rejected, which would leave the tap looking
       like it was ignored. Give it a moment, then fall back regardless,
       so something is always said back. */
    var patience = new Promise(function (resolve) {
      setTimeout(function () { resolve(false); }, 1200);
    });

    return Promise.race([asked, patience]).then(function (done) {
      return done || legacyCopy(text);
    });
  }

  /* An older phone has no clipboard API worth the name. */
  function legacyCopy(text) {
    var box = el('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(box);
    box.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(box);
    return done;
  }

  $('lobby-code').addEventListener('click', shareRoom);
  $('verdict-code').addEventListener('click', shareRoom);

  /* A shared link, imposter.example/#ABCD, drops straight into joining. */
  function codeFromLink() {
    var raw = (location.hash || '').replace('#', '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return raw.length === R.CODE_LEN ? raw : '';
  }

  function backToGameSheet() {
    if (!cameFromGameSheet) return;
    cameFromGameSheet = false;
    if (room && room.isHost) { renderRoomImposters(); openSheet('sheet-game'); }
  }

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
  applyTheme();
  renderAll();
  renderVoteRounds();

  $('mode').hidden = !roomsAvailable();
  $('lobby-code-share').textContent = navigator.share
    ? 'Tap the code to share it' : 'Tap the code to copy the link';
  setMode('pass');
  $('input-host-name').value = rememberedName();
  var linked = roomsAvailable() ? codeFromLink() : '';
  if (linked) openJoin(linked); else showView('setup');
  $('version').textContent = 'Imposter v' + APP_VERSION;
  registerSW();

})(this);
