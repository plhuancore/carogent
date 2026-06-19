import type { CommandPaletteIconType } from './components/AppIcons';

export type CommandPaletteItem = {
  id: string;
  title: string;
  subtitle: string;
  keywords: string;
  icon: CommandPaletteIconType;
  run: () => void;
};

export type PaletteMode = 'quick-access' | 'command' | 'file';

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactSearchValue(value: string): string {
  return normalizeSearchValue(value).replace(/[^a-z0-9]/g, '');
}

function getSearchWords(value: string): string[] {
  return normalizeSearchValue(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let needleIndex = 0;

  for (const char of haystack) {
    if (char === needle[needleIndex]) {
      needleIndex += 1;

      if (needleIndex === needle.length) {
        return true;
      }
    }
  }

  return needle.length === 0;
}

function matchesWordPrefixChain(term: string, words: string[]): boolean {
  function visit(termIndex: number, wordIndex: number): boolean {
    if (termIndex === term.length) {
      return true;
    }

    for (let currentWordIndex = wordIndex; currentWordIndex < words.length; currentWordIndex += 1) {
      const word = words[currentWordIndex];
      let prefixLength = 0;

      while (
        prefixLength < word.length &&
        termIndex + prefixLength < term.length &&
        word[prefixLength] === term[termIndex + prefixLength]
      ) {
        prefixLength += 1;
      }

      for (let used = prefixLength; used > 0; used -= 1) {
        if (visit(termIndex + used, currentWordIndex + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  return visit(0, 0);
}

export function scorePaletteItemMatch(item: CommandPaletteItem, terms: string[]): number {
  const title = normalizeSearchValue(item.title);
  const haystack = normalizeSearchValue(`${item.title} ${item.subtitle} ${item.keywords}`);
  const compactTitle = compactSearchValue(item.title);
  const compactHaystack = compactSearchValue(`${item.title} ${item.subtitle} ${item.keywords}`);
  const words = getSearchWords(`${item.title} ${item.subtitle} ${item.keywords}`);
  let score = 0;

  for (const rawTerm of terms) {
    const term = compactSearchValue(rawTerm);

    if (!term) {
      continue;
    }

    if (title.startsWith(term)) {
      score += 120;
    } else if (haystack.includes(term)) {
      score += 100;
    } else if (compactTitle.includes(term)) {
      score += 90;
    } else if (compactHaystack.includes(term)) {
      score += 80;
    } else if (matchesWordPrefixChain(term, words)) {
      score += 70;
    } else if (isSubsequence(term, compactHaystack)) {
      score += 35;
    } else {
      return 0;
    }
  }

  return score;
}
