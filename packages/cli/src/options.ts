import type { Command } from 'commander';
import type { CommonOptions } from './context.js';
import { setColor } from './format.js';

export function withCommonOptions(command: Command): Command {
  return command
    .option('--json', 'machine-readable JSON output')
    .option('--manifest <path>', 'path to hexis.manifest.json')
    .option('--base-url <url>', 'Strike API base URL (default https://api.strikefinance.org)')
    .option('--key-file <path>', 'read the Ed25519 private key from a file')
    .option('--no-color', 'disable ANSI colours');
}

export function applyColor(options: CommonOptions): void {
  setColor(options.color !== false && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
}
