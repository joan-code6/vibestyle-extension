export function hostnameFromUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname : null;
  } catch { return null; }
}

export function siteMatches(hostname: string): string[] {
  if (!hostname || hostnameFromUrl(`https://${hostname}/`) !== hostname) throw new Error('Invalid website.');
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export const siteKey = (hostname: string) => `site:${hostname}`;
export const pendingKey = (hostname: string) => `pending:${hostname}`;
export const scriptId = (hostname: string) => `vibestyle-${Array.from(new TextEncoder().encode(hostname), byte => byte.toString(16).padStart(2, '0')).join('')}`;
