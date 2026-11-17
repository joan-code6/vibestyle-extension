import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { api, isFirefox } from '../shared/browser';
import type { Settings, SiteState } from '../shared/types';
import { send } from './client';
import { Setup } from './Setup';
import { requestChangeAccess } from './permissions';

const emptyState: SiteState = { hostname: null, tabId: null, site: null, pending: null, hasPermission: false, scriptAccess: false };

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);
  const [showSetup, setShowSetup] = useState(location.search.includes('settings'));
  const [state, setState] = useState<SiteState>(emptyState);
  const [prompt, setPrompt] = useState('');
  const [busyHost, setBusyHost] = useState<string | null>(null);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState<{ hostname: string; text: string } | null>(null);
  const refreshSequence = useRef(0);
  const hostname = useRef<string | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const inExtension = Boolean(api?.runtime?.id);
  const busy = busyHost === state.hostname && busyHost !== null;

  const refresh = useCallback(async () => {
    if (!api?.runtime?.id) return;
    const sequence = ++refreshSequence.current;
    try {
      const current = await send<SiteState>({ type: 'site:get' });
      if (sequence !== refreshSequence.current) return;
      if (hostname.current !== current.hostname) { setPrompt(''); setError(''); setNotice(''); }
      hostname.current = current.hostname;
      setState(current);
    } catch (error) {
      if (sequence === refreshSequence.current) setError(error instanceof Error ? error.message : 'Could not read this tab.');
    }
  }, []);

  useEffect(() => {
    if (!inExtension) { setReady(true); return; }
    let mounted = true;
    void send<Settings | null>({ type: 'settings:get' }).then(value => { if (mounted) setSettings(value); })
      .catch(error => { if (mounted) setError(error.message); }).finally(() => { if (mounted) setReady(true); });
    void refresh();
    const onActivated = () => { void refresh(); };
    const onUpdated = (_id: number, changes: { url?: string; status?: string }) => { if (changes.url || changes.status === 'complete') void refresh(); };
    const onStorage = () => { void refresh(); };
    const onFocus = () => { void refresh(); };
    api.tabs.onActivated.addListener(onActivated);
    api.tabs.onUpdated.addListener(onUpdated);
    api.storage.onChanged.addListener(onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      mounted = false;
      api.tabs.onActivated.removeListener(onActivated);
      api.tabs.onUpdated.removeListener(onUpdated);
      api.storage.onChanged.removeListener(onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [inExtension, refresh]);

  useEffect(() => {
    if (!busyHost) return;
    // Keep Chrome's worker alive while the provider streams a user-initiated request.
    const timer = setInterval(() => { void send({ type: 'ping' }).catch(() => {}); }, 20_000);
    return () => clearInterval(timer);
  }, [busyHost]);

  useEffect(() => { messageEnd.current?.scrollIntoView({ block: 'end' }); }, [state.site?.messages.length, state.pending, submitted, busy]);

  async function saved() {
    setSettings(await send<Settings>({ type: 'settings:get' }));
    setShowSetup(false); setError('');
    await refresh();
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const { hostname: host, tabId } = state;
    const text = prompt.trim();
    if (!host || tabId === null || !text || busyHost || state.pending) return;
    setError(''); setNotice(''); setBusyHost(host); setOperation('permission');
    try {
      // Request directly in this click's gesture, before any other asynchronous work.
      // Screenshot capture needs activeTab or <all_urls>; a site's host grant
      // alone is insufficient, and a sidebar click cannot grant activeTab.
      const allowed = await api.permissions.request({ origins: ['<all_urls>'] });
      if (!allowed) throw new Error('Site access was declined. Allow access to save and apply changes.');
      setOperation('generate');
      setSubmitted({ hostname: host, text });
      setPrompt('');
      const result = await send<{ pending: boolean; warning: string | null }>({ type: 'site:generate', hostname: host, tabId, prompt: text });
      if (hostname.current === host) setNotice(result.warning ?? '');
    } catch (error) {
      if (hostname.current === host) {
        setError(error instanceof Error ? error.message : 'Could not apply your change.');
        setPrompt(text);
      }
    } finally { setSubmitted(null); setBusyHost(null); setOperation(''); await refresh(); }
  }

  async function mutate(action: 'toggle' | 'delete' | 'install') {
    const host = state.hostname;
    if (!host || busyHost) return;
    setError(''); setNotice(''); setBusyHost(host); setOperation(action);
    try {
      if (action === 'install' || (action === 'toggle' && !state.site?.enabled)) {
        const ready = await requestChangeAccess(state, action === 'install' || Boolean(state.site?.js));
        if (!ready) {
          if (hostname.current === host) setNotice(`Site access allowed. ${action === 'install' ? 'Click Install site script' : 'Enable site changes'} again to allow user scripts.`);
          return;
        }
      }
      const request = action === 'toggle'
        ? { type: 'site:toggle' as const, hostname: host, enabled: !state.site?.enabled }
        : { type: action === 'delete' ? 'site:delete' as const : 'site:install' as const, hostname: host };
      const result = await send<{ warning: string | null }>(request);
      if (hostname.current === host) setNotice(result.warning ?? '');
    } catch (error) {
      if (hostname.current === host) setError(error instanceof Error ? error.message : 'The site changes could not be updated.');
    } finally { setBusyHost(null); setOperation(''); await refresh(); }
  }

  return <div className="app">
    <header className="app-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="VibeStyle">
        <span className="brand-mark" aria-hidden="true">v<span>.</span></span><span>VibeStyle</span>
      </a>
      {settings && !showSetup && <button className="icon-button" aria-label="AI settings" title="AI settings" disabled={Boolean(busyHost)} onClick={() => { setShowSetup(true); setError(''); }}><SettingsIcon size={18} /></button>}
    </header>

    {!inExtension ? <main className="setup"><h1>Your browser, your rules.</h1><p>Load VibeStyle as an extension in Firefox or Chrome to get started.</p><p className="field-note">See README.md for installation instructions.</p></main>
      : !ready ? <main className="loading" role="status">Opening VibeStyle…</main>
      : !settings || showSetup ? <Setup initial={settings} onSaved={() => { void saved(); }} onBack={settings ? () => setShowSetup(false) : undefined} />
      : <>
        <section className="site-bar" aria-label="Current site">
          <div className="site-identity"><span className={`status-dot ${state.site?.enabled ? 'active' : ''}`} aria-hidden="true" /><div>
            <h1 title={state.hostname ?? undefined}>{state.hostname ?? 'Open a website'}</h1>
            <p>{state.site ? (state.site.enabled ? 'Changes enabled' : 'Changes disabled') : state.hostname ? 'No saved changes' : 'Browser pages can’t be customized'}</p>
          </div></div>
          {state.site && <div className="site-actions">
            <button role="switch" aria-checked={state.site.enabled} aria-label="Enable site changes" className="switch" disabled={Boolean(busyHost)} onClick={() => { void mutate('toggle'); }}><span /></button>
            <button className="icon-button delete" title="Delete site changes" aria-label="Delete site changes" disabled={Boolean(busyHost)} onClick={() => { void mutate('delete'); }}><Trash2 size={16} /></button>
          </div>}
        </section>

        <main className="conversation" aria-label="Conversation">
          {!state.site?.messages.length && !state.pending && !submitted && <div className="empty-state">
            <h2>{state.hostname ? 'What would you change?' : 'Start with a website.'}</h2>
            <p>{state.hostname ? 'A darker theme. A wider article. A little less clutter. Just ask.' : 'Open a regular webpage, then describe how you want it to look or behave.'}</p>
            {state.hostname && <p className="empty-note">Changes are saved for this whole site.</p>}
          </div>}
          {state.site?.messages.map((message, index) => <article className={`message ${message.role}`} key={`${index}-${message.role}`}>
            <span className="message-author">{message.role === 'user' ? 'You' : 'VibeStyle'}</span><p>{message.text}</p>
          </article>)}
          {submitted?.hostname === state.hostname && <article className="message user"><span className="message-author">You</span><p>{submitted.text}</p></article>}
          {busy && (operation === 'generate' || operation === 'permission') && <p className="working" role="status"><span className="working-dot" /> {operation === 'permission' ? 'Waiting for site access…' : 'Making your changes…'}</p>}
          {state.pending && <section className="pending-script" aria-label="Site script ready">
            <h2>A site script is ready.</h2><p>{state.pending.summary}</p>
            <p className="field-note">This change needs JavaScript. Installing saves it for future visits and reloads this site’s open tabs.</p>
            <p className="field-note">Scripts can read and change page content. Only install changes you trust.</p>
            <details><summary>View script</summary><pre>{state.pending.js}</pre></details>
            {!state.scriptAccess && !isFirefox() && <p className="field-note">First, open Chrome → Extensions → VibeStyle → Details and turn on <strong>Allow User Scripts</strong>.</p>}
            <button className="primary" disabled={Boolean(busyHost)} onClick={() => { void mutate('install'); }}>{busy && operation === 'install' ? 'Installing…' : 'Install site script'}</button>
            <button className="text-button delete-pending" disabled={Boolean(busyHost)} onClick={() => { void mutate('delete'); }}>Delete site changes</button>
          </section>}
          {state.site?.enabled && !state.hasPermission && <p className="error" role="alert">Site access has been removed. Disable and enable this site’s changes to allow access again.</p>}
          {state.site?.enabled && state.site.js && !state.scriptAccess && !state.pending && <p className="error" role="alert">User scripts are currently blocked. Disable and enable this site’s changes to restore permission{isFirefox() ? '.' : ', or turn on Allow User Scripts in Chrome’s extension details.'}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div ref={messageEnd} />
        </main>

        <footer className="composer-area">
          <form className="composer" onSubmit={generate}>
            <label className="sr-only" htmlFor="prompt">Describe your website changes</label>
            <textarea id="prompt" ref={composer} rows={3} maxLength={4000} value={prompt}
              placeholder={state.pending ? 'Install or delete the pending script first' : 'Describe your changes…'}
              disabled={!state.hostname || busy || Boolean(state.pending)} onChange={event => setPrompt(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <div className="composer-bottom"><span title={settings.model}>{settings.model.split('/').pop()}</span>
              <button className="send-button" type="submit" aria-label="Apply changes" title="Apply changes" disabled={!state.hostname || !prompt.trim() || Boolean(busyHost) || Boolean(state.pending)}><ArrowUp size={18} aria-hidden="true" /></button>
            </div>
          </form>
          <p className="composer-note">Page context and screenshots go to {settings.provider === 'hackclub' ? 'Hack Club' : 'OpenRouter'} when you ask.</p>
        </footer>
      </>}
  </div>;
}
