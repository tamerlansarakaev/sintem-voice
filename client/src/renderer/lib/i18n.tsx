import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { getPref, setPref, subscribePref } from './prefs';
import { STRINGS, type StringKey } from './strings';

export const UI_LANGUAGES = ['en', 'ru', 'fr', 'de', 'es'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export type Translate = (
  key: StringKey,
  vars?: Record<string, string | number>,
) => string;

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage);
}

// The saved choice, else the system language, else English.
function detectLanguage(): UiLanguage {
  const saved = getPref('uiLanguage');
  if (isUiLanguage(saved)) return saved;
  const system = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return isUiLanguage(system) ? system : 'en';
}

function translate(
  language: UiLanguage,
  key: StringKey,
  vars: Record<string, string | number> = {},
) {
  const strings: Partial<Record<StringKey, string>> = STRINGS[language];
  const text = strings[key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
}

interface I18n {
  language: UiLanguage;
  setLanguage(language: UiLanguage): void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState(detectLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Another window changed the language.
  useEffect(
    () =>
      subscribePref('uiLanguage', () => {
        const saved = getPref('uiLanguage');
        if (isUiLanguage(saved)) setLanguageState(saved);
      }),
    [],
  );

  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    setPref('uiLanguage', next);
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => translate(language, key, vars),
    [language],
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useI18n outside I18nProvider');
  return i18n;
}
