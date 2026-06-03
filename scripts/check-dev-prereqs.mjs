import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkElectronDevPrereqs,
  checkServerPythonPackages,
  resolveServerPython,
} from './dev-prereqs.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

const serverPython = resolveServerPython({
  env: process.env,
  existsSync,
  platform: process.platform,
  rootDir,
});
const electron = checkElectronDevPrereqs({
  existsSync,
  platform: process.platform,
  rootDir,
});
let serverOk = serverPython.ok;

if (serverPython.ok) {
  console.log(`后端 Python：${serverPython.pythonBin}`);
  const serverPackages = checkServerPythonPackages({
    platform: process.platform,
    pythonBin: serverPython.pythonBin,
    spawnSync,
  });
  if (serverPackages.ok) {
    console.log('后端核心依赖：已满足');
  } else {
    console.error(serverPackages.message);
    serverOk = false;
  }
} else {
  console.error(serverPython.message);
}

if (electron.ok) {
  console.log('Electron 前置条件：已满足');
} else {
  console.error(electron.message);
}

if (!serverOk || !electron.ok) {
  process.exit(1);
}
