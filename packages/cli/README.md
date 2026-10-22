# @hexis/cli

Thin commander wrapper over `@hexis/core`, with human-readable verdicts.

```bash
npx @hexis/cli init
npx @hexis/cli discover --platform hyperliquid --top 5
npx @hexis/cli risk-check 0xLead... --leverage 8
npx @hexis/cli copy 0xLead... --size 5% --leverage 8
npx @hexis/cli positions --watch
npx @hexis/cli history --source copy
```

Every command supports `--json`. Mutating commands print the signed receipt
path. Exit codes: `0` safe/success, `1` error, `2` high risk, `3` blocked.

See the repository README for the 40-second policy-flip demo.
