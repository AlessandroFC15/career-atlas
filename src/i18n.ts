/** All user-facing copy lives in `_locales/<lang>/messages.json` and is looked
 *  up here, so adding a language means adding a message file, not editing
 *  components (issue #7). Chrome resolves the locale from the browser's UI
 *  language against `default_locale`, with no in-app switch — except the dev
 *  override below, which previews another locale without touching Chrome's
 *  actual UI language. */

const DEV_LOCALE_KEY = 'career-atlas:devLocale';

type MessageMap = Record<string, { message: string }>;
let devMessages: MessageMap | null = null;

/** Dev-only: load the override locale's messages before the app renders, so
 *  `t()` can read them synchronously afterwards. A no-op in production
 *  builds and whenever no override is set. Call once, from main.tsx, before
 *  mounting. */
export async function initDevLocale(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const lang = localStorage.getItem(DEV_LOCALE_KEY);
  if (!lang) return;
  const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
  devMessages = await res.json();
}

/** Dev-only: cycled by the floating toggle in devLocaleToggle.ts. `null`
 *  means "follow Chrome's UI language", the normal behavior. */
export const DEV_LOCALES: Array<string | null> = [null, 'pt_BR', 'en'];

export function getDevLocale(): string | null {
  return localStorage.getItem(DEV_LOCALE_KEY);
}

/** The BCP-47 tag to format dates/numbers with: the dev override (translated
 *  from its `_locales` folder name) when one is set, else Chrome's real UI
 *  language. `Intl.DateTimeFormat` needs this instead of `t()`'s message
 *  lookup for month names (see formatDate). */
export function getEffectiveLocale(): string {
  const dev = import.meta.env.DEV ? getDevLocale() : null;
  if (dev) return dev.replace('_', '-');
  return chrome.i18n.getUILanguage();
}

/** Persists the override and reloads, since every string in the tree needs
 *  to re-read it. */
export function setDevLocale(lang: string | null): void {
  if (lang) localStorage.setItem(DEV_LOCALE_KEY, lang);
  else localStorage.removeItem(DEV_LOCALE_KEY);
  location.reload();
}

export function t(key: string, substitutions?: string | number | Array<string | number>): string {
  const subs =
    substitutions === undefined
      ? undefined
      : (Array.isArray(substitutions) ? substitutions : [substitutions]).map(String);
  if (devMessages) {
    const entry = devMessages[key];
    if (!entry) return key;
    return subs ? entry.message.replace(/\$1/g, subs[0]) : entry.message;
  }
  return chrome.i18n.getMessage(key, subs);
}
