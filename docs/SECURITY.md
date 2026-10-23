# Security

**The Strike API wallet cannot withdraw funds.** Even a leaked key is bounded to trading actions. **Private keys never leave the machine** — Hexis signs locally and transmits only signatures, timestamps, nonces, and body hashes. **Hexis never persists keys by default**; `hexis init` prints the keypair and writes a file only when you pass `--out`, and `HEXIS_PRIVATE_KEY` is honored but never logged. **Every mutating action is receipted** — `.hexis/receipts/*.json` contains the body hash, nonce, result, and an Ed25519 signature, so any action is auditable.

## Withdrawal guarantee

Strike API wallets are trading credentials, not custody credentials. Per
Strike's API documentation, an API wallet can view balances and positions,
place and cancel orders, change leverage and margin mode, and read history. It
**cannot** withdraw funds or deposit funds (deposits require a JWT session).
Hexis relies only on the API-wallet surface.

If a private key leaks, the blast radius is trading activity on that account.
Revoke the API wallet in the Strike dashboard and generate a new one.

## Key handling

| Concern | Behavior |
| --- | --- |
| Key format | Raw Ed25519 hex. 64 hex chars (seed) or 128 hex chars (expanded). |
| SSH keys | Rejected with a `SIGNING_FAILED` error. Strike does not accept them. |
| Public key | Derived locally from the private key; a mismatched `publicKey` is rejected. |
| Persistence | None by default. `hexis init --out <path>` writes mode `0600` (best effort on Windows). |
| Environment | `HEXIS_PRIVATE_KEY` is read into memory only. It is never printed or receipted. |
| Logging | API errors are surfaced; request headers and keys are not logged. |
| Transmission | Only the four `X-API-Wallet-*` headers, the JSON body, and the path are sent. |

Never commit a key file. `.gitignore` excludes `.env`, `.hexis/`, and common
key artifacts, but you are responsible for your own storage.

## Request signing

The canonical message is byte-exact:

```
{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}
```

- `PATH` includes the query string exactly as sent.
- `BODY_HASH` is SHA-256 of the serialized JSON body. GET uses SHA-256 of the
  empty string: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- The body is serialized once; the same bytes are hashed and transmitted.
- `NONCE` is a fresh UUID v4 per request.
- `TIMESTAMP` is Unix seconds and must be within a short clock-skew window
  of server time (see Strike docs).

The signing module is deterministic when `timestamp` and `nonce` are injected,
which is how the RFC 8032 test vector and canonical-message tests stay honest.

## Receipts

A receipt is written for executed, refused, simulated, and failed mutations.
Refusals matter: they prove the risk engine stopped an action.

```json
{
  "version": 1,
  "id": "…",
  "action": "copy",
  "outcome": "executed",
  "mandate": "Copy 0xLead at 5% size, 8x leverage, isolated margin",
  "method": "POST",
  "endpoint": "/v2/copy/subscribe",
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "bodyHash": "…",
  "signedAt": "2026-10-21T19:42:11.000Z",
  "request": { "copy_mode": "fixed_ratio", "copy_amount": "500.00" },
  "result": { "subscription_id": "…", "status": "active" },
  "publicKey": "…",
  "receiptHash": "…",
  "signature": "…"
}
```

The receipt digest is SHA-256 over canonical JSON (sorted keys) of the receipt
without `receiptHash` and `signature`. The signature is Ed25519 over the digest
using the API-wallet key. Verify in code:

```ts
import { verifyReceipt } from '@hexis/core';
const ok = verifyReceipt(JSON.parse(await readFile(path, 'utf8')));
```

Receipts contain no private key material. They do contain public addresses,
sizes, and results — treat them as sensitive trading data.

## Known limitations

- Hexis cannot verify that a key is registered with Strike; an unregistered key
  produces an authentication error, not a preflight failure.
- Timestamp drift beyond the server's short clock-skew window (see Strike
  docs) causes auth failures. Sync your clock; `GET` on the server-time
  endpoint documented by Strike can help.
- The risk preflight is an estimate, not a liquidation guarantee. See
  [RISK.md](RISK.md).
- This project is a 48-hour MVP. It has not been audited. Use testnet first.
- `.hexis/receipts` grows without bound; rotate or archive it yourself.
