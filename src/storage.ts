import { api } from './shared/browser';
import { pendingKey, siteKey } from './shared/site';
import type { PendingChange, Settings, SiteChange } from './shared/types';

export async function getSettings(): Promise<Settings | null> {
  return (await api.storage.local.get('settings')).settings as Settings | undefined ?? null;
}

export async function getSite(hostname: string): Promise<SiteChange | null> {
  return (await api.storage.local.get(siteKey(hostname)))[siteKey(hostname)] as SiteChange | undefined ?? null;
}

export async function getPending(hostname: string): Promise<PendingChange | null> {
  return (await api.storage.local.get(pendingKey(hostname)))[pendingKey(hostname)] as PendingChange | undefined ?? null;
}

export async function allSites(): Promise<SiteChange[]> {
  const values = await api.storage.local.get(null);
  return Object.entries(values).filter(([key]) => key.startsWith('site:')).map(([, value]) => value as SiteChange);
}
