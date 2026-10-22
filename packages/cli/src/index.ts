#!/usr/bin/env node
import { HexisError, VERSION } from '@hexis/core';
import { Command } from 'commander';
import { registerCopy } from './commands/copy.js';
import { registerDiscover } from './commands/discover.js';
import { registerHistory } from './commands/history.js';
import { registerInit } from './commands/init.js';
import { registerPositions } from './commands/positions.js';
import { registerRiskCheck } from './commands/risk-check.js';
import { printJson } from './context.js';
import { red } from './format.js';

const program = new Command();

program
  .name('hexis')
  .description('Risk-checked Strike copy trading from the command line. Every mutation leaves a signed receipt.')
  .version(VERSION)
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: true });

registerInit(program);
registerDiscover(program);
registerRiskCheck(program);
registerCopy(program);
registerPositions(program);
registerHistory(program);

program.addHelpText(
  'after',
  `
Examples:
  $ hexis init
  $ hexis discover --platform hyperliquid --rank pnl_30d --top 5
  $ hexis risk-check 0xLead... --leverage 25
  $ hexis risk-check 0xLead... --leverage 8
  $ hexis copy 0xLead... --size 5% --leverage 8
  $ hexis positions --watch
  $ hexis history --source copy

Exit codes:
  0  SAFE (or a forced HIGH_RISK, or a successful mutation)
  1  ERROR (network, auth, signing, or API failure)
  2  HIGH_RISK (pass --force to proceed)
  3  BLOCKED (copy will refuse without --force)

Configuration precedence:
  CLI flag > env var > ./hexis.manifest.json > ~/.hexis/manifest.json > defaults

Environment:
  HEXIS_PRIVATE_KEY   raw 64/128-char hex Ed25519 private key (never logged)
  HEXIS_MANIFEST      alternative manifest path
  HEXIS_BASE_URL      override the Strike API base URL
  HEXIS_RECEIPT_DIR   override .hexis/receipts
  NO_COLOR            disable ANSI colours
`,
);

function handleError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const code = error instanceof HexisError ? error.code : 'API_ERROR';
  const exitCode = error instanceof HexisError ? error.exitCode : 1;

  if (process.argv.includes('--json')) {
    printJson({ status: 'ERROR', code, message: normalized.message });
  } else {
    process.stderr.write(`${red(`ERROR [${code}]:`)} ${normalized.message}\n`);
  }
  process.exitCode = exitCode;
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleError(error);
}
