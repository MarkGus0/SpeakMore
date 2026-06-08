import { copyFileSync, mkdirSync, statSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {
    source: '',
    destDir: path.join(rootDir, 'release-artifacts', 'llama'),
    platform: process.platform,
    optional: false,
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--source') options.source = String(argv[index += 1] || '').trim();
    if (item === '--dest-dir') options.destDir = path.resolve(String(argv[index += 1] || '').trim());
    if (item === '--platform') options.platform = String(argv[index += 1] || '').trim();
    if (item === '--optional') options.optional = true;
    if (item === '--check') options.checkOnly = true;
  }

  return options;
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

function isExecutableFile(candidate) {
  if (!candidate) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathEntries(envPath = '', delimiter = path.delimiter) {
  return String(envPath || '')
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findOnPath(name, envPath = process.env.PATH, delimiter = path.delimiter) {
  for (const entry of pathEntries(envPath, delimiter)) {
    const candidate = path.join(entry, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return '';
}

function resolveSource({
  source = '',
  platform = process.platform,
  env = process.env,
  pathDelimiter = path.delimiter,
} = {}) {
  const name = executableName(platform);
  const candidates = [
    source,
    env.SPEAKMORE_LLAMA_SERVER_PATH,
    env.LLAMA_SERVER_PATH,
    env.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH,
    env.LLAMA_SERVER_DIR ? path.join(env.LLAMA_SERVER_DIR, name) : '',
    findOnPath(name, env.PATH, pathDelimiter),
  ];
  return candidates.map((item) => String(item || '').trim()).find(isExecutableFile) || '';
}

function formatMissingMessage({ platform = process.platform, destDir = '' } = {}) {
  const name = executableName(platform);
  return [
    `Missing ${name}.`,
    '',
    'Provide a local llama.cpp server binary before packaging:',
    `  npm run prepare:llama-runtime -- --source C:\\path\\to\\${name}`,
    `  or set SPEAKMORE_LLAMA_SERVER_PATH / LLAMA_SERVER_PATH / LLAMA_SERVER_DIR`,
    '',
    `The runtime will be copied to: ${path.join(destDir, name)}`,
    'Model weights are still downloaded by the user from the Settings page.',
  ].join('\n');
}

function prepareRuntime(options) {
  const name = executableName(options.platform);
  const source = resolveSource(options);
  const destination = path.join(options.destDir, name);

  if (!source) {
    if (options.optional) {
      console.warn(formatMissingMessage(options));
      return { copied: false, source: '', destination };
    }
    throw new Error(formatMissingMessage(options));
  }

  if (options.checkOnly) {
    console.log(`llama runtime found: ${source}`);
    return { copied: false, source, destination };
  }

  mkdirSync(options.destDir, { recursive: true });
  if (path.resolve(source) !== path.resolve(destination)) {
    copyFileSync(source, destination);
  }
  if (options.platform !== 'win32') {
    chmodSync(destination, 0o755);
  }
  console.log(`llama runtime prepared: ${destination}`);
  return { copied: true, source, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));

  try {
    prepareRuntime(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  executableName,
  findOnPath,
  formatMissingMessage,
  prepareRuntime,
  resolveSource,
};
