import React from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';

function renderPrismTokens(tokens: string | Prism.Token | (string | Prism.Token)[]): React.ReactNode {
  if (typeof tokens === 'string') {
    return tokens;
  }
  if (Array.isArray(tokens)) {
    return tokens.map((token, index) => <React.Fragment key={index}>{renderPrismTokens(token)}</React.Fragment>);
  }

  const tokenType = tokens.type;
  const content = tokens.content;

  let extraClass = '';
  if (tokenType === 'keyword' && typeof content === 'string') {
    const controlFlowKeywords = [
      'export', 'import', 'from', 'return', 'if', 'else', 'for', 'while',
      'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
      'finally', 'as', 'in', 'of', 'throw'
    ];
    if (controlFlowKeywords.includes(content)) {
      extraClass = ' control-flow';
    }
  }

  return (
    <span className={`token ${tokenType}${extraClass}`}>
      {renderPrismTokens(content)}
    </span>
  );
}

export type LocalMatchRange = {
  start: number;
  end: number;
  isActive: boolean;
  isSelectionMatch?: boolean;
};

function segmentLeafString(
  str: string,
  startOffset: number,
  matchRanges: LocalMatchRange[]
): React.ReactNode {
  const endOffset = startOffset + str.length;
  const elements: React.ReactNode[] = [];
  let currentOffset = startOffset;

  // Filter ranges that intersect with [startOffset, endOffset)
  const intersectingRanges = matchRanges.filter(
    (r) => r.start < endOffset && r.end > startOffset
  );

  if (intersectingRanges.length === 0) {
    return str;
  }

  // Sort ranges by start index
  intersectingRanges.sort((a, b) => a.start - b.start);

  intersectingRanges.forEach((range, idx) => {
    // Determine the overlap of the range with our leaf string
    const matchStart = Math.max(range.start, currentOffset);
    const matchEnd = Math.min(range.end, endOffset);

    if (matchStart > currentOffset) {
      elements.push(
        <span key={`text-${idx}`}>
          {str.slice(currentOffset - startOffset, matchStart - startOffset)}
        </span>
      );
    }

    const matchText = str.slice(matchStart - startOffset, matchEnd - startOffset);
    elements.push(
      <mark
        key={`match-${idx}`}
        className={range.isSelectionMatch ? 'selection-match' : `local-find-match${range.isActive ? ' is-active-local-match' : ''}`}
      >
        {matchText}
      </mark>
    );

    currentOffset = matchEnd;
  });

  if (currentOffset < endOffset) {
    elements.push(
      <span key="text-end">
        {str.slice(currentOffset - startOffset)}
      </span>
    );
  }

  return <>{elements}</>;
}

function renderPrismTokensWithSearch(
  tokens: string | Prism.Token | (string | Prism.Token)[],
  matchRanges: LocalMatchRange[],
  offsetTracker: { value: number }
): React.ReactNode {
  if (typeof tokens === 'string') {
    const result = segmentLeafString(tokens, offsetTracker.value, matchRanges);
    offsetTracker.value += tokens.length;
    return result;
  }
  if (Array.isArray(tokens)) {
    return tokens.map((token, index) => (
      <React.Fragment key={index}>
        {renderPrismTokensWithSearch(token, matchRanges, offsetTracker)}
      </React.Fragment>
    ));
  }

  const tokenType = tokens.type;
  const content = tokens.content;

  let extraClass = '';
  if (tokenType === 'keyword' && typeof content === 'string') {
    const controlFlowKeywords = [
      'export', 'import', 'from', 'return', 'if', 'else', 'for', 'while',
      'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
      'finally', 'as', 'in', 'of', 'throw'
    ];
    if (controlFlowKeywords.includes(content)) {
      extraClass = ' control-flow';
    }
  }

  return (
    <span className={`token ${tokenType}${extraClass}`}>
      {renderPrismTokensWithSearch(content, matchRanges, offsetTracker)}
    </span>
  );
}

const highlightCache = new Map<string, React.ReactNode>();
const MAX_CACHE_SIZE = 10000;

export function highlightCodeLine(
  code: string,
  filePath: string,
  matchRanges?: LocalMatchRange[]
): React.ReactNode {
  const hasLocalMatches = matchRanges && matchRanges.length > 0;
  
  // Only use cache if there are no search match highlights for this line
  if (!hasLocalMatches) {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const cacheKey = `${ext}:${code}`;
    if (highlightCache.has(cacheKey)) {
      return highlightCache.get(cacheKey)!;
    }
  }

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  let grammar = Prism.languages.clike;

  if (['ts', 'tsx'].includes(ext)) {
    grammar = Prism.languages.tsx || Prism.languages.typescript || Prism.languages.javascript;
  } else if (['js', 'jsx'].includes(ext)) {
    grammar = Prism.languages.jsx || Prism.languages.javascript;
  } else if (ext === 'css') {
    grammar = Prism.languages.css;
  } else if (ext === 'json') {
    grammar = Prism.languages.json;
  } else if (['html', 'htm', 'xml'].includes(ext)) {
    grammar = Prism.languages.markup || Prism.languages.html;
  }

  if (!grammar) {
    return code;
  }

  try {
    const tokens = Prism.tokenize(code, grammar);
    
    if (hasLocalMatches) {
      return renderPrismTokensWithSearch(tokens, matchRanges, { value: 0 });
    }
    
    const result = renderPrismTokens(tokens);
    const cacheKey = `${ext}:${code}`;
    
    if (highlightCache.size >= MAX_CACHE_SIZE) {
      // Clean up older items to limit memory usage
      const keys = Array.from(highlightCache.keys());
      for (let i = 0; i < MAX_CACHE_SIZE / 2; i++) {
        highlightCache.delete(keys[i]);
      }
    }
    
    highlightCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('Error tokenizing line:', err);
    return code;
  }
}
