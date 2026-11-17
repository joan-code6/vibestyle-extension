import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

// Work from the project root even when invoked from another directory.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const prepareOnly = process.argv.includes('--prepare-only');
if (!prepareOnly && (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET)) {
  console.error('Signing requires WEB_EXT_API_KEY and WEB_EXT_API_SECRET from https://addons.mozilla.org/developers/addon/api/key/');
  console.error('Run npm run prepare:firefox to prepare packages without credentials.');
  process.exit(1);
}

async function run(script, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
  });
}

await run('node_modules/typescript/bin/tsc', ['--noEmit']);
await run('scripts/build.mjs', ['firefox']);
const webExt = 'node_modules/web-ext/bin/web-ext.js';
await run(webExt, ['lint', '--source-dir', 'dist/firefox', '--no-config-discovery']);

// Upload only source and build inputs, never credentials or browser profiles.
const files = {};
async function collect(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile()) await add(file);
  }
}
async function add(path) {
  files[path.replaceAll('\\', '/')] = [new Uint8Array(await readFile(path)), { mtime: new Date('2020-01-01T00:00:00Z') }];
}
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'README.md']) await add(file);
for (const dir of ['src', 'scripts', 'assets', 'tests']) await collect(dir);
const source = zipSync(files);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
const sourcePath = `artifacts/vibestyle-${version}-source-${hash}.zip`;
await mkdir('artifacts', { recursive: true });
await writeFile(sourcePath, source);
console.log(`Source for Mozilla review: ${resolve(sourcePath)}`);
if (prepareOnly) {
  console.log('Prepared unsigned Firefox package. Signing is still required for permanent installation.');
} else {
  const signedDir = `artifacts/signed/${version}-${hash}`;
  await run(webExt, ['sign', '--channel', 'unlisted', '--source-dir', 'dist/firefox',
    '--artifacts-dir', signedDir, '--upload-source-code', sourcePath, '--no-config-discovery']);
  const signed = (await readdir(signedDir)).filter(file => file.endsWith('.xpi'));
  if (!signed.length) throw new Error('Mozilla has not returned a signed XPI. Check the submission status on Mozilla Add-ons.');
  for (const file of signed) console.log(`Signed Firefox installer: ${resolve(signedDir, file)}`);
  console.log('Install the signed XPI using Firefox about:addons > gear > Install Add-on From File.');
}
