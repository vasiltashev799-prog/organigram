/* Password encryption helpers: PBKDF2 (SHA-256) -> AES-GCM 256. Shared by the editor and exported viewer. */
(function (global) {
  'use strict';
  var enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf) {
    var a = new Uint8Array(buf), s = '', i, n = 0x8000;
    for (i = 0; i < a.length; i += n) s += String.fromCharCode.apply(null, a.subarray(i, i + n));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), a = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function key(pw, salt, iter) {
    return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  global.OCCrypto = {
    ITER: 250000,
    encrypt: function (text, pw) {
      var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = this.ITER;
      return key(pw, salt, iter).then(function (k) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(text));
      }).then(function (ct) { return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: iter }; });
    },
    decrypt: function (p, pw) {
      return key(pw, unb64(p.salt), p.iter).then(function (k) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, k, unb64(p.ct));
      }).then(function (buf) { return dec.decode(buf); });
    }
  };
})(window);
