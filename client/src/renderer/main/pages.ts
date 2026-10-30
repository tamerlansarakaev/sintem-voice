import { useSyncExternalStore } from 'react';

export const PAGES = ['voice-translation', 'voice-clone', 'settings'] as const;
export type Page = (typeof PAGES)[number];

const DEFAULT_PAGE: Page = 'voice-translation';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

// The active page lives in the URL hash so a reload keeps it.
export function useCurrentPage(): Page {
  const requested = useSyncExternalStore(subscribe, () => location.hash.slice(1));
  return PAGES.includes(requested as Page) ? (requested as Page) : DEFAULT_PAGE;
}

export function goTo(page: Page) {
  location.hash = `#${page}`;
}
