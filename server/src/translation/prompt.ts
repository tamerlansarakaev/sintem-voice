export const LANGUAGES: Record<string, string> = {
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

export interface PromptInput {
  text: string;
  // Previous source sentence, not translated.
  context?: string;
  source: string;
  target: string;
}

export function buildMessages({ text, context, source, target }: PromptInput) {
  const parts = [
    context
      ? `Previous context, do not translate it:\n<context>\n${context}\n</context>`
      : '',
    [
      `Translate the following ${LANGUAGES[source]} text into ${LANGUAGES[target]}.`,
      '- Use plain, natural language and keep the full meaning.',
      '- Keep numbers, dates, times, names, negations and conditions exact.',
      '- Add nothing: no explanations, notes or translator comments.',
      '- If the text is an unfinished fragment, translate it as a fragment; do not complete the thought.',
      '- Output only the translation.',
    ].join('\n'),
    `<text>\n${text}\n</text>`,
  ];
  return [{ role: 'user', content: parts.filter(Boolean).join('\n\n') }];
}
