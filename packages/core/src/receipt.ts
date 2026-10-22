import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { publicKeyFromPrivate, sha256Hex, signBytes, verifySignature } from './signing.js';
import type { Receipt, WrittenReceipt } from './types.js';

/** Deterministic JSON: object keys sorted, undefined omitted, arrays preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

export function receiptDigest(receipt: Receipt): string {
  const { signature: _signature, receiptHash: _receiptHash, ...payload } = receipt;
  return sha256Hex(canonicalJson(payload));
}

/** Sign the receipt digest with the same Ed25519 API wallet key. */
export function signReceipt(receipt: Receipt, privateKey: string): Receipt {
  const unsigned: Receipt = { ...receipt };
  delete unsigned.signature;
  delete unsigned.receiptHash;
  if (!unsigned.publicKey) unsigned.publicKey = publicKeyFromPrivate(privateKey);
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptHash: digest,
    signature: signBytes(digest, privateKey),
  };
}

export function verifyReceipt(receipt: Receipt): boolean {
  if (!receipt.receiptHash || !receipt.signature || !receipt.publicKey) return false;
  const expected = receiptDigest(receipt);
  if (expected !== receipt.receiptHash) return false;
  return verifySignature(receipt.receiptHash, receipt.signature, receipt.publicKey);
}

export interface CreateReceiptInput {
  action: Receipt['action'];
  outcome: Receipt['outcome'];
  mandate: string;
  method: string;
  endpoint: string;
  nonce: string;
  bodyHash: string;
  signedAt: string;
  request: unknown;
  result: unknown;
  publicKey?: string;
  accountId?: string;
  verdict?: Receipt['verdict'];
  steps?: Receipt['steps'];
  warnings?: string[];
  error?: string;
}

export function createReceipt(input: CreateReceiptInput): Receipt {
  return {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
}

/**
 * Write a receipt to `.hexis/receipts/` (or the configured directory) and
 * return both the signed receipt and its path. Receipts never contain keys.
 */
export async function writeReceipt(
  directory: string,
  receipt: Receipt,
  privateKey?: string,
): Promise<WrittenReceipt> {
  const final = privateKey ? signReceipt(receipt, privateKey) : receipt;
  await mkdir(directory, { recursive: true });

  const stamp = (final.createdAt || new Date().toISOString()).replace(/[:.]/g, '-');
  const filename = `${stamp}-${final.id.slice(0, 8)}.json`;
  const target = path.join(directory, filename);
  const temporary = `${target}.${randomUUID().slice(0, 8)}.tmp`;

  await writeFile(temporary, `${JSON.stringify(final, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);

  return { receipt: final, path: target };
}
