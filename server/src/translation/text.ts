const SENTENCE_END = /[.!?…]+["'»”’)\]]*/;

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function joinText(...parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

// Words that can no longer grow: everything before the last whitespace.
export function completeWords(text: string): string[] {
  const match = /\s\S*$/.exec(text);
  return match ? splitWords(text.slice(0, match.index)) : [];
}

export function stripSentenceEnd(word: string): string {
  return word.replace(new RegExp(`${SENTENCE_END.source}$`), '');
}

// Apostrophe style and trailing punctuation do not make words different.
function normalizeWord(word: string): string {
  return stripSentenceEnd(word.replace(/’/g, "'")).replace(/[,;:]+$/, '');
}

export function commonPrefixLength(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length);
  let n = 0;
  while (n < limit && normalizeWord(a[n]) === normalizeWord(b[n])) n++;
  return n;
}

// Index right after the first sentence followed by whitespace, or -1.
export function findSentenceEnd(text: string): number {
  const match = new RegExp(`${SENTENCE_END.source}(?=\\s)`).exec(text);
  return match ? match.index + match[0].length : -1;
}
