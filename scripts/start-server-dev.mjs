import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const serverDir = path.join(rootDir, 'server');
const venvPython = process.platform === 'win32'
  ? path.join(serverDir, '.venv', 'Scripts', 'python.exe')
  : path.join(serverDir, '.venv', 'bin', 'python');

const explicitPython = String(process.env.SPEAKMORE_SERVER_PYTHON || '').trim();
const fallbackPython = String(process.env.PYTHON || '').trim() || (process.platform === 'win32' ? 'python' : 'python3');
const pythonBin = explicitPython || (existsSync(venvPython) ? venvPython : fallbackPython);

if (!explicitPython && !existsSync(venvPython)) {
  console.warn('未找到 server/.venv，将回退系统 Python；如模型加载失败，请先安装 server/requirements.txt。');
}

console.log(`使用后端 Python: ${pythonBin}`);

const child = spawn(pythonBin, ['main.py'], {
  cwd: serverDir,
  env: process.env,
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
  console.error(`后端启动失败: ${error.message}`);
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
