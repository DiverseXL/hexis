import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { SigningError } from './errors.js';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const HEX_RE = /^[0-9a-fA-F]+$/;

export interface KeyPair {
  /** 64 hex characters (32-byte Ed25519 seed). */
  privateKey: string;
  /** 64 hex characters (32-byte raw Ed25519 public key). */
  publicKey: string;
}

export interface SignedRequest {
  headers: {
    'X-API-Wallet-Public-Key': string;
    'X-API-Wallet-Signature': string;
    'X-API-Wallet-Timestamp': string;
    'X-API-Wallet-Nonce': string;
  };
  /** {METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH} */
  canonical: string;
  /** The exact body that must be transmitted. Serialized once. */
  body: string;
  bodyHash: string;
  nonce: string;
  timestamp: number;
  signature: string;
  publicKey: string;
}

export interface SignRequestInput {
  method: string;
  /** Path including the query string, exactly as sent. */
  path: string;
  /** Object to serialize, or a pre-serialized string via bodyString. */
  body?: unknown;
  bodyString?: string;
  privateKey: string;
  publicKey?: string;
  /** Unix seconds. Injectable for tests. */
  timestamp?: number;
  /** UUID v4. Injectable for tests. */
  nonce?: string;
}

export function isSshKey(value: string): boolean {
  return /^\s*(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-ssh-ed25519)\b/.test(value);
}

/** Accepts a 32-byte seed (64 hex) or a 64-byte expanded key (128 hex). */
export function normalizePrivateKey(value: string): Buffer {
  const trimmed = value.trim().replace(/^0x/i, '');

  if (isSshKey(value)) {
    throw new SigningError(
      'SSH key format is not supported by Strike. Use the raw 64-character hex private key.',
    );
  }
  if (!trimmed || !HEX_RE.test(trimmed)) {
    throw new SigningError('Private key must be raw Ed25519 hex, not base64 or SSH format.');
  }
  if (trimmed.length === 128) {
    return Buffer.from(trimmed.slice(0, 64), 'hex');
  }
  if (trimmed.length === 64) {
    return Buffer.from(trimmed, 'hex');
  }
  throw new SigningError(
    `Private key must be 64 or 128 hex characters (got ${trimmed.length}).`,
  );
}

export function normalizePublicKey(value: string): Buffer {
  const trimmed = value.trim().replace(/^0x/i, '');
  if (isSshKey(value) || !HEX_RE.test(trimmed) || trimmed.length !== 64) {
    throw new SigningError('Public key must be 64 hex characters (raw Ed25519).');
  }
  return Buffer.from(trimmed, 'hex');
}

function privateKeyObject(seed: Buffer) {
  if (seed.length !== 32) {
    throw new SigningError('Ed25519 seed must be 32 bytes.');
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyFromPrivate(privateKeyHex: string): string {
  const seed = normalizePrivateKey(privateKeyHex);
  const jwk = privateKeyObject(seed).export({ format: 'jwk' }) as { x?: string };
  if (!jwk.x) {
    throw new SigningError('Could not derive a public key from the private key.');
  }
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}

export function generateKeyPair(): KeyPair {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' }) as { d?: string; x?: string };
  if (!jwk.d || !jwk.x) {
    throw new SigningError('Key generation failed.');
  }
  return {
    privateKey: Buffer.from(jwk.d, 'base64url').toString('hex'),
    publicKey: Buffer.from(jwk.x, 'base64url').toString('hex'),
  };
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** JSON is serialized exactly once; the same string is hashed and sent. */
export function serializeBody(body: unknown): string {
  return body === undefined || body === null ? '' : JSON.stringify(body);
}

export function buildCanonicalMessage(input: {
  method: string;
  path: string;
  timestamp: number | string;
  nonce: string;
  bodyHash: string;
}): string {
  return `${input.method.toUpperCase()}:${input.path}:${input.timestamp}:${input.nonce}:${input.bodyHash}`;
}

export function signBytes(message: string | Buffer, privateKeyHex: string): string {
  const seed = normalizePrivateKey(privateKeyHex);
  const signature = nodeSign(null, Buffer.from(message), privateKeyObject(seed));
  return signature.toString('hex');
}

export function verifySignature(
  message: string | Buffer,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        normalizePublicKey(publicKeyHex),
      ]),
      format: 'der',
      type: 'spki',
    });
    return nodeVerify(null, Buffer.from(message), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Build the four Strike authentication headers. Generates a fresh UUID v4
 * nonce and Unix-second timestamp on every call unless explicitly injected.
 */
export function signRequest(input: SignRequestInput): SignedRequest {
  const method = input.method.toUpperCase();
  const body = input.bodyString ?? serializeBody(input.body);
  const bodyHash = sha256Hex(body);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomUUID();
  const publicKey = input.publicKey
    ? normalizePublicKey(input.publicKey).toString('hex')
    : publicKeyFromPrivate(input.privateKey);

  if (input.publicKey && publicKeyFromPrivate(input.privateKey) !== publicKey) {
    throw new SigningError('Provided public key does not match the private key.');
  }

  const canonical = buildCanonicalMessage({
    method,
    path: input.path,
    timestamp,
    nonce,
    bodyHash,
  });
  const signature = signBytes(canonical, input.privateKey);

  return {
    headers: {
      'X-API-Wallet-Public-Key': publicKey,
      'X-API-Wallet-Signature': signature,
      'X-API-Wallet-Timestamp': String(timestamp),
      'X-API-Wallet-Nonce': nonce,
    },
    canonical,
    body,
    bodyHash,
    nonce,
    timestamp,
    signature,
    publicKey,
  };
}
