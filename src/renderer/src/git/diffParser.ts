export interface DiffLineInfo {
  raw: string;
  className: string;
  prefix: string;
  content: string;
  oldLineNumber: number | string;
  newLineNumber: number | string;
}

export interface HighlightedDiffLine {
  oldLineNumber: number | string;
  newLineNumber: number | string;
  prefix: string;
  className: string;
  isCodeLine: boolean;
  raw: string;
  dataLang: string;
  highlightedCode: ReactNode;
}

export function parseDiffLines(lines: string[]): DiffLineInfo[] {
  let currentOldLine = 0;
  let currentNewLine = 0;
  let hasParsedHunk = false;

  return lines.map((line) => {
    let className = 'diff-line-normal';
    let prefix = '';
    let content = line;
    let oldLineNumber: number | string = '';
    let newLineNumber: number | string = '';

    if (line.startsWith('+') && !line.startsWith('+++')) {
      className = 'diff-line-addition';
      prefix = '+';
      content = line.slice(1);
      if (hasParsedHunk) {
        newLineNumber = currentNewLine;
        currentNewLine++;
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      className = 'diff-line-deletion';
      prefix = '-';
      content = line.slice(1);
      if (hasParsedHunk) {
        oldLineNumber = currentOldLine;
        currentOldLine++;
      }
    } else if (line.startsWith('@@')) {
      className = 'diff-line-hunk';
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        currentOldLine = parseInt(match[1], 10);
        currentNewLine = parseInt(match[2], 10);
        hasParsedHunk = true;
      }
    } else if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
      className = 'diff-line-meta';
    } else if (line.startsWith(' ')) {
      prefix = ' ';
      content = line.slice(1);
      if (hasParsedHunk) {
        oldLineNumber = currentOldLine;
        newLineNumber = currentNewLine;
        currentOldLine++;
        currentNewLine++;
      }
    } else {
      prefix = '';
      content = line;
      if (hasParsedHunk && line.length === 0) {
        oldLineNumber = currentOldLine;
        newLineNumber = currentNewLine;
        currentOldLine++;
        currentNewLine++;
      }
    }

    return {
      raw: line,
      className,
      prefix,
      content,
      oldLineNumber,
      newLineNumber
    };
  });
}
import type { ReactNode } from 'react';
