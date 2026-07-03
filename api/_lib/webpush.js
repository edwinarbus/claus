// Minimal Web Push sender — VAPID (RFC 8292) + aes128gcm payload encryption
// (RFC 8291/8188) implemented on Node's WebCrypto, so this otherwise static,
// package.json-free app can send pushes from a Vercel function with zero
// dependencies. Only what Claus notifications need: one payload, one
// subscription at a time, 4 KB max.

const { webcrypto } = require('crypto');
const { subtle } = webcrypto;
// NB: getRandomValues must stay bound to webcrypto (destructuring throws
// ERR_INVALID_THIS when called bare).
const getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = require('./config.js');

const b64u = {
  encode(buf) { return Buffer.from(buf).toString('base64url'); },
  decode(str) { return new Uint8Array(Buffer.from(str, 'base64url')); },
};

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// Build the signing JWK from the PRIVATE key alone: derive the public point
// from the scalar (createECDH), then check it really is the pair of the
// configured/committed public key. Building the JWK from the committed public
// x/y plus an unrelated env `d` makes WebCrypto's import throw an opaque
// DataError — this way a mis-set VAPID_PRIVATE_KEY produces a clear,
// actionable message instead.
function vapidJwk() {
  const d = b64u.decode(VAPID_PRIVATE_KEY);
  if (d.length !== 32) {
    throw new Error(`VAPID_PRIVATE_KEY must be 32 base64url bytes (got ${d.length}) — check the env var for typos/whitespace`);
  }
  const ecdh = require('crypto').createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(d));
  const pub = new Uint8Array(ecdh.getPublicKey()); // uncompressed: 0x04 | x | y
  if (b64u.encode(pub) !== VAPID_PUBLIC_KEY) {
    throw new Error('VAPID keypair mismatch — VAPID_PRIVATE_KEY is not the pair of the public key in src/config.js, so the push service would reject every send. Set the matching private key (or update both public-key constants).');
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64u.encode(pub.slice(1, 33)),
    y: b64u.encode(pub.slice(33, 65)),
    d: VAPID_PRIVATE_KEY,
  };
}

// VAPID JWT: ES256-signed { aud, exp, sub }. WebCrypto's ECDSA output is
// already the raw r||s JOSE format — no DER conversion needed.
async function vapidAuthHeader(endpoint) {
  const { origin } = new URL(endpoint);
  const header = b64u.encode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u.encode(Buffer.from(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  })));
  const signingInput = `${header}.${payload}`;
  const key = await subtle.importKey('jwk', vapidJwk(), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signingInput));
  return `vapid t=${signingInput}.${b64u.encode(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// RFC 8291 single-record aes128gcm encryption of `plaintext` for a
// subscription's p256dh/auth keys. Returns the full encrypted body
// (header block + ciphertext).
async function encryptPayload(plaintext, p256dhB64, authB64) {
  const userPubRaw = b64u.decode(p256dhB64); // 65-byte uncompressed point
  const authSecret = b64u.decode(authB64);   // 16 bytes

  // Ephemeral sender keypair + ECDH shared secret with the browser's key.
  const localKeys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const userPubKey = await subtle.importKey('raw', userPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: userPubKey }, localKeys.privateKey, 256));
  const localPubRaw = new Uint8Array(await subtle.exportKey('raw', localKeys.publicKey));

  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0x00 || ua_public || as_public)
  const keyInfo = concat(Buffer.from('WebPush: info\0'), userPubRaw, localPubRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // Single record: plaintext || 0x02 (last-record delimiter), then AES-GCM.
  const padded = concat(Buffer.from(plaintext), Uint8Array.of(2));
  const aesKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // aes128gcm header: salt(16) | record size(4) | key id length(1) | key id.
  const header = new Uint8Array(16 + 4 + 1 + localPubRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPubRaw.length;
  header.set(localPubRaw, 21);

  return concat(header, ciphertext);
}

// Send one push. Returns { ok, status, gone } — `gone` marks subscriptions the
// push service says no longer exist (404/410), which callers should delete.
async function sendPush(subscription, payload, { ttl = 86400 } = {}) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return { ok: false, status: 0, gone: true };
  }
  try {
    const body = await encryptPayload(JSON.stringify(payload), keys.p256dh, keys.auth);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthHeader(endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: 'normal',
      },
      body,
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    console.error('Claus webpush send failed:', e);
    return { ok: false, status: 0, gone: false, error: String(e && e.message) };
  }
}

module.exports = { sendPush };
