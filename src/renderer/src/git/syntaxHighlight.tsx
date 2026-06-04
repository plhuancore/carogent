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

export function highlightCodeLine(code: string, filePath: string): React.ReactNode {
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
    return renderPrismTokens(tokens);
  } catch (err) {
    console.error('Error tokenizing line:', err);
    return code;
  }
}
