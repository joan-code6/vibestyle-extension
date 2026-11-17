import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// Real packaged extension + browser APIs. Only provider responses are fixtures.
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const extensionPath = join(output, 'chrome-extension');
await cp('dist/chrome', extensionPath, { recursive: true });
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
// Pregrant the local fixture only; production asks per-site from the Send gesture.
manifest.host_permissions.push('http://127.0.0.1/*', 'https://127.0.0.1/*');
await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'none'");
  response.end(`<!doctype html><html><head><title>Test article</title></head><body><main><h1>A readable web</h1><p>A fixture for website customization.</p><aside>Sidebar clutter</aside><form><label>Private customer</label><input value="private-form-value"><p>private-form-text</p></form><div contenteditable>private-editor-value</div><p data-private>private-tagged-value</p></main></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/article?secret=private-query-value`;
let executablePath = process.env.CHROMIUM_EXECUTABLE ?? chromium.executablePath();
if (!existsSync(executablePath)) {
  const cache = join(process.env.LOCALAPPDATA, 'ms-playwright');
  for (const folder of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    const candidate = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'].map(suffix => join(cache, folder, suffix)).find(existsSync);
    if (candidate) { executablePath = candidate; break; }
  }
}
const profile = join(output, `profile-${Date.now()}`);
let context;
let sidebar;
let fixture;
const errors = [];

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    executablePath, channel: 'chromium', headless: true, viewport: { width: 380, height: 800 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  fixture = await context.newPage();
  await fixture.goto(url);
  sidebar = await context.newPage();
  sidebar.on('pageerror', error => errors.push(error.message));
  await sidebar.goto(`chrome-extension://${id}/index.html`);
  return { worker, id };
}

async function siteFocus() {
  await fixture.bringToFront();
  await sidebar.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sidebar.getByRole('heading', { name: '127.0.0.1', exact: true }).waitFor();
}

async function waitFor(check, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${label}`);
}

async function providerFixtures(worker, change, status = 200) {
  await worker.evaluate(({ change, status }) => {
    globalThis.__originalFetch ??= globalThis.fetch;
    globalThis.__requests = [];
    globalThis.fetch = async (input, init) => {
      const address = String(input);
      if (address.endsWith('/models')) return Response.json({ data: [{ id: 'fixture/model', name: 'Fixture model', architecture: { output_modalities: ['text'] } }] });
      if (address.endsWith('/chat/completions')) {
        globalThis.__requests.push(JSON.parse(init.body));
        if (status !== 200) return new Response('private upstream error', { status });
        const text = JSON.stringify(change);
        const data = Array.from({ length: Math.ceil(text.length / 19) }, (_, index) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(index * 19, (index + 1) * 19) } }] }) + '\n\n').join('');
        return new Response(data + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return globalThis.__originalFetch(input, init);
    };
  }, { change, status });
}

try {
  let { worker, id } = await launch();
  await providerFixtures(worker, { summary: 'A darker page with less clutter.', css: 'body { background-color: rgb(22, 24, 28) !important; color: white !important; } aside { display: none !important; }', js: '' });
  await sidebar.screenshot({ path: join(output, 'setup-light.png') });
  await sidebar.getByLabel('API key', { exact: true }).fill('fixture-key-not-a-secret');
  await sidebar.getByRole('button', { name: 'Continue', exact: true }).click();
  await sidebar.getByLabel('AI model', { exact: true }).fill('fixture/model');
  await sidebar.getByRole('button', { name: 'Save & start', exact: true }).click();
  await siteFocus();
  await sidebar.screenshot({ path: join(output, 'empty-light.png') });
  await sidebar.getByLabel('Describe your website changes').fill('Make it dark and hide the sidebar');
  await sidebar.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await sidebar.getByText('A darker page with less clutter.', { exact: true }).waitFor();
  await waitFor(() => fixture.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(22, 24, 28)'), 'CSS applied');
  assert.equal(await fixture.locator('aside').isVisible(), false);
  const request = (await worker.evaluate(() => globalThis.__requests))[0];
  const sent = JSON.stringify(JSON.parse(request.messages[1].content).pageSnapshot);
  for (const secret of ['private-form-value', 'private-form-text', 'private-editor-value', 'private-tagged-value', 'private-query-value']) assert(!sent.includes(secret), `Snapshot leaked ${secret}`);
  await fixture.reload();
  await waitFor(() => fixture.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(22, 24, 28)'), 'CSS survives reload under strict page CSP');
  await sidebar.screenshot({ path: join(output, 'saved-light.png') });
  await sidebar.setViewportSize({ width: 280, height: 640 });
  await sidebar.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await sidebar.screenshot({ path: join(output, 'saved-narrow-dark.png') });
  assert(await sidebar.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sidebar overflows at narrow width');
  await sidebar.getByRole('switch', { name: 'Enable site changes' }).click();
  await waitFor(() => fixture.locator('aside').isVisible(), 'Disable removes CSS immediately');
  await sidebar.setViewportSize({ width: 380, height: 800 });
  await sidebar.emulateMedia({ colorScheme: 'light' });
  await sidebar.screenshot({ path: join(output, 'disabled-light.png') });
  await fixture.reload();
  assert.equal(await fixture.locator('aside').isVisible(), true);
  await sidebar.getByRole('switch', { name: 'Enable site changes' }).click();
  await waitFor(async () => !await fixture.locator('aside').isVisible(), 'Enable reapplies CSS');
  console.log('PASS: setup, model selection, CSS apply, privacy snapshot, strict CSP, reload, toggle, narrow/dark layout');

  // Check persistence across a full browser restart, including registered loaders.
  await context.close();
  ({ worker, id } = await launch());
  await siteFocus();
  await waitFor(async () => !await fixture.locator('aside').isVisible(), 'Persistent CSS after browser restart');
  await sidebar.getByText('A darker page with less clutter.', { exact: true }).waitFor();
  console.log('PASS: provider settings, conversation, and customization survive browser restart');

  // Enable the real Chromium user-script toggle through its own extension details UI.
  const details = await context.newPage();
  await details.goto(`chrome://extensions/?id=${id}`);
  const scriptToggle = details.locator('#allow-user-scripts cr-toggle');
  if (await scriptToggle.count()) {
    if (await scriptToggle.getAttribute('aria-pressed') !== 'true') await scriptToggle.click();
  } else {
    const directToggle = details.locator('cr-toggle#allow-user-scripts');
    if (await directToggle.count()) {
      if (await directToggle.getAttribute('aria-pressed') !== 'true') await directToggle.click();
    } else throw new Error('Could not find Chromium Allow User Scripts toggle.');
  }
  await details.close();
  await siteFocus();
  await providerFixtures(worker, { summary: 'An extra note on the page.', css: 'body { background-color: rgb(22, 24, 28) !important; }', js: 'if (!document.querySelector("#vibestyle-note")) { const note = document.createElement("p"); note.id = "vibestyle-note"; note.textContent = "Customized by you"; document.body.append(note); }' });
  await sidebar.getByLabel('Describe your website changes').fill('Add a note to the page');
  await sidebar.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Install site script', exact: true }).waitFor();
  assert.equal(await fixture.locator('#vibestyle-note').count(), 0, 'JS ran without explicit installation');
  await sidebar.screenshot({ path: join(output, 'script-install.png') });
  await sidebar.getByRole('button', { name: 'Install site script', exact: true }).click();
  await waitFor(() => fixture.locator('#vibestyle-note').isVisible(), 'User script installed and applied');
  await fixture.reload();
  await fixture.locator('#vibestyle-note').waitFor();
  await context.close();
  ({ worker, id } = await launch());
  await siteFocus();
  await waitFor(() => fixture.locator('#vibestyle-note').isVisible(), 'JavaScript survives full browser restart');
  await Promise.all([fixture.waitForEvent('load'), sidebar.getByRole('switch', { name: 'Enable site changes' }).click()]);
  await waitFor(async () => await fixture.locator('#vibestyle-note').count() === 0, 'Disable cleans up JavaScript by reload');
  await Promise.all([fixture.waitForEvent('load'), sidebar.getByRole('switch', { name: 'Enable site changes' }).click()]);
  await waitFor(() => fixture.locator('#vibestyle-note').isVisible(), 'Enable restores user script');
  await Promise.all([fixture.waitForEvent('load'), sidebar.getByRole('button', { name: 'Delete site changes', exact: true }).click()]);
  await waitFor(async () => await fixture.locator('#vibestyle-note').count() === 0, 'Delete removes JS');
  await fixture.reload();
  assert.equal(await fixture.locator('#vibestyle-note').count(), 0);
  await sidebar.getByText('No saved changes', { exact: true }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.userScripts.getScripts())).length, 0);
  assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  console.log('PASS: explicit JavaScript installation, persistence, disable, enable, delete, registration cleanup');

  await providerFixtures(worker, null, 401);
  await sidebar.getByLabel('Describe your website changes').fill('Make it wider');
  await sidebar.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await sidebar.getByRole('alert').filter({ hasText: 'The API key was rejected' }).waitFor();
  assert.equal(await sidebar.getByLabel('Describe your website changes').inputValue(), 'Make it wider');
  assert.equal(await sidebar.getByText('private upstream error').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: provider error recovery, prompt retention, no leaked upstream error, no UI runtime errors');
} catch (error) {
  if (sidebar) await sidebar.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  server.close();
}
