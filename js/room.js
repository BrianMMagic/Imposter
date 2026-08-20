/* ============================================================
   room.js — playing on separate phones

   Talks to a Firebase Realtime Database over its plain REST API:
   no SDK, no build step. The database only ever holds sealed
   cards (see seal.js), so it is never trusted with the round.

   Phones watch a tiny `meta` node and only fetch the bigger bits
   when something in it actually changes, which keeps a game to a
   few kilobytes rather than re-downloading every card every
   couple of seconds.
   ============================================================ */
(function (global) {
  'use strict';

  var Seal = global.ImposterSeal;

  /* No I, O, 0 or 1: a code gets read aloud across a table. */
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LEN = 4;
  var POLL_MS = 1500;
  var STORE_PREFIX = 'imposter.room.';

  function config() {
    return (global.ImposterFirebase && global.ImposterFirebase.databaseURL || '').replace(/\/+$/, '');
  }

  function configured() {
    return !!config() && !!Seal && Seal.available();
  }

  function url(path, query) {
    return config() + '/' + path + '.json' + (query ? '?' + query : '');
  }

  /* ---------- REST ---------- */
  function request(method, path, body, query) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);

    return fetch(url(path, query), opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error('Database said ' + res.status + (text ? ': ' + text.slice(0, 120) : ''));
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  function get(path, query) { return request('GET', path, undefined, query); }
  function put(path, value) { return request('PUT', path, value); }
  function patch(path, value) { return request('PATCH', path, value); }
  function remove(path) { return request('DELETE', path); }

  /* ---------- ids ---------- */
  function randomFrom(alphabet, length) {
    var out = '', buf = new Uint32Array(length);
    global.crypto.getRandomValues(buf);
    var limit = Math.floor(4294967296 / alphabet.length) * alphabet.length;
    for (var i = 0; i < length; i++) {
      var v = buf[i];
      while (v >= limit) { var one = new Uint32Array(1); global.crypto.getRandomValues(one); v = one[0]; }
      out += alphabet[v % alphabet.length];
    }
    return out;
  }

  function playerId() {
    return 'p' + randomFrom('abcdefghijklmnopqrstuvwxyz0123456789', 12);
  }

  /* ---------- what this phone remembers about a room ----------
     The private key lives here so a player who reloads, or whose
     phone locks, can still open their own card. */
  function remember(code, data) {
    try { localStorage.setItem(STORE_PREFIX + code, JSON.stringify(data)); } catch (e) {}
  }

  function recall(code) {
    try { return JSON.parse(localStorage.getItem(STORE_PREFIX + code)); } catch (e) { return null; }
  }

  function forget(code) {
    try { localStorage.removeItem(STORE_PREFIX + code); } catch (e) {}
  }

  /* ---------- opening and joining ---------- */

  /* Claim a code nobody is using. */
  function createRoom() {
    var attempt = 0;

    function tryOnce() {
      var code = randomFrom(ALPHABET, CODE_LEN);
      return get('rooms/' + code + '/meta').then(function (existing) {
        if (existing && !isStale(existing)) {
          if (++attempt > 8) throw new Error('Could not find a free room code');
          return tryOnce();
        }
        return put('rooms/' + code, {
          meta: { created: Date.now(), phase: 'lobby', round: 0, lobbyRev: 1 }
        }).then(function () { return code; });
      });
    }
    return tryOnce();
  }

  /* Rooms are left behind when a host closes the tab, so a code is
     reusable once its room is a day old. */
  function isStale(meta) {
    return !meta.created || (Date.now() - meta.created) > 24 * 60 * 60 * 1000;
  }

  function roomExists(code) {
    return get('rooms/' + code + '/meta').then(function (meta) {
      return !!meta && !isStale(meta);
    });
  }

  /* Join, or step back into a room this phone is already in. */
  function joinRoom(code, name) {
    var mine = recall(code);
    var id = (mine && mine.playerId) || playerId();

    var keys = mine && mine.privateJwk
      ? Promise.resolve({ publicJwk: mine.publicJwk, privateJwk: mine.privateJwk })
      : Seal.newKeypair();

    return keys.then(function (pair) {
      remember(code, {
        playerId: id, name: name,
        publicJwk: pair.publicJwk, privateJwk: pair.privateJwk
      });
      return put('rooms/' + code + '/players/' + id, {
        name: name, pub: pair.publicJwk, joined: Date.now()
      });
    }).then(function () {
      /* nudge everyone's meta so the lobby refreshes */
      return patch('rooms/' + code + '/meta', { lobbyRev: Date.now() });
    }).then(function () {
      return { playerId: id, code: code };
    });
  }

  function leaveRoom(code, id) {
    forget(code);
    return remove('rooms/' + code + '/players/' + id)
      .then(function () { return get('rooms/' + code + '/meta'); })
      .then(function (meta) {
        /* PATCH creates whatever path it is handed, so a room the host has
           already closed must not be written back as a husk. */
        if (meta) return patch('rooms/' + code + '/meta', { lobbyRev: Date.now() });
      })
      .catch(function () {});
  }

  function closeRoom(code) {
    forget(code);
    return remove('rooms/' + code).catch(function () {});
  }

  function players(code) {
    return get('rooms/' + code + '/players').then(function (map) {
      return Object.keys(map || {}).map(function (id) {
        var p = map[id];
        return { id: id, name: p.name, pub: p.pub, joined: p.joined || 0 };
      }).sort(function (a, b) { return a.joined - b.joined; });
    });
  }

  /* The fields a revealed answer puts in `meta`. Patching them to null
     is how the database is told to drop them again, so a new round
     never starts with the last one's answer still sitting there. */
  var ANSWER_CLEARED = {
    word: null, category: null, imposters: null, revealedAt: null,
    votedOut: null, voteSplit: null
  };

  function withAnswerCleared(fields) {
    var out = {};
    Object.keys(ANSWER_CLEARED).forEach(function (k) { out[k] = null; });
    Object.keys(fields).forEach(function (k) { out[k] = fields[k]; });
    return out;
  }

  /* ---------- dealing (host only) ----------
     Each card is sealed to the phone it belongs to before it is
     written, so the round itself never leaves the host's phone. */
  function deal(code, round, cardFor, roster) {
    var sealed = {};
    var chain = roster.reduce(function (p, player) {
      return p.then(function () {
        return Seal.seal(player.pub, cardFor(player)).then(function (env) {
          sealed[player.id] = env;
        });
      });
    }, Promise.resolve());

    return chain.then(function () {
      return put('rooms/' + code + '/cards', sealed);
    }).then(function () {
      /* last round's ballots are no use to this one */
      return remove('rooms/' + code + '/votes');
    }).then(function () {
      return patch('rooms/' + code + '/meta', withAnswerCleared({
        phase: 'dealt',
        round: round.number,
        starter: round.starterName,
        imposterCount: round.imposterCount,
        votesPlanned: round.votesPlanned || 1,
        vote: 0,
        voteClosed: null,
        voteRev: Date.now(),
        dealtAt: Date.now()
      }));
    });
  }

  /* ---------- voting ----------
     Who is entitled to vote is the set of people a card was dealt to, which
     the `cards` node already knows — so somebody who joined halfway through
     cannot hold up a tally for a round they were never in. `shallow` asks
     the database for those keys alone rather than the sealed cards under
     them, which would be a far bigger fetch every time. */
  function dealtIds(code) {
    return get('rooms/' + code + '/cards', 'shallow=true').then(function (map) {
      return Object.keys(map || {});
    });
  }

  /* Open a round of voting (host only). */
  function startVote(code, n) {
    return remove('rooms/' + code + '/votes/' + n).then(function () {
      return patch('rooms/' + code + '/meta', {
        phase: 'voting', vote: n, voteClosed: null, voteRev: Date.now()
      });
    });
  }

  /* Cut a vote short (host only): somebody has put their phone down and
     the tally would otherwise never be complete. Every phone reads this
     and counts whatever ballots are there, so they all agree. */
  function closeVote(code, n) {
    return patch('rooms/' + code + '/meta', { voteClosed: n, voteRev: Date.now() });
  }

  /* A ballot can be changed until the last one is in, so it is a plain
     write rather than an append. Bumping meta is what tells the other
     phones to come and look; without it they would have to poll the
     ballots themselves every second and a half. */
  function castVote(code, n, voterId, targetId) {
    return put('rooms/' + code + '/votes/' + n + '/' + voterId, targetId).then(function () {
      return patch('rooms/' + code + '/meta', { voteRev: Date.now() });
    });
  }

  function votes(code, n) {
    return get('rooms/' + code + '/votes/' + n).then(function (map) { return map || {}; });
  }

  /* ---------- the answer, once the host calls it (host only) ----------
     A card is sealed because only one phone may read it. The answer is
     the opposite: the whole table is meant to see it at the same moment,
     so it goes up in the open. It is written only when the host reveals,
     and `deal` clears it again the moment the next round starts, so the
     round in progress is never sitting there in readable form. */
  function reveal(code, answer) {
    return patch('rooms/' + code + '/meta', {
      phase: 'revealed',
      word: answer.word,
      category: answer.category || null,
      imposters: answer.imposters,
      votedOut: answer.votedOut || null,
      voteSplit: answer.voteSplit || null,
      revealedAt: Date.now()
    });
  }

  function backToLobby(code) {
    return remove('rooms/' + code + '/cards').then(function () {
      return remove('rooms/' + code + '/votes');
    }).then(function () {
      return patch('rooms/' + code + '/meta',
        withAnswerCleared({ phase: 'lobby', vote: 0, lobbyRev: Date.now() }));
    });
  }

  function myCard(code, id) {
    var mine = recall(code);
    if (!mine) return Promise.reject(new Error('This phone is not in that room'));
    return get('rooms/' + code + '/cards/' + id).then(function (env) {
      if (!env) return null;
      return Seal.open(mine.privateJwk, env);
    });
  }

  /* ---------- watching ----------
     One small poll drives everything: `meta` is a handful of
     fields, and the caller is only told when it actually changes. */
  function watch(code, onChange, onError) {
    var stopped = false;
    var last = null;
    var timer = null;

    function tick() {
      if (stopped) return;
      get('rooms/' + code + '/meta').then(function (meta) {
        if (stopped) return;
        var seen = JSON.stringify(meta);
        if (seen !== last) {
          last = seen;
          onChange(meta);
        }
        timer = setTimeout(tick, POLL_MS);
      }).catch(function (err) {
        if (stopped) return;
        if (onError) onError(err);
        timer = setTimeout(tick, POLL_MS * 3);   /* back off while it is unhappy */
      });
    }

    tick();
    return function stop() { stopped = true; clearTimeout(timer); };
  }

  global.ImposterRoom = {
    configured: configured,
    CODE_LEN: CODE_LEN,
    ALPHABET: ALPHABET,

    createRoom: createRoom, roomExists: roomExists,
    joinRoom: joinRoom, leaveRoom: leaveRoom, closeRoom: closeRoom,
    players: players, deal: deal, reveal: reveal, backToLobby: backToLobby,
    dealtIds: dealtIds, startVote: startVote, closeVote: closeVote,
    castVote: castVote, votes: votes,
    myCard: myCard, watch: watch,
    recall: recall, forget: forget
  };

})(this);
