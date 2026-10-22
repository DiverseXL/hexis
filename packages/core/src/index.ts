export { HexisClient } from './client.js';
export { HttpTransport, DEFAULT_BASE_URL, buildPath, VERSION } from './http.js';
export {
  generateKeyPair,
  publicKeyFromPrivate,
  normalizePrivateKey,
  normalizePublicKey,
  signRequest,
  signBytes,
  verifySignature,
  sha256Hex,
  serializeBody,
  buildCanonicalMessage,
  isSshKey,
  type KeyPair,
  type SignedRequest,
  type SignRequestInput,
} from './signing.js';
export {
  HARDCODED_MANIFEST,
  loadManifest,
  leverageCap,
  resolveReceiptDir,
  type LoadManifestOptions,
} from './defaults.js';
export { discoverLeads, fetchLead, mapDiscoveryTrader, maxDrawdownPct } from './discover.js';
export {
  evaluateRisk,
  checkLeadRisk,
  estimateLiquidationDistancePct,
  suggestSafeLeverage,
  LIQUIDATION_BUFFER_PCT,
  type RiskEvaluationInput,
} from './risk.js';
export { executeCopy, executeClose, type ExecuteCopyInput, type CloseResult } from './copy.js';
export { fetchPositions } from './positions.js';
export { fetchFills } from './history.js';
export { fetchAccount } from './account.js';
export {
  EXIT_CODES,
  exitCodeForVerdict,
  isBlocking,
  verdictFromChecks,
  errorVerdict,
} from './verdict.js';
export {
  canonicalJson,
  createReceipt,
  receiptDigest,
  signReceipt,
  verifyReceipt,
  writeReceipt,
  type CreateReceiptInput,
} from './receipt.js';
export { MCP_MANIFEST, type McpManifest } from './mcp.js';
export {
  HexisError,
  SigningError,
  AuthError,
  ApiError,
  NetworkError,
  ManifestError,
} from './errors.js';
export type * from './types.js';
