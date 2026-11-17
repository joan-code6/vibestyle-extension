export type Provider = 'openrouter' | 'hackclub';

export interface Settings {
  provider: Provider;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface GeneratedChange {
  summary: string;
  css: string;
  js: string;
}

export interface SiteChange extends GeneratedChange {
  hostname: string;
  enabled: boolean;
  revision: string;
  messages: ChatMessage[];
}

export interface PendingChange extends GeneratedChange {
  hostname: string;
  baseRevision: string | null;
  prompt: string;
}

export interface Model { id: string; name: string }
export interface SiteState {
  hostname: string | null;
  tabId: number | null;
  site: SiteChange | null;
  pending: PendingChange | null;
  hasPermission: boolean;
  scriptAccess: boolean;
  error?: string;
}

export type Request =
  | { type: 'settings:get' }
  | { type: 'settings:save'; settings: Settings }
  | { type: 'models:list'; provider: Provider; apiKey: string }
  | { type: 'site:get'; tabId?: number }
  | { type: 'site:generate'; tabId: number; hostname: string; prompt: string }
  | { type: 'site:install'; hostname: string }
  | { type: 'site:toggle'; hostname: string; enabled: boolean }
  | { type: 'site:delete'; hostname: string }
  | { type: 'page:ready' }
  | { type: 'page:script-check'; fingerprint: string }
  | { type: 'ping' };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
