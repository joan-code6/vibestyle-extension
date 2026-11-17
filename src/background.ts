import { api, isFirefox } from './shared/browser';
import { hostnameFromUrl, pendingKey, siteKey, siteMatches } from './shared/site';
import { validateSettings } from './shared/validation';
import type { PendingChange, Reply, Request, SiteChange, SiteState } from './shared/types';
import { allSites, getPending, getSettings, getSite } from './storage';
import { hasScriptAccess, hasSiteAccess, recoverScript, registerSite, scriptFingerprint, unregisterSite, updateOpenTabs } from './engine';
import { inspectPage } from './inspector';
import { generateChange, listModels } from './providers';

const inFlight = new Set<string>();
const queues = new Map<string, Promise<unknown>>();
let registrationQueue = Promise.resolve();

function serialized<T>(hostname: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(hostname) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  queues.set(hostname, next);
  void next.finally(() => { if (queues.get(hostname) === next) queues.delete(hostname); }).catch(() => {});
  return next;
}

// Lifecycle permission/startup events must not race with site installations.
function reconcile(): Promise<void> {
  registrationQueue = registrationQueue.catch(() => {}).then(async () => {
    const sites = await allSites();
    for (const site of sites) {
      await serialized(site.hostname, async () => {
        const current = await getSite(site.hostname);
        if (current) {
          await registerSite(current).catch(() => {});
          // Restored pages may already exist before the loader is reattached.
          // Keeping previous/next identical reapplies CSS without reloading JS.
          await updateOpenTabs(current, current);
          if (current.enabled && current.js) {
            for (const tab of await api.tabs.query({ url: siteMatches(current.hostname) })) {
              if (tab.id !== undefined && hostnameFromUrl(tab.url) === current.hostname) await recoverScript(current, tab.id).catch(() => {});
            }
          }
        }
      });
    }
  });
  return registrationQueue;
}

async function siteState(tabId?: number): Promise<SiteState> {
  const tab = tabId !== undefined ? await api.tabs.get(tabId) : (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const hostname = hostnameFromUrl(tab?.url);
  const base = { hostname, tabId: tab?.id ?? null, site: null, pending: null, hasPermission: false, scriptAccess: false };
  if (!hostname) return base;
  const [site, pending, hasPermission, scriptAccess] = await Promise.all([
    getSite(hostname), getPending(hostname), hasSiteAccess(hostname), hasScriptAccess(),
  ]);
  return { ...base, site, pending, hasPermission, scriptAccess };
}

async function saveSite(previous: SiteChange | null, next: SiteChange): Promise<string | null> {
  try { await registerSite(next); }
  catch (error) {
    if (previous) await registerSite(previous).catch(() => {});
    else await unregisterSite(next.hostname).catch(() => {});
    throw error;
  }
  try { await api.storage.local.set({ [siteKey(next.hostname)]: next, [`epoch:${next.hostname}`]: next.revision }); }
  catch (error) {
    if (previous) await registerSite(previous).catch(() => {});
    else await unregisterSite(next.hostname).catch(() => {});
    throw error;
  }
  await api.storage.local.remove(pendingKey(next.hostname));
  const failures = await updateOpenTabs(previous, next);
  return failures ? 'Saved. Reload any open site tabs where changes have not appeared.' : null;
}

function makeSite(hostname: string, change: PendingChange, previous: SiteChange | null): SiteChange {
  return {
    hostname, css: change.css, js: change.js, summary: change.summary,
    enabled: true, revision: crypto.randomUUID(),
    messages: [...(previous?.messages ?? []), { role: 'user' as const, text: change.prompt }, { role: 'assistant' as const, text: change.summary }].slice(-20),
  };
}

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case 'ping': return null;
    case 'settings:get': return getSettings();
    case 'settings:save': {
      await api.storage.local.set({ settings: validateSettings(request.settings) });
      return null;
    }
    case 'models:list': return listModels(request.provider, request.apiKey);
    case 'site:get': return siteState(request.tabId);
    case 'site:generate': {
      const { hostname, prompt, tabId } = request;
      siteMatches(hostname);
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw new Error('Describe your change in 4,000 characters or fewer.');
      if (inFlight.has(hostname)) throw new Error('A request is already running for this site. Wait for it to finish.');
      if (!await hasSiteAccess(hostname)) throw new Error('Allow VibeStyle to access this site first.');
      const tab = await api.tabs.get(tabId);
      if (hostnameFromUrl(tab.url) !== hostname) throw new Error('The active website changed. Submit your request again.');
      const settings = await getSettings();
      if (!settings) throw new Error('Set up an AI provider first.');
      inFlight.add(hostname);
      try {
        const site = await getSite(hostname);
        const epochKey = `epoch:${hostname}`;
        const epoch = (await api.storage.local.get(epochKey))[epochKey] ?? null;
        const result = await api.scripting.executeScript({ target: { tabId }, func: inspectPage });
        const snapshot = result[0]?.result;
        if (!snapshot || hostnameFromUrl(snapshot.url) !== hostname) throw new Error('The page changed while being read. Try again.');
        const screenshot = async () => {
          const active = (await api.tabs.query({ active: true, windowId: tab.windowId }))[0];
          if (active?.id !== tabId || hostnameFromUrl(active.url) !== hostname) throw new Error('Keep this website active while VibeStyle checks it.');
          return api.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 75 });
        };
        let generated = await generateChange(settings, snapshot, site, prompt.trim(), await screenshot());
        let previewCss = '';
        try {
          for (let round = 0; round < 3; round++) {
            // Generated scripts still require the explicit installation gesture.
            if (generated.js !== (site?.js ?? '')) break;
            if (previewCss) await api.scripting.removeCSS({ target: { tabId }, css: previewCss, origin: 'USER' });
            previewCss = generated.css;
            if (site?.enabled && site.css) await api.scripting.removeCSS({ target: { tabId }, css: site.css, origin: 'USER' });
            if (previewCss) await api.scripting.insertCSS({ target: { tabId }, css: previewCss, origin: 'USER' });
            await new Promise(resolve => setTimeout(resolve, 650));
            const reviewed = await generateChange(settings, snapshot, { ...site, ...generated } as SiteChange,
              `Original request: ${prompt.trim()}\nReview the attached screenshot of your applied changes. Fix visible issues. If it already looks correct, return EXACTLY the same css and js strings.`, await screenshot());
            const approved = reviewed.css === generated.css && reviewed.js === generated.js;
            generated = reviewed;
            if (approved) break;
          }
        } finally {
          if (previewCss) await api.scripting.removeCSS({ target: { tabId }, css: previewCss, origin: 'USER' }).catch(() => {});
          if (site?.enabled && site.css) await api.scripting.insertCSS({ target: { tabId }, css: site.css, origin: 'USER' }).catch(() => {});
        }
        const candidate: PendingChange = { ...generated, hostname, prompt: prompt.trim(), baseRevision: site?.revision ?? null };
        return await serialized(hostname, async () => {
          const current = await getSite(hostname);
          const currentEpoch = (await api.storage.local.get(epochKey))[epochKey] ?? null;
          if ((current?.revision ?? null) !== candidate.baseRevision || currentEpoch !== epoch) throw new Error('The site settings changed during this request. Submit it again.');
          // Every new or changed generated script needs an explicit installation click.
          if (candidate.js && candidate.js !== (current?.js ?? '')) {
            await api.storage.local.set({ [pendingKey(hostname)]: candidate });
            return { pending: true, warning: null };
          }
          const warning = await saveSite(current, makeSite(hostname, candidate, current));
          return { pending: false, warning };
        });
      } finally { inFlight.delete(hostname); }
    }
    case 'site:install': {
      siteMatches(request.hostname);
      return serialized(request.hostname, async () => {
        const pending = await getPending(request.hostname);
        if (!pending) throw new Error('There is no site script waiting to be installed.');
        const previous = await getSite(request.hostname);
        if ((previous?.revision ?? null) !== pending.baseRevision) throw new Error('This script is out of date. Submit your request again.');
        if (!await hasSiteAccess(request.hostname)) throw new Error('Allow access to this site first.');
        if (!await hasScriptAccess()) throw new Error('Allow User Scripts for VibeStyle in your browser’s extension settings, then try again.');
        return { warning: await saveSite(previous, makeSite(request.hostname, pending, previous)) };
      });
    }
    case 'site:toggle': {
      siteMatches(request.hostname);
      if (typeof request.enabled !== 'boolean') throw new Error('Invalid site state.');
      return serialized(request.hostname, async () => {
        const previous = await getSite(request.hostname);
        if (!previous) throw new Error('This site has no saved changes.');
        const next = { ...previous, enabled: request.enabled, revision: crypto.randomUUID() };
        return { warning: await saveSite(previous, next) };
      });
    }
    case 'site:delete': {
      siteMatches(request.hostname);
      return serialized(request.hostname, async () => {
        const previous = await getSite(request.hostname);
        await unregisterSite(request.hostname);
        await api.storage.local.set({ [`epoch:${request.hostname}`]: crypto.randomUUID() });
        await api.storage.local.remove([siteKey(request.hostname), pendingKey(request.hostname)]);
        const failures = await updateOpenTabs(previous, null);
        return { warning: failures ? 'Deleted. Reload open site tabs to finish removing changes.' : null };
      });
    }
    default: throw new Error('Unknown extension request.');
  }
}

api.runtime.onMessage.addListener((request: Request, sender, sendResponse) => {
  const respond = (promise: Promise<unknown>) => {
    void promise.then(data => sendResponse({ ok: true, data } satisfies Reply<unknown>)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'The request failed. Try again.';
      sendResponse({ ok: false, error: /timeout|aborted/i.test(message) ? 'The provider took too long. Try again or select a faster model.' : message } satisfies Reply<unknown>);
    });
    return true;
  };
  if (sender.id !== api.runtime.id) return false;
  if (request?.type === 'page:ready' || request?.type === 'page:script-check') {
    if (!sender.tab?.id || sender.frameId !== 0) return false;
    const tabId = sender.tab.id;
    const hostname = hostnameFromUrl(sender.url);
    return respond((async () => {
      if (!hostname) return null;
      const site = await getSite(hostname);
      if (request.type === 'page:script-check') {
        return Boolean(typeof request.fingerprint === 'string' && site?.enabled && site.js && await hasSiteAccess(hostname) && await scriptFingerprint(site) === request.fingerprint);
      }
      if (site?.enabled && site.css) {
        await api.scripting.insertCSS({ target: { tabId, frameIds: [0] }, css: site.css, origin: 'USER' });
      }
      if (site?.enabled && await hasSiteAccess(hostname)) await recoverScript(site, tabId);
      return null;
    })());
  }
  // Only this packaged sidebar/settings document can invoke privileged operations.
  const expected = api.runtime.getURL('index.html');
  if (sender.tab && !sender.url?.startsWith(expected)) return false;
  if (!sender.url || sender.url.split('?')[0].split('#')[0] !== expected) return false;
  return respond(handle(request));
});

api.runtime.onInstalled.addListener(() => { void reconcile(); });
api.runtime.onStartup.addListener(() => { void reconcile(); });
api.permissions.onAdded.addListener(() => { void reconcile(); });
api.permissions.onRemoved.addListener(() => { void reconcile(); });

// A tab can finish loading while startup/install reconciliation is still registering
// its document_start loader. Also covers restored tabs and missed early injections.
api.tabs.onUpdated.addListener((tabId, changes, tab) => {
  if (changes.status !== 'complete') return;
  const hostname = hostnameFromUrl(tab.url);
  if (!hostname) return;
  void (async () => {
    const site = await getSite(hostname);
    if (site?.enabled && site.css && await hasSiteAccess(hostname)) {
      await api.scripting.removeCSS({ target: { tabId }, css: site.css, origin: 'USER' });
      await api.scripting.insertCSS({ target: { tabId }, css: site.css, origin: 'USER' });
    }
    if (site?.enabled && await hasSiteAccess(hostname)) await recoverScript(site, tabId);
  })().catch(() => {});
});

if (isFirefox()) {
  api.action.onClicked.addListener(() => { void api.sidebarAction!.open(); });
} else {
  void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Restrict local storage to extension documents where Chrome supports it.
  void api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
}

// A cold worker can be started by a restored tab or sidebar rather than onStartup.
void reconcile().catch(() => {});
