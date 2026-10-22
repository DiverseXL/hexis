import type { VerdictCode } from './types.js';

/** Base error carrying a stable machine code and a CLI exit code. */
export class HexisError extends Error {
  readonly code: VerdictCode | string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(message: string, code: VerdictCode | string = 'API_ERROR', exitCode = 1, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class SigningError extends HexisError {
  constructor(message: string, details?: unknown) {
    super(message, 'SIGNING_FAILED', 1, details);
  }
}

export class AuthError extends HexisError {
  constructor(message = 'This command requires HEXIS_PRIVATE_KEY or --key-file.') {
    super(message, 'AUTH_FAILED', 1);
  }
}

export class ApiError extends HexisError {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message, status === 401 ? 'AUTH_FAILED' : 'API_ERROR', 1, body);
    this.status = status;
    this.body = body;
  }
}

export class NetworkError extends HexisError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', 1, details);
  }
}

export class ManifestError extends HexisError {
  constructor(message: string, details?: unknown) {
    super(message, 'API_ERROR', 1, details);
  }
}
