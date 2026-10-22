import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCanonicalMessage,
  generateKeyPair,
  isSshKey,
  normalizePrivateKey,
  publicKeyFromPrivate,
  serializeBody,
  sha256Hex,
  signBytes,
  signRequest,
  verifySignature,
} from '../src/signing.js';
import { SigningError } from '../src/errors.js';

// RFC 8032, section 7.1, test vector 1.
const RFC_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC_SIGNATURE_EMPTY =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

test('derives the RFC 8032 public key', () => {
  assert.equal(publicKeyFromPrivate(RFC_SEED), RFC_PUBLIC);
});

test('signs the RFC 8032 empty message exactly', () => {
  assert.equal(signBytes('', RFC_SEED), RFC_SIGNATURE_EMPTY);
});

test('verifies a signature and rejects tampering', () => {
  const signature = signBytes('hello', RFC_SEED);
  assert.equal(verifySignature('hello', signature, RFC_PUBLIC), true);
  assert.equal(verifySignature('hello!', signature, RFC_PUBLIC), false);
});

test('empty body hashes to the known SHA-256', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(serializeBody(undefined), '');
});

test('serializes JSON once, with no extra whitespace', () => {
  assert.equal(serializeBody({ symbol: 'BTC-USD', size: '0.1' }), '{"symbol":"BTC-USD","size":"0.1"}');
  assert.equal(
    sha256Hex(serializeBody({ a: 1 })),
    '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
  );
});

test('builds the canonical signing message', () => {
  assert.equal(
    buildCanonicalMessage({
      method: 'get',
      path: '/v2/positions?symbol=BTC-USD',
      timestamp: 1704067200,
      nonce: '550e8400-e29b-41d4-a716-446655440000',
      bodyHash: sha256Hex(''),
    }),
    'GET:/v2/positions?symbol=BTC-USD:1704067200:550e8400-e29b-41d4-a716-446655440000:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('signRequest produces byte-exact headers and a verifiable signature', () => {
  const signed = signRequest({
    method: 'GET',
    path: '/v2/account',
    privateKey: RFC_SEED,
    timestamp: 1704067200,
    nonce: '550e8400-e29b-41d4-a716-446655440000',
  });

  assert.equal(signed.headers['X-API-Wallet-Public-Key'], RFC_PUBLIC);
  assert.equal(signed.headers['X-API-Wallet-Timestamp'], '1704067200');
  assert.equal(signed.body, '');
  assert.equal(signed.bodyHash, sha256Hex(''));
  assert.equal(signed.canonical, `GET:/v2/account:1704067200:${signed.nonce}:${signed.bodyHash}`);
  assert.equal(verifySignature(signed.canonical, signed.signature, RFC_PUBLIC), true);
  assert.match(signed.signature, /^[0-9a-f]{128}$/);
});

test('accepts 128-character expanded private keys', () => {
  const expanded = RFC_SEED + RFC_PUBLIC;
  assert.equal(publicKeyFromPrivate(expanded), RFC_PUBLIC);
  assert.equal(normalizePrivateKey(expanded).toString('hex'), RFC_SEED);
});

test('rejects SSH keys and malformed lengths', () => {
  assert.equal(isSshKey('ssh-ed25519 AAAAC3Nza'), true);
  assert.throws(() => normalizePrivateKey('ssh-ed25519 AAAAC3Nza'), SigningError);
  assert.throws(() => normalizePrivateKey('abcd'), SigningError);
  assert.throws(() => normalizePrivateKey('zz'.repeat(32)), SigningError);
});

test('generated key pairs round-trip', () => {
  const pair = generateKeyPair();
  assert.match(pair.privateKey, /^[0-9a-f]{64}$/);
  assert.match(pair.publicKey, /^[0-9a-f]{64}$/);
  assert.equal(publicKeyFromPrivate(pair.privateKey), pair.publicKey);
});

test('rejects a public key that does not match the private key', () => {
  const pair = generateKeyPair();
  const other = generateKeyPair();
  assert.throws(
    () => signRequest({ method: 'GET', path: '/v2/ping', privateKey: pair.privateKey, publicKey: other.publicKey }),
    SigningError,
  );
});
