import { browser } from 'wxt/browser';

/** Site access to X. Chrome grants manifest host permissions at install; Firefox MV3 makes them opt-in. */
export const X_ORIGINS = ['https://x.com/*', 'https://twitter.com/*'];

export async function hasXAccess(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: X_ORIGINS });
  } catch {
    return false;
  }
}

/** Must be the first await inside a click handler (Firefox user-gesture rule). */
export function requestXAccess(): Promise<boolean> {
  return browser.permissions.request({ origins: X_ORIGINS });
}
