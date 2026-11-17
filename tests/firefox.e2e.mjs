import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('test-results');
await mkdir(output, { recursive: true });
const extensionPath = join(output, 'firefox-extension');
await cp('dist/firefox', extensionPath, { recursive: true });
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*', 'https://127.0.0.1/*');
await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'none'");
  response.end('<!doctype html><html><head><title>Firefox fixture</title></head><body><main><h1>Firefox customization</h1><aside>Clutter</aside></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/article`;
let driver;

try {
  const options = new firefox.Options().addArguments('-headless');
  if (process.env.FIREFOX_EXECUTABLE) options.setBinary(process.env.FIREFOX_EXECUTABLE);
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.manage().setTimeouts({ script: 30_000 });
  const id = await driver.installAddon(extensionPath, true);
  await driver.setContext(firefox.Context.CHROME);
  const extensionHost = await driver.executeScript('return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;', id);
  await driver.executeAsyncScript(`
    const id = arguments[0], done = arguments[arguments.length - 1];
    const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
    // Screenshot capture requires all_urls; this is an isolated test profile.
    ExtensionPermissions.add(id, { permissions: ['userScripts'], origins: ['<all_urls>'] }, WebExtensionPolicy.getByID(id).extension).then(() => done(true), e => done(String(e)));
  `, id);
  await driver.setContext(firefox.Context.CONTENT);
  await driver.get(url);
  const fixtureHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(`moz-extension://${extensionHost}/index.html`);
  const sidebarHandle = await driver.getWindowHandle();
  const invoke = async request => {
    const reply = await driver.executeAsyncScript(`
      const request = arguments[0], done = arguments[arguments.length - 1];
      // The real sidebar leaves the website active. An extension tab does not.
      (async () => {
        if (request.type === 'site:generate') await browser.tabs.update(request.tabId, { active: true });
        return browser.runtime.sendMessage(request);
      })().then(done, e => done({ ok: false, error: String(e) }));
    `, request);
    await driver.switchTo().window(sidebarHandle);
    if (!reply?.ok) throw new Error(reply?.error ?? 'No extension response.');
    return reply.data;
  };
  const tabId = await driver.executeAsyncScript(`
    browser.tabs.query({ url: ['http://127.0.0.1/*'] }).then(tabs => arguments[arguments.length - 1](tabs[0].id));
  `);
  await invoke({ type: 'settings:save', settings: { provider: 'openrouter', apiKey: 'firefox-fixture-key', model: 'fixture/model' } });

  async function fixtureProvider(change) {
    await driver.executeScript(`
      const background = browser.extension.getBackgroundPage();
      const change = arguments[0];
      background.fetch = async () => new background.Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(change) } }] }), { headers: { 'Content-Type': 'application/json' } });
    `, change);
  }
  async function verify(condition, label) {
    await driver.switchTo().window(fixtureHandle);
    await driver.wait(async () => driver.executeScript(`if (document.readyState !== "complete" || !document.querySelector("aside")) return false; ${condition}`), 10_000, label);
    await driver.switchTo().window(sidebarHandle);
  }
  await fixtureProvider({ summary: 'Less clutter in Firefox.', css: 'aside { display: none !important; }', js: '' });
  await invoke({ type: 'site:generate', hostname: '127.0.0.1', tabId, prompt: 'Hide the sidebar' });
  await verify('return getComputedStyle(document.querySelector("aside")).display === "none";', 'Firefox applies CSS');
  await driver.switchTo().window(fixtureHandle);
  await driver.navigate().refresh();
  await driver.switchTo().window(sidebarHandle);
  await verify('return getComputedStyle(document.querySelector("aside")).display === "none";', 'Firefox persists CSS across reload');
  await invoke({ type: 'site:toggle', hostname: '127.0.0.1', enabled: false });
  await verify('return getComputedStyle(document.querySelector("aside")).display !== "none";', 'Firefox disables CSS');
  await invoke({ type: 'site:toggle', hostname: '127.0.0.1', enabled: true });
  await verify('return getComputedStyle(document.querySelector("aside")).display === "none";', 'Firefox enables CSS');
  console.log('PASS Firefox: real extension install, provider round trip, strict CSP, persistent CSS, enable/disable');

  await fixtureProvider({ summary: 'A note in Firefox.', css: 'aside { display: none !important; }', js: 'const note = document.createElement("p"); note.id = "vibestyle-note"; note.textContent = "Firefox note"; document.body.append(note);' });
  const generated = await invoke({ type: 'site:generate', hostname: '127.0.0.1', tabId, prompt: 'Add a note' });
  assert.equal(generated.pending, true);
  await invoke({ type: 'site:install', hostname: '127.0.0.1' });
  await verify('return Boolean(document.querySelector("#vibestyle-note"));', 'Firefox user script runs');
  await invoke({ type: 'site:toggle', hostname: '127.0.0.1', enabled: false });
  await verify('return !document.querySelector("#vibestyle-note");', 'Firefox cleans up JS on disable');
  await invoke({ type: 'site:toggle', hostname: '127.0.0.1', enabled: true });
  await verify('return Boolean(document.querySelector("#vibestyle-note"));', 'Firefox restores JS');
  await invoke({ type: 'site:delete', hostname: '127.0.0.1' });
  await verify('return !document.querySelector("#vibestyle-note") && getComputedStyle(document.querySelector("aside")).display !== "none";', 'Firefox deletes all changes');
  const registered = await driver.executeAsyncScript('browser.userScripts.getScripts().then(scripts => arguments[arguments.length - 1](scripts.length));');
  assert.equal(registered, 0);
  console.log('PASS Firefox: explicit user-script installation, JavaScript execution, enable/disable/delete and cleanup');
} finally {
  if (driver) await driver.quit();
  server.close();
}
