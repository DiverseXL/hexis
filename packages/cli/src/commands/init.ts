import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, HexisError } from '@mccloned/hexis-core';
import { Command } from 'commander';
import { printJson } from '../context.js';
import { bold, dim, green } from '../format.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Generate a raw Ed25519 API-wallet keypair (hex, not SSH).')
    .option('--out <path>', 'write the keypair to a JSON file instead of printing the private key')
    .option('--force', 'overwrite --out if it already exists')
    .option('--json', 'machine-readable output')
    .option('--no-color', 'disable ANSI colours')
    .action(async (options: { out?: string; force?: boolean; json?: boolean }) => {
      const pair = generateKeyPair();

      if (options.out) {
        const target = path.resolve(process.cwd(), options.out);
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await writeFile(
            target,
            `${JSON.stringify(
              {
                privateKey: pair.privateKey,
                publicKey: pair.publicKey,
                createdAt: new Date().toISOString(),
                note: 'Raw Ed25519 API-wallet key. Keep this file private and out of version control.',
              },
              null,
              2,
            )}\n`,
            { encoding: 'utf8', mode: 0o600, flag: options.force ? 'w' : 'wx' },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new HexisError(`Refusing to overwrite ${target}. Pass --force to replace it.`, 'API_ERROR', 1);
          }
          throw error;
        }
      }

      if (options.json) {
        printJson({
          privateKey: pair.privateKey,
          publicKey: pair.publicKey,
          ...(options.out ? { out: path.resolve(process.cwd(), options.out) } : {}),
          registerUrl: 'https://app.strikefinance.org/api-keys',
        });
        return;
      }

      const lines = [
        bold('Generated Ed25519 API wallet'),
        '',
        `  Public key:  ${green(pair.publicKey)}`,
      ];
      if (options.out) {
        lines.push(`  Key file:    ${path.resolve(process.cwd(), options.out)} ${dim('(mode 0600)')}`);
      } else {
        lines.push(`  Private key: ${pair.privateKey}`);
      }
      lines.push(
        '',
        'Register the public key at:',
        '  https://app.strikefinance.org/api-keys',
        '',
        options.out
          ? 'Use it with:  hexis positions --key-file ' + options.out
          : 'Then export it:  HEXIS_PRIVATE_KEY=<private key>',
        dim('Hexis never persists the private key unless --out is used.'),
      );
      process.stdout.write(`${lines.join('\n')}\n`);
    });
}
