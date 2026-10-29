// Languages the server translates between.
const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de'];

// Fills (or refills after a language change) keeping the current choice.
function fillLanguages(select, selected) {
  const value = select.value || selected;
  select.replaceChildren(
    ...LANGUAGES.map((code) => new Option(t(`lang.${code}`), code)),
  );
  select.value = value;
}
