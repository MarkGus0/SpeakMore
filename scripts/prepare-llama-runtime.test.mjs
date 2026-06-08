import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executableName,
  prepareRuntime,
  resolveSource,
} from './prepare-llama-runtime.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'speakmore-llama-runtime-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveSource prefers explicit source path', () => withTempDir((dir) => {
  const explicit = path.join(dir, 'custom-llama-server.exe');
  const envPath = path.join(dir, 'env-llama-server.exe');
  writeFileSync(explicit, 'runtime');
  writeFileSync(envPath, 'runtime');

  const result = resolveSource({
    source: explicit,
    platform: 'win32',
    env: { SPEAKMORE_LLAMA_SERVER_PATH: envPath },
  });

  assert.equal(result, explicit);
}));

test('resolveSource can use LLAMA_SERVER_DIR and platform executable name', () => withTempDir((dir) => {
  const runtime = path.join(dir, executableName('darwin'));
  writeFileSync(runtime, 'runtime');

  const result = resolveSource({
    platform: 'darwin',
    env: { LLAMA_SERVER_DIR: dir },
  });

  assert.equal(result, runtime);
}));

test('prepareRuntime copies runtime into release artifact directory', () => withTempDir((dir) => {
  const source = path.join(dir, 'llama-server.exe');
  const destDir = path.join(dir, 'release-artifacts', 'llama');
  writeFileSync(source, 'runtime');

  const result = prepareRuntime({
    source,
    destDir,
    platform: 'win32',
    optional: false,
    checkOnly: false,
  });

  assert.equal(result.copied, true);
  assert.equal(result.destination, path.join(destDir, 'llama-server.exe'));
}));
