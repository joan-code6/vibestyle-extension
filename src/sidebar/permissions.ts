import { api, isFirefox } from '../shared/browser';
import { siteMatches } from '../shared/site';
import type { SiteState } from '../shared/types';

// Called directly from the install/enable click, before any asynchronous work.
export async function requestChangeAccess(state: SiteState, needsScript: boolean): Promise<boolean> {
  if (!state.hostname) return false;
  const needsScriptPermission = isFirefox() && needsScript && !state.scriptAccess;
  if (!state.hasPermission) {
    const allowed = await api.permissions.request({ origins: siteMatches(state.hostname) });
    if (!allowed) throw new Error('Site access was declined. Allow access to enable this site’s changes.');
    // Firefox requires userScripts to be requested alone. A second click also
    // supplies a fresh user gesture instead of chaining permission prompts.
    if (needsScriptPermission) return false;
  } else if (needsScriptPermission) {
    const allowed = await api.permissions.request({ permissions: ['userScripts'] });
    if (!allowed) throw new Error('Site scripts were declined. Allow user scripts to install or enable this change.');
  }
  return true;
}
