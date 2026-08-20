/* ============================================================
   seal.js — a card sealed to one phone

   Rooms put every player's card in the same database, so the
   database is not trusted to keep them apart. Each phone makes an
   ECDH keypair when it joins and publishes only the public half;
   the host seals each card to the player it belongs to. Nobody
   else can open it, however loose the database rules are.

   ECDH P-256 -> HKDF-SHA256 -> AES-GCM, all from WebCrypto.
   ============================================================ */
(function (global) {
  'use strict';

  var CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  var INFO = 'imposter-card-v1';

  function subtle() {
    var c = global.crypto;
    if (!c || !c.subtle) throw new Error('This browser cannot seal cards');
    return c.subtle;
  }

  /* ---------- base64 for the bytes that travel ---------- */
  function toB64(buffer) {
    var bytes = new Uint8Array(buffer), out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }

  function fromB64(text) {
    var raw = atob(text), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  /* ---------- keys ---------- */
  function newKeypair() {
    return subtle().generateKey(CURVE, true, ['deriveBits']).then(function (pair) {
      return Promise.all([
        subtle().exportKey('jwk', pair.publicKey),
        subtle().exportKey('jwk', pair.privateKey)
      ]).then(function (jwks) {
        return { publicJwk: jwks[0], privateJwk: jwks[1] };
      });
    });
  }

  function importPublic(jwk) {
    return subtle().importKey('jwk', jwk, CURVE, false, []);
  }

  function importPrivate(jwk) {
    return subtle().importKey('jwk', jwk, CURVE, false, ['deriveBits']);
  }

  /* The shared secret is run through HKDF rather than used raw. */
  function aesKeyFrom(privateKey, publicKey) {
    return subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
      .then(function (bits) {
        return subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
      })
      .then(function (material) {
        return subtle().deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: new TextEncoder().encode(INFO)
          },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /* ---------- seal / open ---------- */

  /* Seal a value so only the holder of recipientJwk's private key can read
     it. A throwaway keypair per card means two cards never share a key. */
  function seal(recipientJwk, value) {
    var plain = new TextEncoder().encode(JSON.stringify(value));
    var iv = global.crypto.getRandomValues(new Uint8Array(12));
    var ephemeral;

    return subtle().generateKey(CURVE, true, ['deriveBits'])
      .then(function (pair) {
        ephemeral = pair;
        return importPublic(recipientJwk);
      })
      .then(function (theirPublic) {
        return aesKeyFrom(ephemeral.privateKey, theirPublic);
      })
      .then(function (key) {
        return subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
      })
      .then(function (cipher) {
        return subtle().exportKey('jwk', ephemeral.publicKey).then(function (epk) {
          return { epk: epk, iv: toB64(iv), ct: toB64(cipher) };
        });
      });
  }

  function open(privateJwk, envelope) {
    if (!envelope || !envelope.epk || !envelope.iv || !envelope.ct) {
      return Promise.reject(new Error('Nothing to open'));
    }
    return Promise.all([importPrivate(privateJwk), importPublic(envelope.epk)])
      .then(function (keys) { return aesKeyFrom(keys[0], keys[1]); })
      .then(function (key) {
        return subtle().decrypt(
          { name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.ct));
      })
      .then(function (plain) {
        return JSON.parse(new TextDecoder().decode(plain));
      });
  }

  global.ImposterSeal = {
    newKeypair: newKeypair,
    seal: seal,
    open: open,
    available: function () { return !!(global.crypto && global.crypto.subtle); }
  };

})(this);
