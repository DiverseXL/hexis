import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HARDCODED_MANIFEST, leverageCap, loadManifest } from '../src/defaults.js';
import { ManifestError } from '../src/errors.js';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'hexis-manifest-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'cwd');
  await writeFile(path.join(root, '.keep'), '');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(home, '.hexis'), { recursive: true });
  await mkdir(cwd, { recursive: true });
  return { root, home, cwd };
}

test('defaults match the locked product spec', async () => {
  const loaded = await loadManifest({ cwd: await mkdtemp(path.join(tmpdir(), 'hexis-empty-')), env: {} });
  assert.deepEqual(loaded.manifest, HARDCODED_MANIFEST);
  assert.equal(leverageCap(loaded.manifest, 'BTC-USD'), 15);
  assert.equal(leverageCap(loaded.manifest, 'SOL-USD'), 10);
});

test('file precedence is home < cwd < env file < explicit', async () => {
  const { root, home, cwd } = await workspace();
  await writeFile(
    path.join(home, '.hexis', 'manifest.json'),
    JSON.stringify({ caps: { maxLeverage: 7 } }),
  );
  await writeFile(path.join(cwd, 'hexis.manifest.json'), JSON.stringify({ caps: { maxLeverage: 5 } }));
  await writeFile(path.join(root, 'env.json'), JSON.stringify({ caps: { maxLeverage: 4 } }));
  await writeFile(path.join(root, 'explicit.json'), JSON.stringify({ caps: { maxLeverage: 3 } }));

  const loaded = await loadManifest({
    cwd,
    home,
    env: { HEXIS_MANIFEST: path.join(root, 'env.json') },
    explicitPath: path.join(root, 'explicit.json'),
  });

  assert.equal(leverageCap(loaded.manifest, 'SOL-USD'), 3);
  assert.ok(loaded.sources.some((source) => source.endsWith('explicit.json')));
});

test('environment scalars override files', async () => {
  const { home, cwd } = await workspace();
  await writeFile(path.join(cwd, 'hexis.manifest.json'), JSON.stringify({ caps: { maxLeverage: 5 } }));
  const loaded = await loadManifest({
    cwd,
    home,
    env: {
      HEXIS_MAX_LEVERAGE: '2',
      HEXIS_SIZE_PCT: '1.5',
      HEXIS_ISOLATED: 'false',
      HEXIS_MAX_LEAD_DRAWDOWN_PCT: '10',
    },
  });
  assert.equal(leverageCap(loaded.manifest, 'BTC-USD'), 2);
  assert.equal(loaded.manifest.defaults.sizePct, 1.5);
  assert.equal(loaded.manifest.defaults.isolated, false);
  assert.equal(loaded.manifest.caps.maxLeadDrawdown30dPct, 10);
});

test('an explicit --manifest beats environment scalars', async () => {
  const { root, home, cwd } = await workspace();
  await writeFile(path.join(root, 'explicit.json'), JSON.stringify({ caps: { maxLeverage: 6 } }));
  const loaded = await loadManifest({
    cwd,
    home,
    env: { HEXIS_MAX_LEVERAGE: '2' },
    explicitPath: path.join(root, 'explicit.json'),
  });
  assert.equal(leverageCap(loaded.manifest, 'BTC-USD'), 6);
});

test('merges symbol caps without dropping defaults', async () => {
  const { home, cwd } = await workspace();
  await writeFile(
    path.join(cwd, 'hexis.manifest.json'),
    JSON.stringify({ caps: { maxLeverage: { 'BTC-USD': 5, 'SOL-USD': 3 } } }),
  );
  const loaded = await loadManifest({ cwd, home, env: {} });
  assert.equal(leverageCap(loaded.manifest, 'BTC-USD'), 5);
  assert.equal(leverageCap(loaded.manifest, 'ETH-USD'), 15);
  assert.equal(leverageCap(loaded.manifest, 'DOGE-USD'), 10);
});

test('invalid JSON and invalid values fail loudly', async () => {
  const { home, cwd } = await workspace();
  await writeFile(path.join(cwd, 'hexis.manifest.json'), '{');
  await assert.rejects(() => loadManifest({ cwd, home, env: {} }), ManifestError);

  await writeFile(path.join(cwd, 'hexis.manifest.json'), JSON.stringify({ caps: { maxLeverage: -1 } }));
  await assert.rejects(() => loadManifest({ cwd, home, env: {} }), ManifestError);
});
