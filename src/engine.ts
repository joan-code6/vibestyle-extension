import { api } from './shared/browser';
import { hostnameFromUrl, scriptId, siteMatches } from './shared/site';
import type { SiteChange } from './shared/types';

export async function hasScriptAccess(): Promise<boolean> {
  try {
    await api.userScripts.getScripts();
    return true;
  } catch { return false; }
}

export async function hasSiteAccess(hostname: string): Promise<boolean> {
  return api.permissions.contains({ origins: siteMatches(hostname) });
}

export async function scriptFingerprint(site: SiteChange): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(site.js)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function scriptSource(site: SiteChange): Promise<string> {
  const fingerprint = await scriptFingerprint(site);
  const key = JSON.stringify(`${scriptId(site.hostname)}:${fingerprint}`);
  // The same installed script can arrive via persistent registration and startup
  // recovery. Its code hash makes it run once per document in the shared user world.
  return `// VibeStyle site customization\nvoid (async () => {\ntry {\nconst __vibestyleAllowed = await new Promise(resolve => {\nconst requestId = crypto.randomUUID();\nconst finish = allowed => { clearTimeout(timer); window.removeEventListener('message', receive); resolve(allowed); };\nconst receive = event => { if (event.source === window && event.origin === location.origin && event.data?.channel === 'vibestyle' && event.data.type === 'script-authorization' && event.data.requestId === requestId) finish(event.data.allowed === true); };\nconst timer = setTimeout(() => finish(false), 3000);\nwindow.addEventListener('message', receive);\nwindow.postMessage({ channel: 'vibestyle', type: 'authorize-script', requestId, fingerprint: ${JSON.stringify(fingerprint)} }, location.origin);\n});\nif (!__vibestyleAllowed) return;\nconst __vibestyleRuns = globalThis.__vibestyleRuns ??= new Set();\nconst __vibestyleRoot = document.documentElement;\nif (__vibestyleRuns.has(${key}) || __vibestyleRoot.getAttribute('data-vibestyle-applied') === ${JSON.stringify(fingerprint)}) return;\n__vibestyleRuns.add(${key});\n__vibestyleRoot.setAttribute('data-vibestyle-applied', ${JSON.stringify(fingerprint)});\ntry { await (async () => {\n${site.js}\n})(); } catch { __vibestyleRuns.delete(${key}); if (__vibestyleRoot.getAttribute('data-vibestyle-applied') === ${JSON.stringify(fingerprint)}) __vibestyleRoot.removeAttribute('data-vibestyle-applied'); console.warn('VibeStyle: a site script failed. Disable or delete it in the sidebar.'); }\n} catch { /* A removed or unavailable extension never runs stale changes. */ }\n})();`;
}

export async function recoverScript(site: SiteChange, tabId: number): Promise<void> {
  if (!site.enabled || !site.js || !await hasScriptAccess() || typeof api.userScripts.execute !== 'function') return;
  // Ensure the packaged bridge exists even on pages restored before registration.
  await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await api.userScripts.execute({ target: { tabId }, world: 'USER_SCRIPT', js: [{ code: await scriptSource(site) }] });
}

export async function registerSite(site: SiteChange): Promise<void> {
  const id = scriptId(site.hostname);
  const registered = await api.scripting.getRegisteredContentScripts({ ids: [id] });
  const permitted = await hasSiteAccess(site.hostname);
  if (site.enabled && permitted) {
    const registration = { id, matches: siteMatches(site.hostname), js: ['content.js'], runAt: 'document_start' as const, persistAcrossSessions: true };
    if (registered.length) await api.scripting.updateContentScripts([registration]);
    else await api.scripting.registerContentScripts([registration]);
  } else if (registered.length) await api.scripting.unregisterContentScripts({ ids: [id] });

  if (await hasScriptAccess()) {
    const scripts = await api.userScripts.getScripts({ ids: [id] });
    if (site.enabled && permitted && site.js) {
      await api.userScripts.configureWorld({ csp: "script-src 'self'; connect-src 'none'; object-src 'none';", messaging: false });
      const script = {
        id, matches: siteMatches(site.hostname), runAt: 'document_idle' as const,
        world: 'USER_SCRIPT' as const,
        js: [{ code: await scriptSource(site) }],
      };
      if (scripts.length) await api.userScripts.update([script]);
      else await api.userScripts.register([script]);
    } else if (scripts.length) await api.userScripts.unregister({ ids: [id] });
  } else if (site.enabled && site.js) {
    throw new Error('Allow user scripts for VibeStyle first. In Chrome, open extension details and enable “Allow User Scripts”.');
  }
}

export async function unregisterSite(hostname: string): Promise<void> {
  const id = scriptId(hostname);
  const registered = await api.scripting.getRegisteredContentScripts({ ids: [id] });
  if (registered.length) await api.scripting.unregisterContentScripts({ ids: [id] });
  if (await hasScriptAccess()) {
    const scripts = await api.userScripts.getScripts({ ids: [id] });
    if (scripts.length) await api.userScripts.unregister({ ids: [id] });
  }
}

export async function updateOpenTabs(previous: SiteChange | null, next: SiteChange | null): Promise<number> {
  const hostname = (next ?? previous)?.hostname;
  if (!hostname) return 0;
  const tabs = await api.tabs.query({ url: siteMatches(hostname) });
  const previousJs = previous?.enabled ? previous.js : '';
  const nextJs = next?.enabled ? next.js : '';
  const reload = previousJs !== nextJs;
  let failures = 0;
  await Promise.all(tabs.map(async tab => {
    if (tab.id === undefined || hostnameFromUrl(tab.url) !== hostname) return;
    try {
      // A reload guarantees full cleanup of arbitrary DOM changes and listeners.
      if (reload) { await api.tabs.reload(tab.id); return; }
      if (previous?.css) await api.scripting.removeCSS({ target: { tabId: tab.id }, css: previous.css, origin: 'USER' });
      if (next?.enabled && next.css) await api.scripting.insertCSS({ target: { tabId: tab.id }, css: next.css, origin: 'USER' });
    } catch { failures++; }
  }));
  return failures;
}
