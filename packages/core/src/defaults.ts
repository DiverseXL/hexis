import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ManifestError } from './errors.js';
import type { Manifest } from './types.js';

export const HARDCODED_MANIFEST: Manifest = {
  version: 1,
  defaults: {
    isolated: true,
    leverage: 8,
    sizePct: 5,
    requireRiskCheck: true,
  },
  caps: {
    maxLeverage: { default: 10, 'BTC-USD': 15, 'ETH-USD': 15 },
    minLiquidationDistancePct: 5,
    maxLeadDrawdown30dPct: 25,
  },
  deny: {
    leads: [],
    markets: [],
  },
};

export interface LoadManifestOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Explicit --manifest path, highest file precedence. */
  explicitPath?: string;
}

export interface LoadedManifest {
  manifest: Manifest;
  sources: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeManifest(base: Manifest, raw: unknown, source: string): Manifest {
  if (!isRecord(raw)) {
    throw new ManifestError(`Manifest ${source} must contain a JSON object.`);
  }

  const merged = clone(base);

  if (raw.version !== undefined && raw.version !== 1) {
    throw new ManifestError(`Manifest ${source} has unsupported version ${String(raw.version)}.`);
  }

  if (raw.defaults !== undefined) {
    if (!isRecord(raw.defaults)) throw new ManifestError(`Manifest ${source}: defaults must be an object.`);
    for (const key of ['isolated', 'leverage', 'sizePct', 'requireRiskCheck'] as const) {
      const value = raw.defaults[key];
      if (value === undefined) continue;
      if (key === 'isolated' || key === 'requireRiskCheck') {
        if (typeof value !== 'boolean') {
          throw new ManifestError(`Manifest ${source}: defaults.${key} must be a boolean.`);
        }
        merged.defaults[key] = value;
      } else {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          throw new ManifestError(`Manifest ${source}: defaults.${key} must be a positive number.`);
        }
        merged.defaults[key] = value;
      }
    }
  }

  if (raw.caps !== undefined) {
    if (!isRecord(raw.caps)) throw new ManifestError(`Manifest ${source}: caps must be an object.`);
    const maxLeverage = raw.caps.maxLeverage;
    if (maxLeverage !== undefined) {
      if (typeof maxLeverage === 'number') {
        if (!Number.isFinite(maxLeverage) || maxLeverage <= 0) {
          throw new ManifestError(`Manifest ${source}: caps.maxLeverage must be positive.`);
        }
        merged.caps.maxLeverage = maxLeverage;
      } else if (isRecord(maxLeverage)) {
        const base = isRecord(merged.caps.maxLeverage) ? merged.caps.maxLeverage : {};
        const next: Record<string, number> = { ...base };
        for (const [symbol, value] of Object.entries(maxLeverage)) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new ManifestError(
              `Manifest ${source}: caps.maxLeverage["${symbol}"] must be a positive number.`,
            );
          }
          next[symbol] = value;
        }
        merged.caps.maxLeverage = next;
      } else {
        throw new ManifestError(`Manifest ${source}: caps.maxLeverage must be a number or object.`);
      }
    }

    for (const key of ['minLiquidationDistancePct', 'maxLeadDrawdown30dPct'] as const) {
      const value = raw.caps[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new ManifestError(`Manifest ${source}: caps.${key} must be a non-negative number.`);
      }
      merged.caps[key] = value;
    }
  }

  if (raw.deny !== undefined) {
    if (!isRecord(raw.deny)) throw new ManifestError(`Manifest ${source}: deny must be an object.`);
    for (const key of ['leads', 'markets'] as const) {
      const value = raw.deny[key];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new ManifestError(`Manifest ${source}: deny.${key} must be an array of strings.`);
      }
      merged.deny[key] = [...value];
    }
  }

  return merged;
}

function applyEnv(manifest: Manifest, env: NodeJS.ProcessEnv): { manifest: Manifest; keys: string[] } {
  const keys: string[] = [];
  const next = clone(manifest);

  const num = (name: string, apply: (value: number) => void, { allowZero = false } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
      throw new ManifestError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} number.`);
    }
    apply(value);
    keys.push(name);
  };
  const bool = (name: string, apply: (value: boolean) => void) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return;
    const normalized = raw.toLowerCase();
    if (!['1', '0', 'true', 'false', 'yes', 'no'].includes(normalized)) {
      throw new ManifestError(`${name} must be a boolean (true/false).`);
    }
    apply(['1', 'true', 'yes'].includes(normalized));
    keys.push(name);
  };

  num('HEXIS_LEVERAGE', (value) => (next.defaults.leverage = value));
  num('HEXIS_SIZE_PCT', (value) => (next.defaults.sizePct = value));
  bool('HEXIS_ISOLATED', (value) => (next.defaults.isolated = value));
  bool('HEXIS_REQUIRE_RISK_CHECK', (value) => (next.defaults.requireRiskCheck = value));
  num('HEXIS_MAX_LEVERAGE', (value) => (next.caps.maxLeverage = value));
  num('HEXIS_MIN_LIQ_DISTANCE_PCT', (value) => (next.caps.minLiquidationDistancePct = value), {
    allowZero: true,
  });
  num('HEXIS_MAX_LEAD_DRAWDOWN_PCT', (value) => (next.caps.maxLeadDrawdown30dPct = value), {
    allowZero: true,
  });

  return { manifest: next, keys };
}

/**
 * File precedence (low to high):
 *   hardcoded < ~/.hexis/manifest.json < ./hexis.manifest.json < HEXIS_MANIFEST < --manifest
 * Environment scalar overrides are applied last.
 */
export async function loadManifest(options: LoadManifestOptions = {}): Promise<LoadedManifest> {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const sources: string[] = [];
  let manifest = clone(HARDCODED_MANIFEST);

  const candidates: Array<{ file: string; required: boolean }> = [
    { file: path.join(home, '.hexis', 'manifest.json'), required: false },
    { file: path.join(cwd, 'hexis.manifest.json'), required: false },
  ];
  if (env.HEXIS_MANIFEST) candidates.push({ file: path.resolve(cwd, env.HEXIS_MANIFEST), required: true });

  for (const candidate of candidates) {
    let text: string;
    try {
      text = await readFile(candidate.file, 'utf8');
    } catch (error) {
      if (candidate.required) {
        throw new ManifestError(`Cannot read manifest ${candidate.file}: ${(error as Error).message}`);
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ManifestError(`Manifest ${candidate.file} is not valid JSON: ${(error as Error).message}`);
    }

    manifest = mergeManifest(manifest, parsed, candidate.file);
    sources.push(candidate.file);
  }

  const fromEnv = applyEnv(manifest, env);
  manifest = fromEnv.manifest;
  sources.push(...fromEnv.keys);

  if (options.explicitPath) {
    const file = path.resolve(cwd, options.explicitPath);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      throw new ManifestError(`Cannot read manifest ${file}: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ManifestError(`Manifest ${file} is not valid JSON: ${(error as Error).message}`);
    }
    manifest = mergeManifest(manifest, parsed, file);
    sources.push(file);
  }

  return { manifest, sources };
}

export function leverageCap(manifest: Manifest, market?: string): number {
  const cap = manifest.caps.maxLeverage;
  if (typeof cap === 'number') return cap;
  if (market && typeof cap[market] === 'number') return cap[market]!;
  return typeof cap.default === 'number' ? cap.default : 10;
}

export function resolveReceiptDir(input: { cwd?: string; env?: NodeJS.ProcessEnv; override?: string }): string {
  if (input.override) return path.resolve(input.cwd ?? process.cwd(), input.override);
  const env = input.env ?? process.env;
  if (env.HEXIS_RECEIPT_DIR) return path.resolve(input.cwd ?? process.cwd(), env.HEXIS_RECEIPT_DIR);
  return path.join(input.cwd ?? process.cwd(), '.hexis', 'receipts');
}
