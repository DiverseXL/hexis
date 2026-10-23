# @mccloned/hexis-cli

Thin commander wrapper over `@mccloned/hexis-core`, with human-readable verdicts.

```bash
npx --package=@mccloned/hexis-cli hexis init
npx --package=@mccloned/hexis-cli hexis discover --platform hyperliquid --top 5
npx --package=@mccloned/hexis-cli hexis risk-check 0xLead... --leverage 8
npx --package=@mccloned/hexis-cli hexis copy 0xLead... --size 5% --leverage 8
npx --package=@mccloned/hexis-cli hexis positions --watch
npx --package=@mccloned/hexis-cli hexis history --source copy
```

Every command supports `--json`. Mutating commands print the signed receipt
path. Exit codes: `0` safe/success, `1` error, `2` high risk, `3` blocked.

See the repository README for the 40-second policy-flip demo.
