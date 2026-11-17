// Packaged content script, dynamically registered only on enabled, permitted sites.
// Page code cannot call extension management messages or read extension credentials.
import { api } from './shared/browser';
const state = globalThis as typeof globalThis & { __vibestyleBridgeInstalled?: boolean };
if (!state.__vibestyleBridgeInstalled) {
  state.__vibestyleBridgeInstalled = true;
  // This bridge exposes only an enabled/code-hash check, never extension APIs,
  // settings, page snapshots, or credentials. Treat all DOM messages as untrusted.
  window.addEventListener('message', event => {
    const value = event.data;
    if (event.source !== window || event.origin !== location.origin || value?.channel !== 'vibestyle' || value.type !== 'authorize-script' ||
      typeof value.requestId !== 'string' || value.requestId.length > 80 || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return;
    void api.runtime.sendMessage({ type: 'page:script-check', fingerprint: value.fingerprint }).then(reply => {
      window.postMessage({ channel: 'vibestyle', type: 'script-authorization', requestId: value.requestId, allowed: reply?.ok === true && reply.data === true }, location.origin);
    }).catch(() => {});
  });
  void api.runtime.sendMessage({ type: 'page:ready' }).catch(() => {});
}
