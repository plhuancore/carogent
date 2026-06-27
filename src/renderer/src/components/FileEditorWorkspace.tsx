import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor, Monaco } from '@monaco-editor/react';
import { CloseIcon, RefreshIcon } from './AppIcons';

const EDITOR_THEME = 'carogent-dark-plus';

function parseGitDiffUrl(urlStr: string): { filePath: string; searchParams: URLSearchParams } {
  const prefix = 'gitdiff://';
  if (!urlStr.startsWith(prefix)) {
    return { filePath: '', searchParams: new URLSearchParams() };
  }
  const mainPart = urlStr.slice(prefix.length);
  const qIdx = mainPart.indexOf('?');
  const filePathPart = qIdx >= 0 ? mainPart.slice(0, qIdx) : mainPart;
  const searchPart = qIdx >= 0 ? mainPart.slice(qIdx) : '';
  
  const decodedPath = decodeURIComponent(filePathPart);
  let filePath = decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
  if (/^[a-zA-Z]\//.test(filePath)) {
    filePath = filePath.slice(0, 1) + ':' + filePath.slice(1);
  }
  const searchParams = new URLSearchParams(searchPart);
  
  return { filePath, searchParams };
}

const normalizePath = (p: string) => {
  let cleaned = p.replace(/\\/g, '/').replace(/^\//, '');
  cleaned = cleaned.replace(/^[a-zA-Z]:/, '');
  cleaned = cleaned.replace(/^\//, '');
  return cleaned.toLowerCase();
};

type EditorTab = {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  modifiedAt?: number;
  loading: boolean;
  saving: boolean;
  error?: string;
  isImage?: boolean;
  isDiff?: boolean;
  originalContent?: string;
  modifiedContent?: string;
};

type FileEditorWorkspaceProps = {
  activeFilePath: string;
  activeLineNumber?: number;
  activeColumnNumber?: number;
  rootPath: string;
  onActiveFileChange?: (path: string, lineNumber?: number, columnNumber?: number) => void;
  onActiveFilePathChange?: (path: string) => void;
  globalSearchQuery?: string;
  globalSearchCaseSensitive?: boolean;
  globalSearchWholeWord?: boolean;
  globalSearchUseRegex?: boolean;
  onClose?: () => void;
};

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getRelativePath(path: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();

  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }

  return path;
}

function formatModifiedAt(value?: number): string {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getEditorLanguage(filePath: string): string {
  const pathWithoutQuery = filePath.split('?')[0];
  const ext = pathWithoutQuery.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'py':
    case 'pyw':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return 'cpp';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'sql':
      return 'sql';
    case 'java':
      return 'java';
    case 'rb':
      return 'ruby';
    case 'php':
      return 'php';
    case 'toml':
      return 'toml';
    case 'ini':
      return 'ini';
    case 'dockerfile':
      return 'dockerfile';
    case 'bat':
    case 'cmd':
      return 'bat';
    case 'ps1':
      return 'powershell';
    default:
      return 'plaintext';
  }
}

function defineDarkPlusTheme(monaco: Monaco) {
  if ((monaco as any).__carogentDarkPlusThemeDefined) {
    return;
  }

  (monaco as any).__carogentDarkPlusThemeDefined = true;

  monaco.editor.defineTheme(EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd4d4d4', background: '1e1e1e' },
      { token: 'comment', foreground: '6a9955' },
      { token: 'comment.content', foreground: '6a9955' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'keyword.declaration', foreground: '569cd6' },
      { token: 'keyword.control', foreground: 'c586c0' },
      { token: 'keyword.flow', foreground: 'c586c0' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'string.key.json', foreground: '9cdcfe' },
      { token: 'string.value.json', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'regexp', foreground: 'd16969' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'class', foreground: '4ec9b0' },
      { token: 'interface', foreground: '4ec9b0' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'identifier', foreground: '9cdcfe' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'variable.local', foreground: '9cdcfe' },
      { token: 'variable.parameter', foreground: '9cdcfe' },
      { token: 'operator', foreground: 'd4d4d4' },
      { token: 'delimiter', foreground: 'd4d4d4' },
      { token: 'delimiter.html', foreground: '808080' },
      { token: 'tag', foreground: '569cd6' },
      { token: 'tag.html', foreground: '569cd6' },
      { token: 'metatag', foreground: '569cd6' },
      { token: 'metatag.content.html', foreground: '9cdcfe' },
      { token: 'attribute.name', foreground: '9cdcfe' },
      { token: 'attribute.value', foreground: 'ce9178' }
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41',
      'editor.selectionHighlightBackground': '#add6ff26',
      'editorGutter.background': '#1e1e1e',
      'editorCursor.foreground': '#aeafad',
      'editorWhitespace.foreground': '#3b3a32',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#707070'
    } as any
  });
}

function isImagePath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
}

// Relative import path resolver
function resolveRelativePath(currentFilePath: string, relativeImportPath: string): string {
  const current = currentFilePath.replace(/\\/g, '/');
  const rel = relativeImportPath.replace(/\\/g, '/');

  const currentParts = current.split('/');
  currentParts.pop(); // Remove the file name to get the directory

  const relParts = rel.split('/');
  for (const part of relParts) {
    if (part === '.') {
      continue;
    } else if (part === '..') {
      currentParts.pop();
    } else {
      currentParts.push(part);
    }
  }
  return currentParts.join('/');
}

const extensions = ['.tsx', '.ts', '.d.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.d.ts', '/index.jsx', '/index.js'];

async function tryReadImportFile(resolvedBase: string): Promise<{ path: string; content: string } | null> {
  for (const ext of extensions) {
    const fullPath = resolvedBase + ext;
    try {
      const result = await window.terminalApi.readTextFile({ path: fullPath });
      if (result && typeof result.content === 'string') {
        return { path: result.path || fullPath, content: result.content };
      }
    } catch {
      // Ignore and check next extension
    }
  }
  return null;
}

function findDefinitionInContent(content: string, word: string): { lineNumber: number; columnNumber: number } | null {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find all import and re-export ranges to exclude false positives
  const ignoreRanges: { start: number; end: number }[] = [];
  const ignoreRegexes = [
    /import\s+[\s\S]*?from\s+['"][^'"]+['"]/g,
    /export\s+[\s\S]*?from\s+['"][^'"]+['"]/g
  ];
  for (const regex of ignoreRegexes) {
    let m;
    while ((m = regex.exec(content)) !== null) {
      ignoreRanges.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  const declarationPatterns = [
    // 1. Explicit declaration: const/let/var/function/class/interface/type/enum/abstract class word
    new RegExp(`\\b(const|let|var|function|class|interface|type|enum|abstract\\s+class)\\s+${escapedWord}\\b`, 'g'),
    
    // 2. Destructured variable in object: const { ..., word, ... }
    new RegExp(`\\b(const|let|var)\\s+\\{[^}]*?\\b${escapedWord}\\b`, 'g'),
    
    // 3. Destructured variable in array: const [ ..., word, ... ]
    new RegExp(`\\b(const|let|var)\\s+\\[[^\\]]*?\\b${escapedWord}\\b`, 'g'),
    
    // 4. Function name: function word(
    new RegExp(`\\bfunction\\s+${escapedWord}\\b`, 'g'),
    
    // 5. Function/arrow parameter list: (..., word, ...) => or (..., word) {
    new RegExp(`\\([^)]*?\\b${escapedWord}\\b[^)]*?\\)\\s*(=>|\\{)`, 'g'),
    
    // 6. Destructured parameter in function: ({ ..., word, ... })
    new RegExp(`\\(\\s*\\{[^}]*?\\b${escapedWord}\\b[^}]*?\\}\\s*\\)`, 'g'),
    
    // 7. Arrow function single param: word =>
    new RegExp(`\\b${escapedWord}\\s*=>`, 'g'),
    
    // 8. Class property/method: word = ... or word(...) {
    new RegExp(`\\b${escapedWord}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    
    // 9. Type/interface/object member: word: or word?:
    new RegExp(`\\b${escapedWord}\\s*\\??\\s*:`, 'g'),
    
    // 10. Property assignment: word = value (class property or fallback)
    new RegExp(`\\b${escapedWord}\\s*=`, 'g')
  ];

  for (const pattern of declarationPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const matchText = match[0];
      const wordRegex = new RegExp(`\\b${escapedWord}\\b`);
      const wordMatch = matchText.match(wordRegex);
      const wordOffset = wordMatch && wordMatch.index !== undefined ? wordMatch.index : 0;
      const wordAbsoluteIndex = match.index + wordOffset;

      // Check if this match index falls within ignored import/export ranges
      const isIgnored = ignoreRanges.some(
        (r) => wordAbsoluteIndex >= r.start && wordAbsoluteIndex <= r.end
      );
      if (isIgnored) {
        continue;
      }

      // Convert absolute index to line and column numbers
      const textBeforeWord = content.substring(0, wordAbsoluteIndex);
      const linesBefore = textBeforeWord.split('\n');
      const lineNumber = linesBefore.length;
      const columnNumber = linesBefore[linesBefore.length - 1].length + 1;
      return { lineNumber, columnNumber };
    }
  }

  return null;
}

// Recursively tracks named exports or defaults
function findReExportPath(content: string, word: string): string | null {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reExportRegex = /export\s+((?:(?!export)[\s\S])*?)\s+from\s+['"]([^'"]+)['"]/g;

  let match;
  while ((match = reExportRegex.exec(content)) !== null) {
    const exportClause = match[1];
    const exportPath = match[2];

    const wordRegex = new RegExp(`\\b${escapedWord}\\b`);
    if (wordRegex.test(exportClause)) {
      return exportPath;
    }
  }
  return null;
}

async function resolveAliasPath(importPath: string, rootPath: string): Promise<string[]> {
  const aliasPrefixes = ['@/', '~/'];
  let matchedPrefix = aliasPrefixes.find(p => importPath.startsWith(p));
  if (!matchedPrefix) {
    return [];
  }

  const subPath = importPath.slice(matchedPrefix.length);

  try {
    for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = rootPath.replace(/\\/g, '/') + '/' + configFile;
      try {
        const result = await window.terminalApi.readTextFile({ path: configPath });
        if (result && result.content) {
          const cleanJson = result.content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
          const config = JSON.parse(cleanJson);
          const paths = config.compilerOptions?.paths;
          if (paths) {
            const key = matchedPrefix + '*';
            const targets = paths[key];
            if (Array.isArray(targets) && targets.length > 0) {
              const candidates: string[] = [];
              for (let target of targets) {
                if (target.endsWith('*')) {
                  target = target.slice(0, -1);
                }
                if (target.startsWith('./')) {
                  target = target.slice(2);
                }
                candidates.push(rootPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + target.replace(/\/+$/, '') + '/' + subPath);
              }
              return candidates;
            }
          }
        }
      } catch (e) {
        // Try next config file
      }
    }
  } catch (e) {
    // Ignore
  }

  const srcPath = rootPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/src/' + subPath;
  const directPath = rootPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + subPath;
  return [srcPath, directPath];
}

function getImportPathAtColumn(lineText: string, column: number): { path: string; startColumn: number; endColumn: number } | null {
  const regex = /['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    const startIdx = match.index;
    const endIdx = match.index + match[0].length;
    const clickIdx = column - 1;
    if (clickIdx >= startIdx && clickIdx < endIdx) {
      const pathValue = match[1];
      const beforeString = lineText.substring(0, match.index).trim();
      if (
        beforeString.endsWith('from') ||
        beforeString.startsWith('import') ||
        beforeString.startsWith('export')
      ) {
        return {
          path: pathValue,
          startColumn: startIdx + 1,
          endColumn: endIdx + 1
        };
      }
    }
  }
  return null;
}

function findImportPath(content: string, word: string): string | null {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importRegex = /import\s+((?:(?!import)[\s\S])*?)\s+from\s+['"]([^'"]+)['"]/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importClause = match[1];
    const importPath = match[2];

    const wordRegex = new RegExp(`\\b${escapedWord}\\b`);
    if (wordRegex.test(importClause)) {
      return importPath;
    }
  }
  return null;
}

async function resolveDefinition(
  currentFilePath: string,
  currentFileContent: string,
  word: string,
  namespace?: string | null,
  rootPath?: string
): Promise<{
  path: string;
  lineNumber: number;
  columnNumber: number;
  wordLength: number;
  contentSnippet: string;
  originSelectionRange?: { startColumn: number; endColumn: number };
} | null> {
  // CSS variable resolution
  if (word.startsWith('--')) {
    const lines = currentFileContent.split('\n');
    const escapedVar = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const varRegex = new RegExp(`^\\s*${escapedVar}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (varRegex.test(lines[i])) {
        return {
          path: currentFilePath,
          lineNumber: i + 1,
          columnNumber: lines[i].indexOf(word) + 1 || 1,
          wordLength: word.length,
          contentSnippet: lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join('\n')
        };
      }
    }
    return null;
  }

  const wordLength = word.length;

  // If there's a namespace (e.g. layout.splitPane -> namespace is 'layout', word is 'splitPane')
  if (namespace) {
    const importPath = findImportPath(currentFileContent, namespace);
    if (importPath) {
      let resolvedBases: string[] = [];
      if (importPath.startsWith('.')) {
        resolvedBases = [resolveRelativePath(currentFilePath, importPath)];
      } else if (rootPath && (importPath.startsWith('@/') || importPath.startsWith('~/'))) {
        resolvedBases = await resolveAliasPath(importPath, rootPath);
      }

      for (const resolvedBase of resolvedBases) {
        let targetFile = await tryReadImportFile(resolvedBase);

        let depth = 0;
        while (targetFile && depth < 5) {
          const targetDef = findDefinitionInContent(targetFile.content, word);
          if (targetDef) {
            const lines = targetFile.content.split('\n');
            const startLine = Math.max(0, targetDef.lineNumber - 3);
            const endLine = Math.min(lines.length, targetDef.lineNumber + 3);
            return {
              path: targetFile.path,
              lineNumber: targetDef.lineNumber,
              columnNumber: targetDef.columnNumber,
              wordLength,
              contentSnippet: lines.slice(startLine, endLine).join('\n')
            };
          }

          const nestedImport = findReExportPath(targetFile.content, word);
          let nestedBases: string[] = [];
          if (nestedImport) {
            if (nestedImport.startsWith('.')) {
              nestedBases = [resolveRelativePath(targetFile.path, nestedImport)];
            } else if (rootPath && (nestedImport.startsWith('@/') || nestedImport.startsWith('~/'))) {
              nestedBases = await resolveAliasPath(nestedImport, rootPath);
            }
          }

          let nextTargetFile = null;
          for (const nestedBase of nestedBases) {
            nextTargetFile = await tryReadImportFile(nestedBase);
            if (nextTargetFile) {
              break;
            }
          }

          if (nextTargetFile) {
            targetFile = nextTargetFile;
            depth++;
          } else {
            break;
          }
        }
      }
    }
  }

  // 1. Imports
  const importPath = findImportPath(currentFileContent, word);
  if (importPath) {
    let resolvedBases: string[] = [];
    if (importPath.startsWith('.')) {
      resolvedBases = [resolveRelativePath(currentFilePath, importPath)];
    } else if (rootPath && (importPath.startsWith('@/') || importPath.startsWith('~/'))) {
      resolvedBases = await resolveAliasPath(importPath, rootPath);
    }

    for (const resolvedBase of resolvedBases) {
      let targetFile = await tryReadImportFile(resolvedBase);

      let depth = 0;
      while (targetFile && depth < 5) {
        const targetDef = findDefinitionInContent(targetFile.content, word);
        if (targetDef) {
          const lines = targetFile.content.split('\n');
          const startLine = Math.max(0, targetDef.lineNumber - 3);
          const endLine = Math.min(lines.length, targetDef.lineNumber + 3);
          return {
            path: targetFile.path,
            lineNumber: targetDef.lineNumber,
            columnNumber: targetDef.columnNumber,
            wordLength,
            contentSnippet: lines.slice(startLine, endLine).join('\n')
          };
        }

        const nestedImport = findReExportPath(targetFile.content, word);
        let nestedBases: string[] = [];
        if (nestedImport) {
          if (nestedImport.startsWith('.')) {
            nestedBases = [resolveRelativePath(targetFile.path, nestedImport)];
          } else if (rootPath && (nestedImport.startsWith('@/') || nestedImport.startsWith('~/'))) {
            nestedBases = await resolveAliasPath(nestedImport, rootPath);
          }
        }

        let nextTargetFile = null;
        for (const nestedBase of nestedBases) {
          nextTargetFile = await tryReadImportFile(nestedBase);
          if (nextTargetFile) {
            break;
          }
        }

        if (nextTargetFile) {
          targetFile = nextTargetFile;
          depth++;
        } else {
          break;
        }
      }
    }
  }

  // 2. Local definition
  const localDef = findDefinitionInContent(currentFileContent, word);
  if (localDef) {
    const lines = currentFileContent.split('\n');
    const startLine = Math.max(0, localDef.lineNumber - 3);
    const endLine = Math.min(lines.length, localDef.lineNumber + 3);
    return {
      path: currentFilePath,
      lineNumber: localDef.lineNumber,
      columnNumber: localDef.columnNumber,
      wordLength,
      contentSnippet: lines.slice(startLine, endLine).join('\n')
    };
  }

  return null;
}

export function FileEditorWorkspace({
  activeFilePath,
  activeLineNumber,
  activeColumnNumber,
  rootPath,
  onActiveFileChange,
  onActiveFilePathChange,
  globalSearchQuery = '',
  globalSearchCaseSensitive = false,
  globalSearchWholeWord = false,
  globalSearchUseRegex = false,
  onClose
}: FileEditorWorkspaceProps): JSX.Element {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const tabsRef = useRef<EditorTab[]>([]);
  const selectedPathRef = useRef('');
  const [diffMode, setDiffMode] = useState<'side-by-side' | 'inline'>('side-by-side');
  const [activeDiff, setActiveDiff] = useState<EditorTab | null>(null);

  const editorRef = useRef<any>(null);
  const diffEditorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const pendingNavigationRef = useRef<{
    path: string;
    line: number;
    column: number;
    wordLength: number;
  } | null>(null);

  const applyNavigation = useCallback((editor: any, pending: { path: string; line: number; column: number; wordLength: number }) => {
    const model = editor.getModel();
    if (model) {
      const modelUriPath = model.uri.path;
      if (normalizePath(modelUriPath) === normalizePath(pending.path)) {
        if (pending.line > 1 && model.getLineCount() < pending.line) {
          return false;
        }

        const apply = () => {
          if (pending.wordLength > 0) {
            editor.setSelection({
              startLineNumber: pending.line,
              startColumn: pending.column,
              endLineNumber: pending.line,
              endColumn: pending.column + pending.wordLength
            });
            editor.revealRangeInCenter({
              startLineNumber: pending.line,
              startColumn: pending.column,
              endLineNumber: pending.line,
              endColumn: pending.column + pending.wordLength
            });
          } else {
            editor.setPosition({ lineNumber: pending.line, column: pending.column });
            editor.revealPositionInCenter({ lineNumber: pending.line, column: pending.column });
          }
          editor.focus();
        };

        // Apply immediately
        apply();

        // Schedule multiple staggered applies to override any asynchronous Monaco model/layout resets
        const delays = [25, 75, 150, 300, 600, 1000];
        delays.forEach((delay) => {
          setTimeout(() => {
            const currentModel = editor.getModel();
            if (currentModel && normalizePath(currentModel.uri.path) === normalizePath(pending.path)) {
              apply();
            }
          }, delay);
        });

        return true;
      }
    }
    return false;
  }, []);

  const checkAndApplyNavigation = useCallback((editor: any, pending: any) => {
    if (!editor || !pending) return;

    let attempts = 0;
    const maxAttempts = 50;

    const run = () => {
      const currentPending = pendingNavigationRef.current;
      if (!currentPending) {
        return;
      }

      if (normalizePath(currentPending.path) !== normalizePath(pending.path) || normalizePath(currentPending.path) !== normalizePath(selectedPathRef.current)) {
        return;
      }

      const applied = applyNavigation(editor, currentPending);
      if (applied) {
        pendingNavigationRef.current = null;
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(run, 50);
      }
    };

    setTimeout(run, 0);
  }, [applyNavigation]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
  }, [selectedPath]);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    if (onActiveFilePathChange) {
      onActiveFilePathChange(selectedPath);
    }
  }, [selectedPath, onActiveFilePathChange]);

  useEffect(() => {
    return () => {
      editorRef.current = null;
      diffEditorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const loadFile = useCallback((path: string, forceReload = false): void => {
    const nextPath = path.trim();

    if (!nextPath) {
      return;
    }

    setSelectedPath(nextPath);
    selectedPathRef.current = nextPath; // sync update so handleEditorDidMount sees the correct path
    const existingTab = tabsRef.current.find((tab) => tab.path === nextPath);

    if (existingTab && !forceReload && !existingTab.error) {
      return;
    }

    const isDiff = nextPath.startsWith('gitdiff://');

    if (isDiff) {
      let displayName = 'Diff View';
      try {
        const { filePath } = parseGitDiffUrl(nextPath);
        displayName = getFileName(filePath);
      } catch {}

      setActiveDiff({
        path: nextPath,
        name: displayName,
        content: '',
        savedContent: '',
        loading: true,
        saving: false,
        isDiff: true,
        originalContent: '',
        modifiedContent: ''
      });

      const fetchDiffData = async () => {
        const { filePath, searchParams } = parseGitDiffUrl(nextPath);
        const source = searchParams.get('source') as 'workingTree' | 'index' | 'head' | 'commit' || 'workingTree';
        const ref = searchParams.get('ref') || undefined;

        let originalSource: 'workingTree' | 'index' | 'head' | 'commit' = 'index';
        let originalRef: string | undefined = undefined;
        let modifiedSource: 'workingTree' | 'index' | 'head' | 'commit' = source;
        let modifiedRef: string | undefined = ref;

        if (source === 'workingTree') {
          originalSource = 'index';
        } else if (source === 'index') {
          originalSource = 'head';
        } else if (source === 'commit' && ref) {
          originalSource = 'commit';
          originalRef = `${ref}^`;
        }

        // Fetch original content
        let originalContent = '';
        try {
          const res = await window.terminalApi.gitFileContents({
            cwd: rootPath,
            filePath,
            source: originalSource,
            ref: originalRef
          });
          if (res && !res.error && res.content !== undefined) {
            originalContent = res.content;
          }
        } catch (e) {
          console.warn('Failed to load original file contents for diff, defaulting to empty string:', e);
        }

        // Fetch modified content
        let modifiedContent = '';
        const resMod = await window.terminalApi.gitFileContents({
          cwd: rootPath,
          filePath,
          source: modifiedSource,
          ref: modifiedRef
        });
        if (resMod.error) {
          throw new Error(resMod.error);
        }
        if (resMod.content !== undefined) {
          modifiedContent = resMod.content;
        }

        return { originalContent, modifiedContent };
      };

      const timeoutPromise = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('Git diff load timed out (10s).')), 10000)
      );

      Promise.race([fetchDiffData(), timeoutPromise])
        .then(({ originalContent, modifiedContent }) => {
          setActiveDiff({
            path: nextPath,
            name: displayName,
            content: modifiedContent,
            savedContent: modifiedContent,
            originalContent,
            modifiedContent,
            loading: false,
            saving: false,
            isDiff: true
          });
        })
        .catch((error: unknown) => {
          setActiveDiff({
            path: nextPath,
            name: displayName,
            content: '',
            savedContent: '',
            loading: false,
            saving: false,
            isDiff: true,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return;
    }

    setActiveDiff(null);

    setTabs((current) => {
      if (current.some((tab) => tab.path === nextPath)) {
        return current.map((tab) => (tab.path === nextPath ? { ...tab, loading: true, error: undefined } : tab));
      }

      return [
        ...current,
        {
          path: nextPath,
          name: getFileName(nextPath),
          content: '',
          savedContent: '',
          loading: true,
          saving: false
        }
      ];
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('File load timed out (10s). File may be too large or inaccessible.')), 10000)
    );

    const isImage = isImagePath(nextPath);

    const loadPromise = isImage
      ? window.terminalApi.getImagePreview({ path: nextPath }).then((result) => ({
          path: nextPath,
          content: result.dataUrl,
          savedContent: result.dataUrl,
          modifiedAt: Date.now()
        }))
      : window.terminalApi.readTextFile({ path: nextPath });

    Promise.race([loadPromise, timeoutPromise])
      .then((result) => {
        if (monacoRef.current && !isImage) {
          const uri = monacoRef.current.Uri.file(result.path);
          const model = monacoRef.current.editor.getModel(uri);
          if (model) {
            model.setValue(result.content);
          }
        }
        setTabs((current) =>
          current.map((tab) =>
            tab.path === nextPath
              ? {
                  ...tab,
                  path: result.path,
                  name: getFileName(result.path),
                  content: result.content,
                  savedContent: result.content,
                  modifiedAt: result.modifiedAt,
                  loading: false,
                  error: undefined,
                  isImage: isImage
                }
              : tab
          )
        );
        setSelectedPath(result.path);
      })
      .catch((error: unknown) => {
        setTabs((current) =>
          current.map((tab) =>
            tab.path === nextPath
              ? {
                  ...tab,
                  loading: false,
                  error: error instanceof Error ? error.message : String(error)
                }
              : tab
          )
        );
      });
  }, [rootPath]);

  useEffect(() => {
    if (activeFilePath) {
      loadFile(activeFilePath);
    }
  }, [activeFilePath, loadFile]);

  const isDiffView = activeFilePath.startsWith('gitdiff://');
  const selectedTab = isDiffView
    ? activeDiff
    : tabs.find((tab) => tab.path === selectedPath) || null;

  // Handle pending navigation to definitions once the file has loaded
  useEffect(() => {
    if (selectedTab && !selectedTab.loading && pendingNavigationRef.current) {
      checkAndApplyNavigation(editorRef.current, pendingNavigationRef.current);
    }
  }, [selectedTab, selectedTab?.loading, selectedPath, applyNavigation, checkAndApplyNavigation]);

  const saveFile = useCallback((path = selectedPath): void => {
    const tab = tabs.find((item) => item.path === path);

    if (!tab || tab.loading || tab.saving) {
      return;
    }

    setTabs((current) =>
      current.map((item) => (item.path === path ? { ...item, saving: true, error: undefined } : item))
    );

    window.terminalApi
      .writeTextFile({ path, content: tab.content })
      .then((result) => {
        setTabs((current) =>
          current.map((item) =>
            item.path === path
              ? {
                  ...item,
                  savedContent: item.content,
                  modifiedAt: result.modifiedAt,
                  saving: false,
                  error: undefined
                }
              : item
          )
        );
      })
      .catch((error: unknown) => {
        setTabs((current) =>
          current.map((item) =>
            item.path === path
              ? {
                  ...item,
                  saving: false,
                  error: error instanceof Error ? error.message : String(error)
                }
              : item
          )
        );
      });
  }, [selectedPath, tabs]);

  const closeTab = (path: string): void => {
    const closedIndex = tabs.findIndex((tab) => tab.path === path);
    const nextTabs = tabs.filter((tab) => tab.path !== path);

    setTabs(nextTabs);

    if (selectedPath === path) {
      const nextSelected = nextTabs[Math.max(0, closedIndex - 1)] || nextTabs[0];
      setSelectedPath(nextSelected?.path || '');
      if (nextSelected?.path) {
        onActiveFileChange?.(nextSelected.path);
      }
    }

    if (nextTabs.length === 0) {
      onClose?.();
    }

    // Delay model disposal to the next tick so the editor can switch away from it first
    setTimeout(() => {
      if (monacoRef.current) {
        const uri = monacoRef.current.Uri.file(path);
        const model = monacoRef.current.editor.getModel(uri);
        // Only dispose if it's not the currently active model in the editor
        if (model && (!editorRef.current || editorRef.current.getModel() !== model)) {
          model.dispose();
        }
      }
    }, 0);
  };

  const updateSelectedContent = useCallback((content: string): void => {
    const path = selectedPathRef.current;
    if (!path) {
      return;
    }

    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, content } : tab)));
  }, []);



  const handleNavigateToDefinition = useCallback((targetPath: string, line: number, column = 1, wordLength = 0) => {
    const normalizedPath = targetPath.replace(/^\/([a-zA-Z]:)/, '$1');

    pendingNavigationRef.current = { path: normalizedPath, line, column, wordLength };
    loadFile(normalizedPath);
    setSelectedPath(normalizedPath);
    onActiveFileChange?.(normalizedPath);

    let attempts = 0;
    const checkAndApply = () => {
      if (!pendingNavigationRef.current) return;

      const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
      if (normalize(pendingNavigationRef.current.path) !== normalize(normalizedPath)) {
        return;
      }

      if (editorRef.current) {
        const applied = applyNavigation(editorRef.current, pendingNavigationRef.current);
        if (applied) {
          pendingNavigationRef.current = null;
          return;
        }
      }

      attempts++;
      if (attempts < 20 && pendingNavigationRef.current) {
        setTimeout(checkAndApply, 50);
      }
    };

    setTimeout(checkAndApply, 0);
  }, [loadFile, onActiveFileChange, applyNavigation]);

  const registerMonacoProviders = (monaco: Monaco) => {
    if ((monaco as any).__providersRegistered) {
      return;
    }
    (monaco as any).__providersRegistered = true;

    const resolveDef = async (model: any, position: any) => {
      const lineText = model.getLineContent(position.lineNumber);

      const importPathAtClick = getImportPathAtColumn(lineText, position.column);
      if (importPathAtClick) {
        let resolvedBases: string[] = [];
        if (importPathAtClick.path.startsWith('.')) {
          const filePath = model.uri.path;
          resolvedBases = [resolveRelativePath(filePath, importPathAtClick.path)];
        } else if (rootPath && (importPathAtClick.path.startsWith('@/') || importPathAtClick.path.startsWith('~/'))) {
          resolvedBases = await resolveAliasPath(importPathAtClick.path, rootPath);
        }

        for (const resolvedBase of resolvedBases) {
          const targetFile = await tryReadImportFile(resolvedBase);
          if (targetFile) {
            return {
              path: targetFile.path,
              lineNumber: 1,
              columnNumber: 1,
              wordLength: importPathAtClick.path.length,
              contentSnippet: targetFile.content.split('\n').slice(0, 5).join('\n'),
              originSelectionRange: {
                startColumn: importPathAtClick.startColumn,
                endColumn: importPathAtClick.endColumn
              }
            };
          }
        }
      }

      let wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;
      let word = wordInfo.word;
      if (model.getLanguageId() === 'css' || model.getLanguageId() === 'scss') {
        const hoverIndex = position.column - 1;
        const beforeWord = lineText.substring(0, hoverIndex + word.length);
        const match = beforeWord.match(/--[a-zA-Z0-9_-]*$/);
        if (match) {
          word = match[0];
        }
      }

      const filePath = model.uri.path;
      const fileContent = model.getValue();

      // Extract namespace if word is preceded by an identifier and a dot (e.g. layout.splitPane)
      const beforeWord = lineText.substring(0, position.column - 1);
      const nsMatch = beforeWord.match(/\b([a-zA-Z0-9_$]+)\s*\.\s*$/);
      const namespace = nsMatch ? nsMatch[1] : null;

      return await resolveDefinition(filePath, fileContent, word, namespace, rootPath);
    };

    const languages = ['typescript', 'javascript', 'css'];
    languages.forEach((lang) => {
      monaco.languages.registerDefinitionProvider(lang, {
        async provideDefinition(model: any, position: any) {
          const def = await resolveDef(model, position);
          if (!def) return null;

          const targetUri = monaco.Uri.file(def.path);
          const targetRange = new monaco.Range(
            def.lineNumber,
            def.columnNumber || 1,
            def.lineNumber,
            (def.columnNumber || 1) + (def.wordLength || 0)
          );

          if (def.originSelectionRange) {
            return [
              {
                uri: targetUri,
                range: targetRange,
                originSelectionRange: new monaco.Range(
                  position.lineNumber,
                  def.originSelectionRange.startColumn,
                  position.lineNumber,
                  def.originSelectionRange.endColumn
                )
              }
            ] as any;
          }

          return {
            uri: targetUri,
            range: targetRange
          };
        }
      });

      monaco.languages.registerHoverProvider(lang, {
        async provideHover(model: any, position: any) {
          const def = await resolveDef(model, position);
          if (!def) return null;

          const relativePathLabel = def.path.split(/[\\/]/).pop() || def.path;

          return {
            contents: [
              { value: `**Definition** (${relativePathLabel}:line ${def.lineNumber})` },
              { value: '```' + lang + '\n' + def.contentSnippet + '\n```' }
            ]
          };
        }
      });
    });
  };

  const updateSearchDecorations = useCallback(() => {
    if (!editorRef.current || !monacoRef.current || !selectedTab) return;
    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    if (!globalSearchQuery) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      return;
    }

    try {
      const matches = model.findMatches(
        globalSearchQuery,
        false,
        globalSearchUseRegex,
        globalSearchWholeWord,
        globalSearchCaseSensitive ? null : false,
        true
      );

      const newDecorations = matches.map((match: any) => ({
        range: match.range,
        options: {
          inlineClassName: 'global-search-match-highlight'
        }
      }));

      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    } catch (e) {
      // Ignore invalid regex search queries while typing
    }
  }, [globalSearchQuery, globalSearchCaseSensitive, globalSearchWholeWord, globalSearchUseRegex, selectedTab]);

  const initializeMonaco = (monaco: Monaco) => {
    defineDarkPlusTheme(monaco);

    if ((monaco as any).__initialized) {
      return;
    }
    (monaco as any).__initialized = true;

    // Disable semantic validation (type and module resolution checks) to prevent import errors
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false
    });

    // Disable built-in definition and hover providers to avoid duplicate popups (e.g. "Click to show 2 definitions")
    monaco.languages.typescript.typescriptDefaults.setModeConfiguration({
      definitions: false,
      hovers: false
    });
    monaco.languages.typescript.javascriptDefaults.setModeConfiguration({
      definitions: false,
      hovers: false
    });
    if (monaco.languages.css && monaco.languages.css.cssDefaults) {
      monaco.languages.css.cssDefaults.setModeConfiguration({
        definitions: false,
        hovers: false
      });
    }

    registerMonacoProviders(monaco);

    // Custom tokenizer enhancements to match VS Code default theme behavior
    const customizeLanguage = (langId: string) => {
      console.log(`[Monaco Customizer] Customizing language: ${langId}`);
      const langs = monaco.languages.getLanguages();
      const lang = langs.find((l: any) => l.id === langId);
      
      const applyCustomization = (mod: any) => {
        if (!mod) return;
        const language = mod.language || mod;
        if (!language || !language.tokenizer) {
          console.warn(`[Monaco Customizer] No language/tokenizer definition found for ${langId}`);
          return;
        }

        const primitiveTypes = ['string', 'number', 'boolean', 'any', 'void', 'unknown', 'never', 'object'];
        const controlKeywords = [
          'break', 'case', 'catch', 'continue', 'debugger', 'default', 'do', 'else', 
          'finally', 'for', 'if', 'in', 'instanceof', 'return', 'switch', 'throw', 
          'try', 'while', 'with', 'yield', 'export', 'import', 'from', 'as',
          'new', 'async', 'await'
        ];
        const declarationKeywords = ['interface', 'type', 'implements', 'extends', 'function', 'const', 'let', 'var'];

        if (language.keywords) {
          language.keywords = language.keywords.filter(
            (k: string) => !primitiveTypes.includes(k) && !controlKeywords.includes(k) && !declarationKeywords.includes(k)
          );
        }

        if (language.tokenizer && language.tokenizer.root) {
          const primRegex = new RegExp(`\\b(${primitiveTypes.join('|')})\\b`);
          const controlRegex = new RegExp(`\\b(${controlKeywords.join('|')})\\b`);
          const declarationRegex = new RegExp(`\\b(${declarationKeywords.join('|')})\\b`);

          language.tokenizer.root.unshift(
            [primRegex, 'type'],
            [controlRegex, 'keyword.control'],
            [/\b(const|let|var)(\s+)([a-zA-Z_$][\w$]*)/, ['keyword.declaration', '', 'variable.local']],
            [/([{\[,]\s*)([a-zA-Z_$][\w$]*)(?=\s*[,}\]])/, ['', 'variable.local']],
            [/^(\s*)([a-zA-Z_$][\w$]*)(?=\s*,)/, ['', 'variable.local']],
            [declarationRegex, 'keyword.declaration'],
            [/\b(interface|type)\s+([a-zA-Z_$][\w$]*)/, ['keyword.declaration', 'type']],
            [/\b(extends|implements)\s+([a-zA-Z_$][\w$]*)/, ['keyword.declaration', 'type']],
            [/\b([a-zA-Z_$][\w$]*)\s*(?=\s*=\s*(?:[a-zA-Z_$][\w$]*|\([^)]*\))\s*=>)/, 'function'],
            [/(\.)([a-zA-Z_$][\w$]*)\s*<[^>]*>\s*(?=\()/, ['delimiter', 'function']],
            [/(\.)([a-zA-Z_$][\w$]*)\s*(?=\()/, ['delimiter', 'function']],
            [/(\.)([a-zA-Z_$][\w$]*)/, ['delimiter', 'identifier']],
            [/\b([a-zA-Z_$][\w$]*)\s*<[^>]*>\s*(?=\()/, 'function'],
            [/\b([a-zA-Z_$][\w$]*)\s*(?=\()/, 'function']
          );

          monaco.languages.setMonarchTokensProvider(langId, language);
          console.log(`[Monaco Customizer] Successfully updated tokenizer for ${langId}`);
          
          const models = monaco.editor.getModels();
          for (const model of models) {
            const modelLang = model.getLanguageId();
            if (modelLang === langId) {
              monaco.editor.setModelLanguage(model, 'plaintext');
              monaco.editor.setModelLanguage(model, langId);
            }
          }
        }
      };

      if (lang && lang.loader) {
        lang.loader().then(applyCustomization).catch((err: any) => console.error(err));
      } else {
        const amdRequire = (window as any).require;
        if (amdRequire) {
          const modulePath = `vs/basic-languages/${langId}/${langId}`;
          try {
            amdRequire([modulePath], (mod: any) => {
              console.log(`[Monaco Customizer] AMD load resolved for ${langId}`);
              applyCustomization(mod);
            }, (err: any) => {
              console.error(`[Monaco Customizer] AMD load failed for ${langId}:`, err);
            });
          } catch (err) {
            console.error(`[Monaco Customizer] AMD require call failed for ${langId}:`, err);
          }
        } else {
          console.warn(`[Monaco Customizer] No loader or AMD require found for ${langId}`);
        }
      }
    };

    customizeLanguage('typescript');
    customizeLanguage('javascript');
  };

  const handleDiffEditorDidMount = (editor: any, monaco: Monaco) => {
    diffEditorRef.current = editor;
    monacoRef.current = monaco;
    initializeMonaco(monaco);
    monaco.editor.setTheme(EDITOR_THEME);
  };

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    initializeMonaco(monaco);
    monaco.editor.setTheme(EDITOR_THEME);

    const editorService = editor._codeEditorService;
    if (editorService) {
      const originalOpenEditor = editorService.openCodeEditor.bind(editorService);
      editorService.openCodeEditor = async (input: any, source: any, sideBySide: any) => {
        const result = await originalOpenEditor(input, source, sideBySide);
        if (!result && input && input.resource) {
          const targetPath = input.resource.path;
          const selection = input.options ? input.options.selection : null;
          const line = selection ? selection.startLineNumber : 1;
          const column = selection ? selection.startColumn : 1;
          const endColumn = selection ? selection.endColumn : 1;
          const wordLength = endColumn - column;

          handleNavigateToDefinition(targetPath, line, column, wordLength);
          return true;
        }
        return result;
      };
    }

    editor.onDidChangeModel(() => {
      if (pendingNavigationRef.current) {
        checkAndApplyNavigation(editor, pendingNavigationRef.current);
      }
    });

    if (pendingNavigationRef.current) {
      checkAndApplyNavigation(editor, pendingNavigationRef.current);
    }

    // Apply search decorations immediately on mount
    updateSearchDecorations();
  };
  useEffect(() => {
    decorationsRef.current = [];
  }, [selectedPath]);

  // Handle activeLineNumber and activeColumnNumber changes with retry polling to handle tab loading/mounting races
  useEffect(() => {
    if (activeLineNumber && activeLineNumber > 0) {
      const column = activeColumnNumber && activeColumnNumber > 0 ? activeColumnNumber : 1;
      // Use activeFilePath (not selectedPath) because selectedPath may still be the old
      // gitdiff:// URL when switching from diff view to a real file
      const targetPath = activeFilePath.startsWith('gitdiff://')
        ? parseGitDiffUrl(activeFilePath).filePath
        : activeFilePath;
      pendingNavigationRef.current = {
        path: targetPath,
        line: activeLineNumber,
        column,
        wordLength: 0
      };
      checkAndApplyNavigation(editorRef.current, pendingNavigationRef.current);
    }
  }, [activeLineNumber, activeColumnNumber, activeFilePath, selectedPath, checkAndApplyNavigation]);

  // Handle global search highlight decorations
  useEffect(() => {
    updateSearchDecorations();
  }, [updateSearchDecorations]);

  // Handle shortcuts: Ctrl/Cmd+S saving, Ctrl/Cmd+X close tab, Ctrl/Cmd+J navigate to file line from diff
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveFile();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        if (selectedPath && selectedPath.startsWith('gitdiff://')) {
          e.preventDefault();
          e.stopPropagation();
          
          const diffEditor = diffEditorRef.current;
          if (diffEditor) {
            const modifiedEditor = diffEditor.getModifiedEditor();
            const originalEditor = diffEditor.getOriginalEditor();
            
            let activeEditor = modifiedEditor;
            if (originalEditor.hasTextFocus()) {
              activeEditor = originalEditor;
            } else if (modifiedEditor.hasTextFocus()) {
              activeEditor = modifiedEditor;
            } else {
              activeEditor = modifiedEditor.getPosition() ? modifiedEditor : originalEditor;
            }

            const position = activeEditor.getPosition();
            if (position) {
              const line = position.lineNumber;
              const column = position.column;
              
              const { filePath } = parseGitDiffUrl(selectedPath);
              if (filePath) {
                pendingNavigationRef.current = {
                  path: filePath,
                  line,
                  column,
                  wordLength: 0
                };
                loadFile(filePath);
                setSelectedPath(filePath);
                onActiveFileChange?.(filePath, line, column);
                checkAndApplyNavigation(editorRef.current, pendingNavigationRef.current);
              }
            }
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        const activeElement = document.activeElement;
        const isInput = activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement instanceof HTMLElement && activeElement.isContentEditable) ||
          activeElement.closest('.monaco-editor') ||
          activeElement.closest('.terminal-host') ||
          activeElement.closest('.xterm')
        );

        if (!isInput && selectedPath) {
          e.preventDefault();
          e.stopPropagation();
          closeTab(selectedPath);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [saveFile, selectedPath, closeTab, onActiveFileChange, loadFile, checkAndApplyNavigation]);

  // Listen for the Cmd/Ctrl+W shortcut from main process to close the active tab
  useEffect(() => {
    return window.terminalApi.onCloseTab(() => {
      if (selectedPath) {
        closeTab(selectedPath);
      }
    });
  }, [selectedPath, closeTab]);

  const hasDirtyTabs = tabs.some((tab) => tab.content !== tab.savedContent);

  return (
    <section className={`file-editor-workspace${isDiffView ? ' is-diff-view' : ''}`}>
      {!isDiffView && (
        <div className="file-editor-tabs">
          {onClose && (
            <button
              className="file-editor-close-btn"
              onClick={onClose}
              title="Close Editor"
              type="button"
            >
              <CloseIcon />
            </button>
          )}
          {tabs.map((tab) => {
            const dirty = tab.content !== tab.savedContent;

            return (
              <button
                key={tab.path}
                className={`file-editor-tab${tab.path === selectedPath ? ' is-active' : ''}${dirty ? ' is-dirty' : ''}`}
                type="button"
                title={tab.path}
                onClick={() => {
                  setSelectedPath(tab.path);
                  onActiveFileChange?.(tab.path);
                }}
              >
                <span className="file-editor-tab-name">{tab.name}{dirty ? ' *' : ''}</span>
                <span
                  className="file-editor-tab-close"
                  role="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.path);
                  }}
                >
                  <CloseIcon />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {(!isDiffView && !tabs.length) ? (
        <div className="file-editor-empty" style={{ gridRow: '2 / span 2' }}>
          <div className="file-editor-empty-title">Select a file</div>
          <div className="file-editor-empty-text">Choose a file from Explorer to edit it here.</div>
        </div>
      ) : selectedTab && (
        <>
          <div className="file-editor-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              {selectedTab.isDiff && (
                <button
                  className="file-editor-action"
                  type="button"
                  title="Close Diff Preview"
                  onClick={() => {
                    setActiveDiff(null);
                    if (tabs.length === 0) {
                      onClose?.();
                      onActiveFileChange?.('');
                    } else {
                      const lastTab = tabs[tabs.length - 1];
                      onActiveFileChange?.(lastTab.path);
                    }
                  }}
                  style={{
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center'
                  }}
                >
                  <CloseIcon />
                </button>
              )}
              <div className="file-editor-path" title={selectedTab.path}>
                {selectedTab.isDiff ? (
                  (() => {
                    try {
                      const { filePath, searchParams } = parseGitDiffUrl(selectedTab.path);
                      const relative = getRelativePath(filePath, rootPath);
                      const source = searchParams.get('source');
                      const ref = searchParams.get('ref');
                      let statusLabel = 'Working Tree';
                      if (source === 'index') {
                        statusLabel = 'Staged';
                      } else if (source === 'head') {
                        statusLabel = 'HEAD';
                      } else if (source === 'commit' && ref) {
                        statusLabel = `Commit ${ref.substring(0, 8)}`;
                      }
                      return `Diff: ${relative} (${statusLabel})`;
                    } catch {
                      return selectedTab.path;
                    }
                  })()
                ) : (
                  getRelativePath(selectedTab.path, rootPath)
                )}
              </div>
            </div>
            <div className="file-editor-actions">
              {selectedTab.isDiff && (
                <div className="diff-mode-toggle" style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
                  <button
                    className={`file-editor-diff-btn ${diffMode === 'side-by-side' ? 'is-active' : ''}`}
                    type="button"
                    title="Side by Side (Split View)"
                    onClick={() => setDiffMode('side-by-side')}
                  >
                    Side by Side
                  </button>
                  <button
                    className={`file-editor-diff-btn ${diffMode === 'inline' ? 'is-active' : ''}`}
                    type="button"
                    title="Single / Inline View"
                    onClick={() => setDiffMode('inline')}
                  >
                    Inline
                  </button>
                </div>
              )}
              {!selectedTab.isDiff && (
                <span className={`file-editor-save-state${hasDirtyTabs ? ' is-dirty' : ''}`}>
                  {selectedTab.saving
                    ? 'Saving...'
                    : selectedTab.content !== selectedTab.savedContent
                    ? 'Unsaved'
                    : selectedTab.modifiedAt
                    ? `Saved ${formatModifiedAt(selectedTab.modifiedAt)}`
                    : 'Saved'}
                </span>
              )}
              <button
                className="file-editor-action"
                type="button"
                title="Reload file"
                onClick={() => loadFile(selectedTab.path, true)}
                disabled={selectedTab.loading || selectedTab.saving}
              >
                <RefreshIcon className={selectedTab.loading ? 'spin' : ''} />
              </button>
              {!selectedTab.isDiff && (
                <button
                  className="file-editor-save-button"
                  type="button"
                  onClick={() => saveFile()}
                  disabled={selectedTab.loading || selectedTab.saving || selectedTab.isImage || selectedTab.content === selectedTab.savedContent}
                >
                  Save
                </button>
              )}
            </div>
          </div>
          {selectedTab.error && <div className="file-editor-error">{selectedTab.error}</div>}

          <div className="file-editor-surface" style={{ position: 'relative', height: 'calc(100% - 20px)', overflow: 'hidden' }}>
            {selectedTab.isImage ? (
              <div
                className="file-editor-image-preview"
                onWheel={(e) => {
                  const delta = e.deltaY;
                  setZoom((prev) => {
                    const factor = delta < 0 ? 1.15 : 0.85;
                    const next = prev * factor;
                    return Math.min(Math.max(next, 0.1), 20); // 10% to 2000%
                  });
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setIsDragging(true);
                  dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                }}
                onMouseMove={(e) => {
                  if (!isDragging) return;
                  setPan({
                    x: e.clientX - dragStartRef.current.x,
                    y: e.clientY - dragStartRef.current.y
                  });
                }}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
                onDoubleClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#1e1e1e',
                  backgroundImage:
                    'linear-gradient(45deg, #252526 25%, transparent 25%), linear-gradient(-45deg, #252526 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252526 75%), linear-gradient(-45deg, transparent 75%, #252526 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  overflow: 'hidden',
                  userSelect: 'none',
                  cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    maxWidth: '90%',
                    maxHeight: '90%',
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                  }}
                >
                  <img
                    src={selectedTab.content}
                    alt={selectedTab.name}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      pointerEvents: 'none'
                    }}
                  />
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: '15px',
                    right: '15px',
                    background: 'rgba(0,0,0,0.72)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    color: '#e2e8f0',
                    fontSize: '11px',
                    pointerEvents: 'none',
                    fontFamily: 'monospace'
                  }}
                >
                  {Math.round(zoom * 100)}%
                </div>
              </div>
            ) : selectedTab.isDiff ? (
              <DiffEditor
                height="100%"
                original={selectedTab.originalContent || ''}
                modified={selectedTab.modifiedContent || ''}
                language={getEditorLanguage(selectedTab.path)}
                theme={EDITOR_THEME}
                beforeMount={defineDarkPlusTheme}
                onMount={handleDiffEditorDidMount}
                options={{
                  renderSideBySide: diffMode === 'side-by-side',
                  minimap: { enabled: true },
                  fontSize: 13,
                  fontFamily: '"Cascadia Mono", Consolas, Menlo, Monaco, "Courier New", monospace',
                  lineHeight: 20,
                  wordWrap: 'off',
                  automaticLayout: true,
                  readOnly: true,
                  'semanticHighlighting.enabled': 'configuredByTheme',
                  'bracketPairColorization.enabled': true
                } as any}
              />
            ) : (
              <Editor
                height="100%"
                path={selectedTab.path}
                language={getEditorLanguage(selectedTab.path)}
                theme={EDITOR_THEME}
                value={selectedTab.content}
                onChange={(value) => updateSelectedContent(value || '')}
                beforeMount={defineDarkPlusTheme}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  fontFamily: '"Cascadia Mono", Consolas, Menlo, Monaco, "Courier New", monospace',
                  lineHeight: 20,
                  wordWrap: 'off',
                  automaticLayout: true,
                  'semanticHighlighting.enabled': 'configuredByTheme',
                  'bracketPairColorization.enabled': true,
                  scrollbar: {
                    vertical: 'visible',
                    horizontal: 'visible',
                    verticalScrollbarSize: 10,
                    horizontalScrollbarSize: 10
                  },
                  gotoLocation: {
                    multiple: 'goto',
                    multipleDefinitions: 'goto',
                    multipleReferences: 'goto',
                    multipleDeclarations: 'goto',
                    multipleImplementations: 'goto',
                    multipleTypeDefinitions: 'goto'
                  }
                } as any}
              />
            )}
            {selectedTab.loading && (
              <div className="file-editor-loading-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}>
                <div className="file-editor-loading-spinner" />
                <span>Loading file...</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
