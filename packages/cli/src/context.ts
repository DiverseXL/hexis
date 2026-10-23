import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AuthError,
  HexisClient,
  HexisError,
  type HexisClientOptions,
} from '@mccloned/hexis-core';

export interface CommonOptions {
  json?: boolean;
  manifest?: string;
  baseUrl?: string;
  keyFile?: string;
  color?: boolean;
}

export async function readPrivateKeyFile(file: string): Promise<string> {
  const resolved = path.resolve(process.cwd(), file);
  let text: string;
  try {
    text = await readFile(resolved, 'utf8');
  } catch (error) {
    throw new AuthError(`Cannot read key file ${resolved}: ${(error as Error).message}`);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { privateKey?: unknown };
      if (typeof parsed.privateKey !== 'string') {
        throw new AuthError(`Key file ${resolved} must contain a "privateKey" string.`);
      }
      return parsed.privateKey;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(`Key file ${resolved} is not valid JSON.`);
    }
  }

  if (!trimmed) throw new AuthError(`Key file ${resolved} is empty.`);
  return trimmed;
}

export async function resolvePrivateKey(keyFile?: string): Promise<string | undefined> {
  if (keyFile) return readPrivateKeyFile(keyFile);
  const fromEnv = process.env.HEXIS_PRIVATE_KEY?.trim();
  return fromEnv || undefined;
}

export async function createClient(options: CommonOptions): Promise<HexisClient> {
  const privateKey = await resolvePrivateKey(options.keyFile);
  const clientOptions: HexisClientOptions = {
    privateKey,
    baseUrl: options.baseUrl ?? process.env.HEXIS_BASE_URL,
    manifestPath: options.manifest,
    cwd: process.cwd(),
  };
  return new HexisClient(clientOptions);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function integerOption(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HexisError(`${name} must be an integer between ${min} and ${max}.`, 'API_ERROR', 1);
  }
  return parsed;
}

export function sizeOption(value: string): number {
  const parsed = Number(value.replace(/%$/, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new HexisError('--size must be a percentage between 0 and 100 (e.g. 5 or 5%).', 'API_ERROR', 1);
  }
  return parsed;
}

export function leverageOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 125) {
    throw new HexisError('--leverage must be between 1 and 125.', 'API_ERROR', 1);
  }
  return parsed;
}

export function isolatedOption(options: {
  isolated?: boolean;
  cross?: boolean;
}): boolean | undefined {
  if (options.isolated && options.cross) {
    throw new HexisError('Use either --isolated or --cross, not both.', 'API_ERROR', 1);
  }
  if (options.isolated) return true;
  if (options.cross) return false;
  return undefined;
}
