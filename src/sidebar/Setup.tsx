import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Model, Provider, Settings } from '../shared/types';
import { PROVIDERS } from '../shared/providers';
import { send } from './client';

export function Setup({ initial, onSaved, onBack }: { initial: Settings | null; onSaved: () => void; onBack?: () => void }) {
  const [provider, setProvider] = useState<Provider>(initial?.provider ?? 'openrouter');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [models, setModels] = useState<Model[] | null>(null);
  const [step, setStep] = useState<'connection' | 'model'>('connection');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      if (step === 'connection') {
        const available = await send<Model[]>({ type: 'models:list', provider, apiKey });
        setModels(available);
        if (!available.some(item => item.id === model)) setModel('');
        setStep('model');
      } else {
        if (!models?.some(item => item.id === model)) throw new Error('Select a model from the list.');
        await send({ type: 'settings:save', settings: { provider, apiKey, model } });
        onSaved();
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not connect. Try again.'); }
    finally { setBusy(false); }
  }

  return <main className="setup">
    {(onBack || step === 'model') && <button className="text-button back" disabled={busy} onClick={() => {
      setError('');
      if (step === 'model') setStep('connection'); else onBack?.();
    }}><ArrowLeft size={15} aria-hidden="true" /> Back</button>}
    <div className="setup-intro">
      <h1>{step === 'connection' ? (initial ? 'Your AI connection.' : 'Make the web yours.') : 'Choose your model.'}</h1>
      <p>{step === 'connection' ? 'Connect your AI. Describe a change. Keep it.' : `Use a text model available through ${PROVIDERS[provider].name}.`}</p>
    </div>
    <form onSubmit={submit} className="setup-form">
      {step === 'connection' ? <>
        <label htmlFor="provider">AI provider</label>
        <select id="provider" value={provider} disabled={busy} onChange={event => {
          setProvider(event.target.value as Provider); setApiKey(''); setModels(null); setModel(''); setError('');
        }}>
          <option value="openrouter">OpenRouter</option>
          <option value="hackclub">Hack Club</option>
        </select>
        <div className="field-heading"><label htmlFor="api-key">API key</label><a href={PROVIDERS[provider].keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a></div>
        <input id="api-key" type="password" value={apiKey} autoComplete="off" spellCheck={false} required maxLength={1024}
          placeholder={provider === 'hackclub' ? 'sk-hc-v1-…' : 'sk-or-v1-…'} disabled={busy} onChange={event => setApiKey(event.target.value)} />
        {provider === 'hackclub' && <p className="field-note">Hack Club requires an eligible account and prohibits coding agents. This use may be blocked. <a href="https://docs.ai.hackclub.com/guide/rules.html" target="_blank" rel="noreferrer">Usage rules ↗</a></p>}
      </> : <>
        <label htmlFor="model">AI model</label>
        <input id="model" list="available-models" value={model} onChange={event => setModel(event.target.value)}
          placeholder="Search or select a model" autoComplete="off" spellCheck={false} required disabled={busy} autoFocus />
        <datalist id="available-models">{models?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
        <p className="field-note">Choose a model with image input. Each request includes page screenshots and up to three visual checks. Your provider’s pricing applies.</p>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary setup-submit" disabled={busy || (step === 'connection' ? !apiKey.trim() : !model.trim())}>
        {busy ? (step === 'connection' ? 'Connecting…' : 'Saving…') : step === 'connection' ? 'Continue' : 'Save & start'}
        {!busy && <ArrowRight size={16} aria-hidden="true" />}
      </button>
    </form>
    <p className="privacy-note">Your key and changes stay in this browser. Requests send page context, visible screenshots, and saved changes to your AI provider. Screenshots can include private information.</p>
  </main>;
}
