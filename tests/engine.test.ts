import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteChange } from '../src/shared/types';
import { runInNewContext } from 'node:vm';

const mock = vi.hoisted(() => ({
  permissions: { contains: vi.fn() },
  scripting: { getRegisteredContentScripts: vi.fn(), registerContentScripts: vi.fn(), updateContentScripts: vi.fn(), unregisterContentScripts: vi.fn(), insertCSS: vi.fn(), removeCSS: vi.fn(), executeScript: vi.fn() },
  userScripts: { getScripts: vi.fn(), register: vi.fn(), update: vi.fn(), unregister: vi.fn(), configureWorld: vi.fn(), execute: vi.fn() },
  tabs: { query: vi.fn(), reload: vi.fn() },
}));
vi.mock('../src/shared/browser', () => ({ api: mock }));
import { recoverScript, registerSite, unregisterSite, updateOpenTabs } from '../src/engine';

const site: SiteChange = { hostname: 'example.com', enabled: true, css: 'body { color: red }', js: '', summary: 'Red.', revision: 'one', messages: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mock.permissions.contains.mockResolvedValue(true);
  mock.scripting.getRegisteredContentScripts.mockResolvedValue([]);
  mock.userScripts.getScripts.mockResolvedValue([]);
  mock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/a' }, { id: 2, url: 'http://example.com/b' }]);
});

describe('persistent site engine', () => {
  it('registers the CSS loader at document_start for only the exact site', async () => {
    await registerSite(site);
    expect(mock.scripting.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({
      matches: ['http://example.com/*', 'https://example.com/*'], runAt: 'document_start', persistAcrossSessions: true,
    })]);
    expect(mock.userScripts.register).not.toHaveBeenCalled();
  });

  it('keeps generated code in a user-script world without extension API messaging', async () => {
    await registerSite({ ...site, js: 'document.body.dataset.changed = "yes";' });
    expect(mock.userScripts.configureWorld).toHaveBeenCalledWith(expect.objectContaining({ messaging: false }));
    expect(mock.userScripts.register).toHaveBeenCalledWith([expect.objectContaining({ world: 'USER_SCRIPT', runAt: 'document_idle' })]);
  });

  it('unregisters disabled and deleted sites', async () => {
    mock.scripting.getRegisteredContentScripts.mockResolvedValue([{ id: 'loader' }]);
    mock.userScripts.getScripts.mockResolvedValue([{ id: 'script' }]);
    await registerSite({ ...site, enabled: false });
    expect(mock.scripting.unregisterContentScripts).toHaveBeenCalled();
    expect(mock.userScripts.unregister).toHaveBeenCalled();
    vi.clearAllMocks();
    await unregisterSite(site.hostname);
    expect(mock.scripting.unregisterContentScripts).toHaveBeenCalled();
    expect(mock.userScripts.unregister).toHaveBeenCalled();
  });

  it('removes CSS immediately from all matching open tabs on disable', async () => {
    await updateOpenTabs(site, { ...site, enabled: false });
    expect(mock.scripting.removeCSS).toHaveBeenCalledTimes(2);
    expect(mock.scripting.insertCSS).not.toHaveBeenCalled();
    expect(mock.tabs.reload).not.toHaveBeenCalled();
  });

  it('reloads affected tabs to clean up arbitrary JavaScript when disabled/deleted', async () => {
    await updateOpenTabs({ ...site, js: 'document.body.dataset.changed = "yes";' }, null);
    expect(mock.tabs.reload).toHaveBeenCalledTimes(2);
  });

  it('does not register on sites with revoked host permission', async () => {
    mock.permissions.contains.mockResolvedValue(false);
    await registerSite(site);
    expect(mock.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(mock.userScripts.register).not.toHaveBeenCalled();
  });

  it('returns a useful failure when user scripts are disabled', async () => {
    mock.userScripts.getScripts.mockRejectedValue(new Error('API blocked'));
    await expect(registerSite({ ...site, js: 'document.body.remove();' })).rejects.toThrow('Allow user scripts');
  });

  it('installs the packaged bridge before recovering a script in a restored page', async () => {
    await recoverScript({ ...site, js: 'document.body.dataset.changed = "yes";' }, 1);
    expect(mock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['content.js'] });
    expect(mock.userScripts.execute).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 1 }, world: 'USER_SCRIPT' }));
    expect(mock.scripting.executeScript.mock.invocationCallOrder[0]).toBeLessThan(mock.userScripts.execute.mock.invocationCallOrder[0]);
  });

  it('runs once across native and recovery worlds, and refuses stale/deleted scripts', async () => {
    await registerSite({ ...site, js: 'document.recordRun();' });
    const source = mock.userScripts.register.mock.calls[0][0][0].js[0].code;
    const attrs = new Map<string, string>();
    const recordRun = vi.fn();
    const document = { recordRun, documentElement: {
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      removeAttribute: (key: string) => attrs.delete(key),
    } };
    const run = async (allowed: boolean) => {
      const listeners = new Set<(event: unknown) => void>();
      const postMessage = vi.fn((message: { requestId: string }) => {
        queueMicrotask(() => listeners.forEach(listener => listener({ source: window, origin: 'https://example.com', data: { channel: 'vibestyle', type: 'script-authorization', requestId: message.requestId, allowed } })));
      });
      const window = { addEventListener: (_name: string, listener: (event: unknown) => void) => listeners.add(listener), removeEventListener: (_name: string, listener: (event: unknown) => void) => listeners.delete(listener), postMessage };
      runInNewContext(source, { document, window, location: { origin: 'https://example.com' }, crypto, setTimeout, clearTimeout, console });
      await new Promise(resolve => setImmediate(resolve));
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'authorize-script', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }), 'https://example.com');
    };
    await run(false);
    expect(recordRun).not.toHaveBeenCalled();
    await run(true);
    await run(true);
    expect(recordRun).toHaveBeenCalledTimes(1);
    attrs.clear(); // A new document after the user deletes the customization.
    await run(false);
    expect(recordRun).toHaveBeenCalledTimes(1);
  });
});
