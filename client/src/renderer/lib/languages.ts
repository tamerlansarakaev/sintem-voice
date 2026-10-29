import type { DropdownOption } from '../components/Dropdown';
import type { Translate } from './i18n';

// Languages the server translates between.
export const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

export function languageOptions(t: Translate): DropdownOption<Language>[] {
  return LANGUAGES.map((code) => ({ value: code, label: t(`lang.${code}`) }));
}
