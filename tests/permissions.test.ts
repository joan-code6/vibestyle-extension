import { beforeEach, expect, it, vi } from 'vitest';
import type { SiteState } from '../src/shared/types';

const mock = vi.hoisted(() => ({ request: vi.fn(), firefox: true }));
vi.mock('../src/shared/browser', () => ({
  api: { permissions: { request: mock.request } }, isFirefox: () => mock.firefox,
}));
import { requestChangeAccess } from '../src/sidebar/permissions';

const state: SiteState = { hostname: 'example.com', tabId: 1, site: null, pending: null, hasPermission: true, scriptAccess: false };
beforeEach(() => {
  mock.firefox = true;
  mock.request.mockReset().mockImplementation(async request => {
    if (request.permissions?.includes('userScripts') && request.origins) throw new Error('Cannot request permission userScripts with another permission');
    return true;
  });
});

it('requests Firefox userScripts alone when installing or restoring a script', async () => {
  expect(await requestChangeAccess(state, true)).toBe(true);
  expect(mock.request.mock.calls).toEqual([[{ permissions: ['userScripts'] }]]);
});

it('restores missing site access first and requires a fresh click for userScripts', async () => {
  expect(await requestChangeAccess({ ...state, hasPermission: false }, true)).toBe(false);
  expect(mock.request.mock.calls).toEqual([[{ origins: ['http://example.com/*', 'https://example.com/*'] }]]);
  mock.request.mockClear();
  expect(await requestChangeAccess(state, true)).toBe(true);
  expect(mock.request.mock.calls).toEqual([[{ permissions: ['userScripts'] }]]);
});

it('does not request userScripts for CSS or when scripts are already allowed', async () => {
  expect(await requestChangeAccess(state, false)).toBe(true);
  expect(await requestChangeAccess({ ...state, scriptAccess: true }, true)).toBe(true);
  expect(mock.request).not.toHaveBeenCalled();
});

it('restores site access and continues immediately when userScripts is already granted', async () => {
  expect(await requestChangeAccess({ ...state, hasPermission: false, scriptAccess: true }, true)).toBe(true);
  expect(mock.request).toHaveBeenCalledWith({ origins: ['http://example.com/*', 'https://example.com/*'] });
});

it('preserves Chrome host permission behavior without requesting Firefox userScripts', async () => {
  mock.firefox = false;
  expect(await requestChangeAccess({ ...state, hasPermission: false }, true)).toBe(true);
  expect(mock.request.mock.calls).toEqual([[{ origins: ['http://example.com/*', 'https://example.com/*'] }]]);
});

it('stops when either site access or userScripts is declined', async () => {
  mock.request.mockResolvedValue(false);
  await expect(requestChangeAccess({ ...state, hasPermission: false }, true)).rejects.toThrow('Site access was declined');
  await expect(requestChangeAccess(state, true)).rejects.toThrow('Site scripts were declined');
});
