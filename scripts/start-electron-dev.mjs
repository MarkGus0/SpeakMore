import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkElectronDevPrereqs,
  getElectronBinPath,
} from './dev-prereqs.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

const prereqs = checkElectronDevPrereqs({
  existsSync,
  platform: process.platform,
  rootDir,
});

if (!prereqs.ok) {
  console.error(prereqs.message);
  process.exit(1);
}

const electronBin = getElectronBinPath({ rootDir, platform: process.platform });
const child = spawn(electronBin, ['./electron-app'], {
  cwd: rootDir,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

let exiting = false;

const exitFromChild = (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  process.exit(signal ? 1 : 0);
};

child.on('error', (error) => {
  console.error(`Electron 启动失败: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (!exiting) {
    exitFromChild(code, signal);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (exiting) {
      return;
    }
    exiting = true;
    child.once('exit', exitFromChild);
    child.kill(signal);
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
