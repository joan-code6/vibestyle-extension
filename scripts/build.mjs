import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import sharp from 'sharp';

const targets = process.argv[2] ? [process.argv[2]] : ['firefox', 'chrome'];
if (targets.some(target => !['firefox', 'chrome'].includes(target))) throw new Error('Expected firefox or chrome.');
await viteBuild();
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('artifacts', { recursive: true });

for (const target of targets) {
  const outdir = resolve('dist', target);
  if (dirname(outdir) !== resolve('dist')) throw new Error('Build output must stay within dist.');
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await cp('dist/ui', outdir, { recursive: true });
  await build({
    entryPoints: { background: 'src/background.ts', content: 'src/content.ts' },
    outdir, bundle: true, format: 'iife', platform: 'browser', target: ['chrome138', 'firefox140'],
    minify: false, legalComments: 'none',
  });
  await mkdir(join(outdir, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 96, 128]) {
    await sharp('assets/icon.svg').resize(size, size).png().toFile(join(outdir, `icons/${size}.png`));
  }
  const manifest = {
    manifest_version: 3,
    name: 'VibeStyle', version,
    description: 'Describe changes to a website. Keep your AI-generated CSS and site scripts across visits.',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting', ...(target === 'chrome' ? ['sidePanel', 'userScripts'] : [])],
    optional_permissions: target === 'firefox' ? ['userScripts'] : [],
    host_permissions: ['https://openrouter.ai/*', 'https://ai.hackclub.com/*'],
    optional_host_permissions: ['<all_urls>'],
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 96: 'icons/96.png', 128: 'icons/128.png' },
    action: { default_title: 'Open VibeStyle', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    options_ui: { page: 'index.html?settings', open_in_tab: true },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none';" },
    ...(target === 'firefox' ? {
      background: { scripts: ['background.js'] },
      sidebar_action: { default_panel: 'index.html', default_title: 'VibeStyle', default_icon: 'icons/32.png' },
      browser_specific_settings: { gecko: {
        id: 'vibestyle@extension.local', strict_min_version: '142.0',
        data_collection_permissions: { required: ['websiteContent', 'browsingActivity'] },
      } },
    } : {
      minimum_chrome_version: '138',
      background: { service_worker: 'background.js' },
      side_panel: { default_path: 'index.html' },
    }),
  };
  await writeFile(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = {};
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await collect(path);
      else files[relative(outdir, path).replaceAll('\\', '/')] = [new Uint8Array(await readFile(path)), { mtime: new Date('2020-01-01T00:00:00Z') }];
    }
  }
  await collect(outdir);
  const archive = zipSync(files);
  const fingerprint = createHash('sha256').update(archive).digest('hex').slice(0, 12);
  const artifact = `artifacts/vibestyle-${version}-${target}-${fingerprint}.zip`;
  const existing = await readFile(artifact).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing?.equals(Buffer.from(archive))) {
    console.log(`${target}: ${outdir}\nPackage: ${artifact}`);
    continue;
  }
  const temporaryArtifact = `${artifact}.tmp`;
  await writeFile(temporaryArtifact, archive);
  // Windows scanners can briefly hold a just-built archive open.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporaryArtifact, artifact); break; }
    catch (error) {
      if (attempt >= 4 || !['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  console.log(`${target}: ${outdir}\nPackage: ${artifact}`);
}
