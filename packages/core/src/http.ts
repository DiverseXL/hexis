import { ApiError, AuthError, NetworkError } from './errors.js';
import {
  normalizePublicKey,
  publicKeyFromPrivate,
  signRequest,
  type SignedRequest,
} from './signing.js';

export const DEFAULT_BASE_URL = 'https://api.strikefinance.org';
export const VERSION = '0.1.0';

export type QueryValue = string | number | boolean | null | undefined;

export interface TransportOptions {
  baseUrl?: string;
  privateKey?: string;
  publicKey?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

export interface RequestOptions {
  method: string;
  /** Path without the query string, e.g. /v2/positions. */
  path: string;
  query?: Record<string, QueryValue>;
  /** JSON body. Serialized once and reused for signing and transmission. */
  body?: unknown;
  /** Pre-serialized body. Takes precedence over `body`. */
  bodyString?: string;
  /** Attach Strike API-wallet signature headers. Defaults to true. */
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface TransportResult<T> {
  data: T;
  status: number;
  url: string;
  signed?: SignedRequest;
}

export function buildPath(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Minimal, dependency-free HTTP transport with byte-exact Strike signing. */
export class HttpTransport {
  readonly baseUrl: string;
  readonly privateKey?: string;
  readonly publicKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: TransportOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.privateKey = options.privateKey?.trim() || undefined;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? `hexis/${VERSION}`;

    if (typeof this.fetchImpl !== 'function') {
      throw new NetworkError('No fetch implementation available. Use Node 20 or newer.');
    }

    if (this.privateKey) {
      const derived = publicKeyFromPrivate(this.privateKey);
      if (options.publicKey && normalizePublicKey(options.publicKey).toString('hex') !== derived) {
        throw new AuthError('Provided public key does not match the private key.');
      }
      this.publicKey = derived;
    } else if (options.publicKey) {
      this.publicKey = normalizePublicKey(options.publicKey).toString('hex');
    }
  }

  get authenticated(): boolean {
    return Boolean(this.privateKey);
  }

  async request<T>(options: RequestOptions): Promise<TransportResult<T>> {
    const method = options.method.toUpperCase();
    const path = buildPath(options.path, options.query);
    const url = `${this.baseUrl}${path}`;
    const useAuth = options.auth !== false;
    const body = options.bodyString ?? (options.body === undefined || options.body === null ? '' : JSON.stringify(options.body));

    if (useAuth && !this.privateKey) {
      throw new AuthError(
        `Signing ${method} ${options.path} requires a private key. Set HEXIS_PRIVATE_KEY or run hexis init.`,
      );
    }

    const signed = useAuth
      ? signRequest({
          method,
          path,
          bodyString: options.bodyString,
          body: options.body,
          privateKey: this.privateKey!,
          publicKey: this.publicKey,
        })
      : undefined;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      ...options.headers,
    };
    if (signed) Object.assign(headers, signed.headers);
    if (body) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body && method !== 'GET' && method !== 'HEAD' ? signed?.body ?? body : undefined,
        signal: options.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError(`Request aborted: ${method} ${path}`, error);
      }
      throw new NetworkError(`Network request failed: ${method} ${path}: ${message}`, error);
    }

    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
      const detail =
        (record?.error as string | undefined) ??
        (record?.msg as string | undefined) ??
        (typeof data === 'string' ? data : undefined) ??
        `HTTP ${response.status}`;
      throw new ApiError(response.status, `${method} ${path} failed (${response.status}): ${detail}`, data);
    }

    return { data: data as T, status: response.status, url, signed };
  }
}
