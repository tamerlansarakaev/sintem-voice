const LANGUAGES = {
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

function fillLanguages(select, selected) {
  for (const [code, name] of Object.entries(LANGUAGES)) {
    select.add(new Option(name, code, code === selected, code === selected));
  }
}
