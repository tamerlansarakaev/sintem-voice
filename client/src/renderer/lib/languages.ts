import { useEffect, useState } from 'react';

import type { DropdownOption } from '../components/Dropdown';
import { useI18n, type Translate } from './i18n';

// Languages the server translates between.
export const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

// Languages whose translation quality is still being tuned.
const BETA: readonly Language[] = ['fr'];

export function languageOptions(t: Translate): DropdownOption<Language>[] {
  return LANGUAGES.map((code) => ({
    value: code,
    label: t(`lang.${code}`),
    badge: BETA.includes(code) ? 'Beta' : undefined,
  }));
}

// The language to pair with `language` when nothing else is chosen.
export function counterpart(language: Language): Language {
  return language === 'en' ? 'ru' : 'en';
}

// Follows the app's language unless `locked`.
export function useLanguagePair(
  initial: (language: Language) => [Language, Language],
  locked: boolean,
) {
  const { language } = useI18n();
  const [pair, setPair] = useState(() => initial(language));

  useEffect(() => {
    if (!locked) setPair(initial(language));
  }, [language]);

  const [source, target] = pair;
  return {
    source,
    target,
    setSource: (value: Language) => setPair(([, current]) => [value, current]),
    setTarget: (value: Language) => setPair(([current]) => [current, value]),
    swap: () => setPair(([from, to]) => [to, from]),
  };
}
