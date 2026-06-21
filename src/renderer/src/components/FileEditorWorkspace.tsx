import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, memo } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ClipboardEvent as ReactClipboardEvent } from 'react';
import { CloseIcon, RefreshIcon } from './AppIcons';
import { highlightCodeLine } from '../git/syntaxHighlight';
import type { LocalMatchRange } from '../git/syntaxHighlight';
import 'prism-themes/themes/prism-vsc-dark-plus.css';


type EditorTab = {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  modifiedAt?: number;
  loading: boolean;
  saving: boolean;
  error?: string;
};

type HistoryEntry = {
  content: string;
  selectionStart: number;
  selectionEnd: number;
};

type FileEditorWorkspaceProps = {
  activeFilePath: string;
  activeLineNumber?: number;
  rootPath: string;
  onActiveFileChange?: (path: string) => void;
  onActiveFilePathChange?: (path: string) => void;
  globalSearchQuery?: string;
  globalSearchCaseSensitive?: boolean;
  globalSearchWholeWord?: boolean;
  globalSearchUseRegex?: boolean;
};

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getRelativePath(path: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '').toLowerCase();
  const normalizedPath = path.toLowerCase();

  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}\\`)) {
    return path.slice(rootPath.replace(/[\\/]+$/, '').length + 1);
  }

  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return path.slice(rootPath.replace(/[\\/]+$/, '').length + 1);
  }

  return path;
}

function formatModifiedAt(value?: number): string {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getSearchRegex(query: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): RegExp | null {
  if (!query) return null;
  try {
    let pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch (e) {
    return null;
  }
}

const CodeLine = memo(
  ({
    line,
    filePath,
    isActive,
    localMatchRanges
  }: {
    line: string;
    filePath: string;
    isActive: boolean;
    localMatchRanges?: LocalMatchRange[];
  }) => {
    return (
      <div className={`file-editor-line${isActive ? ' is-active-search-line' : ''}`}>
        {highlightCodeLine(line, filePath, localMatchRanges) || '\n'}
      </div>
    );
  }
);
CodeLine.displayName = 'CodeLine';

const EditorGutter = memo(
  ({
    lineCount,
    activeLineNumber,
    editorHeight
  }: {
    lineCount: number;
    activeLineNumber?: number;
    editorHeight: number;
  }) => {
    return (
      <div className="file-editor-gutter" style={{ minHeight: `${editorHeight}px` }}>
        {Array.from({ length: lineCount }, (_, index) => (
          <div
            key={index + 1}
            className={activeLineNumber === index + 1 ? 'is-active-search-line-gutter' : undefined}
          >
            {index + 1}
          </div>
        ))}
      </div>
    );
  }
);
EditorGutter.displayName = 'EditorGutter';

export function FileEditorWorkspace({
  activeFilePath,
  activeLineNumber,
  rootPath,
  onActiveFileChange,
  onActiveFilePathChange,
  globalSearchQuery = '',
  globalSearchCaseSensitive = false,
  globalSearchWholeWord = false,
  globalSearchUseRegex = false
}: FileEditorWorkspaceProps): JSX.Element {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const tabsRef = useRef<EditorTab[]>([]);
  const selectedPathRef = useRef('');

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    if (onActiveFilePathChange) {
      onActiveFilePathChange(selectedPath);
    }
  }, [selectedPath, onActiveFilePathChange]);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const isCopiedLineRef = useRef(false);
  const lastCopiedLineTextRef = useRef('');

  // Custom Undo/Redo History Stack
  const historyRef = useRef<Record<string, { past: HistoryEntry[]; future: HistoryEntry[] }>>({});
  const lastEditTimeRef = useRef(0);
  const lastActionTypeRef = useRef('');
  const lastSelectionRef = useRef({ start: 0, end: 0 });

  // Local Find states
  const [findActive, setFindActive] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findUseRegex, setFindUseRegex] = useState(false);
  const [activeFindIndex, setActiveFindIndex] = useState(0);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const loadFile = useCallback((path: string, forceReload = false): void => {
    const nextPath = path.trim();

    if (!nextPath) {
      return;
    }

    setSelectedPath(nextPath);
    const existingTab = tabsRef.current.find((tab) => tab.path === nextPath);

    if (existingTab && !forceReload && !existingTab.error) {
      return;
    }

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

    Promise.race([window.terminalApi.readTextFile({ path: nextPath }), timeoutPromise])
      .then((result) => {
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
                  error: undefined
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
  }, []);

  useEffect(() => {
    if (activeFilePath) {
      loadFile(activeFilePath);
    }
  }, [activeFilePath, loadFile]);

  // Scroll to activeLineNumber
  useEffect(() => {
    if (activeLineNumber && activeLineNumber > 0) {
      // Wait slightly for file rendering to complete
      const timer = window.setTimeout(() => {
        if (surfaceRef.current) {
          // 12px padding top in pre, 20px per line, offset by 80px for context visibility
          const targetScrollTop = 12 + (activeLineNumber - 1) * 20 - 80;
          surfaceRef.current.scrollTop = Math.max(0, targetScrollTop);
        }
      }, 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [activeLineNumber, selectedPath]);

  const selectedTab = tabs.find((tab) => tab.path === selectedPath) || null;
  const selectedLines = useMemo(() => {
    if (!selectedTab) {
      return [''];
    }

    return selectedTab.content.split('\n');
  }, [selectedTab?.content]);
  const deferredGlobalSearchQuery = useDeferredValue(globalSearchQuery);

  const localMatches = useMemo(() => {
    if (!selectedTab || !findQuery) return [];
    const regex = getSearchRegex(findQuery, findCaseSensitive, findWholeWord, findUseRegex);
    if (!regex) return [];

    const list: { lineIndex: number; charIndex: number; length: number }[] = [];
    selectedLines.forEach((line, lineIndex) => {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(line)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        list.push({
          lineIndex,
          charIndex: match.index,
          length: match[0].length
        });
      }
    });
    return list;
  }, [selectedLines, selectedTab, findQuery, findCaseSensitive, findWholeWord, findUseRegex]);

  const localFindRegexForLineHighlight = useMemo(() => {
    return getSearchRegex(findQuery, findCaseSensitive, findWholeWord, findUseRegex);
  }, [findQuery, findCaseSensitive, findWholeWord, findUseRegex]);

  const globalSearchRegexForLineHighlight = useMemo(() => {
    return getSearchRegex(
      deferredGlobalSearchQuery,
      globalSearchCaseSensitive,
      globalSearchWholeWord,
      globalSearchUseRegex
    );
  }, [deferredGlobalSearchQuery, globalSearchCaseSensitive, globalSearchUseRegex, globalSearchWholeWord]);

  useEffect(() => {
    if (localMatches.length === 0) {
      setActiveFindIndex(0);
    } else if (activeFindIndex >= localMatches.length) {
      setActiveFindIndex(localMatches.length - 1);
    }
  }, [localMatches, activeFindIndex]);

  useEffect(() => {
    if (findActive && localMatches.length > 0 && activeFindIndex < localMatches.length) {
      const activeMatch = localMatches[activeFindIndex];
      const targetLine = activeMatch.lineIndex + 1;
      if (surfaceRef.current) {
        const targetScrollTop = 12 + (targetLine - 1) * 20 - 80;
        surfaceRef.current.scrollTop = Math.max(0, targetScrollTop);
      }
    }
  }, [activeFindIndex, localMatches, findActive]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        const activeEl = document.activeElement;
        if (activeEl?.id === 'local-find-input') {
          return;
        }
        e.preventDefault();
        setFindActive(true);
        window.requestAnimationFrame(() => {
          const findInput = document.getElementById('local-find-input');
          if (findInput) {
            findInput.focus();
            (findInput as HTMLInputElement).select();
          }
        });
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [selectedPath]);
  const hasDirtyTabs = tabs.some((tab) => tab.content !== tab.savedContent);

  const lineCount = useMemo(() => {
    if (!selectedTab) {
      return 1;
    }

    return Math.max(1, selectedLines.length);
  }, [selectedLines, selectedTab]);
  const editorHeight = lineCount * 20 + 24;
  const editorContentWidth = useMemo(() => {
    const longestLineLength = selectedLines.reduce((maxLength, line) => {
      const visualLength = line.replace(/\t/g, '  ').length;
      return Math.max(maxLength, visualLength);
    }, 0);

    return Math.max(0, longestLineLength * 8 + 32);
  }, [selectedLines]);

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
  };

  const updateSelectedContent = useCallback((content: string): void => {
    const path = selectedPathRef.current;
    if (!path) {
      return;
    }

    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, content } : tab)));
  }, []);

  const pushHistory = useCallback((
    path: string,
    content: string,
    selectionStart: number,
    selectionEnd: number,
    actionType: 'type' | 'cut' | 'paste' | 'tab' | 'move' | 'other' = 'other'
  ) => {
    if (!historyRef.current[path]) {
      historyRef.current[path] = { past: [], future: [] };
    }
    const hist = historyRef.current[path];
    const lastEntry = hist.past[hist.past.length - 1];

    if (!lastEntry || lastEntry.content !== content) {
      const now = Date.now();
      const timeDiff = now - lastEditTimeRef.current;

      const shouldGroup =
        actionType === 'type' &&
        lastActionTypeRef.current === 'type' &&
        timeDiff < 1200 &&
        !content.endsWith(' ') &&
        !content.endsWith('\n');

      if (!shouldGroup) {
        if (hist.past.length >= 200) {
          hist.past.shift();
        }
        hist.past.push({ content, selectionStart, selectionEnd });
        hist.future = [];
      }

      lastEditTimeRef.current = now;
      lastActionTypeRef.current = actionType;
    }
  }, []);

  const handleUndo = useCallback((path: string, textarea: HTMLTextAreaElement) => {
    const hist = historyRef.current[path];
    if (!hist || hist.past.length === 0) return;

    const currentContent = textarea.value;
    const currentStart = textarea.selectionStart;
    const currentEnd = textarea.selectionEnd;

    const prevEntry = hist.past.pop()!;

    hist.future.push({
      content: currentContent,
      selectionStart: currentStart,
      selectionEnd: currentEnd
    });

    updateSelectedContent(prevEntry.content);

    lastEditTimeRef.current = 0;
    lastActionTypeRef.current = '';

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = prevEntry.selectionStart;
      textarea.selectionEnd = prevEntry.selectionEnd;
    });
  }, [updateSelectedContent]);

  const handleRedo = useCallback((path: string, textarea: HTMLTextAreaElement) => {
    const hist = historyRef.current[path];
    if (!hist || hist.future.length === 0) return;

    const currentContent = textarea.value;
    const currentStart = textarea.selectionStart;
    const currentEnd = textarea.selectionEnd;

    const nextEntry = hist.future.pop()!;

    hist.past.push({
      content: currentContent,
      selectionStart: currentStart,
      selectionEnd: currentEnd
    });

    updateSelectedContent(nextEntry.content);

    lastEditTimeRef.current = 0;
    lastActionTypeRef.current = '';

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = nextEntry.selectionStart;
      textarea.selectionEnd = nextEntry.selectionEnd;
    });
  }, [updateSelectedContent]);

  const navigateFind = useCallback((direction: 'next' | 'prev') => {
    if (localMatches.length === 0) return;
    if (direction === 'next') {
      setActiveFindIndex((prev) => (prev + 1) % localMatches.length);
    } else {
      setActiveFindIndex((prev) => (prev - 1 + localMatches.length) % localMatches.length);
    }
  }, [localMatches]);

  const handleCopy = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    if (textarea.selectionStart === textarea.selectionEnd) {
      const content = textarea.value;
      const selectionStart = textarea.selectionStart;
      const lineStart = content.lastIndexOf('\n', selectionStart - 1) + 1;
      let lineEnd = content.indexOf('\n', selectionStart);
      if (lineEnd === -1) {
        lineEnd = content.length;
      }
      const lineText = content.substring(lineStart, lineEnd) + '\n';
      
      e.clipboardData.setData('text/plain', lineText);
      e.clipboardData.setData('application/x-carogent-line', 'true');
      isCopiedLineRef.current = true;
      lastCopiedLineTextRef.current = lineText;
      e.preventDefault();
    } else {
      isCopiedLineRef.current = false;
      lastCopiedLineTextRef.current = '';
    }
  };

  const handleCut = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    if (textarea.selectionStart === textarea.selectionEnd) {
      const content = textarea.value;
      const selectionStart = textarea.selectionStart;
      const lineStart = content.lastIndexOf('\n', selectionStart - 1) + 1;
      let lineEnd = content.indexOf('\n', selectionStart);
      
      let lineText = '';
      let nextContent = '';
      let nextCursorPos = lineStart;
      
      if (lineEnd === -1) {
        lineEnd = content.length;
        lineText = content.substring(lineStart, lineEnd) + '\n';
        if (lineStart > 0) {
          nextContent = content.substring(0, lineStart - 1);
          nextCursorPos = lineStart - 1;
        } else {
          nextContent = '';
          nextCursorPos = 0;
        }
      } else {
        lineText = content.substring(lineStart, lineEnd + 1);
        nextContent = content.substring(0, lineStart) + content.substring(lineEnd + 1);
        nextCursorPos = lineStart;
      }
      
      e.clipboardData.setData('text/plain', lineText);
      e.clipboardData.setData('application/x-carogent-line', 'true');
      isCopiedLineRef.current = true;
      lastCopiedLineTextRef.current = lineText;
      
      if (selectedTab) {
        pushHistory(selectedTab.path, content, selectionStart, selectionStart, 'cut');
      }
      updateSelectedContent(nextContent);
      window.requestAnimationFrame(() => {
        textarea.selectionStart = nextCursorPos;
        textarea.selectionEnd = nextCursorPos;
      });
      e.preventDefault();
    } else {
      isCopiedLineRef.current = false;
      lastCopiedLineTextRef.current = '';
    }
  };

  const handlePaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const clipboardText = e.clipboardData.getData('text/plain');
    const isLine = e.clipboardData.types.includes('application/x-carogent-line') || 
                   (isCopiedLineRef.current && clipboardText === lastCopiedLineTextRef.current);
    if (isLine && textarea.selectionStart === textarea.selectionEnd) {
      e.preventDefault();
      const content = textarea.value;
      const selectionStart = textarea.selectionStart;
      
      const lineStart = content.lastIndexOf('\n', selectionStart - 1) + 1;
      const nextContent = content.substring(0, lineStart) + clipboardText + content.substring(lineStart);
      
      if (selectedTab) {
        pushHistory(selectedTab.path, content, selectionStart, selectionStart, 'paste');
      }
      updateSelectedContent(nextContent);
      
      const nextCursorPos = selectionStart + clipboardText.length;
      window.requestAnimationFrame(() => {
        textarea.selectionStart = nextCursorPos;
        textarea.selectionEnd = nextCursorPos;
      });
    }
  };

  const handleFindInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateFind('prev');
      } else {
        navigateFind('next');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setFindActive(false);
      const editorInput = document.querySelector('.file-editor-input') as HTMLTextAreaElement | null;
      if (editorInput) {
        editorInput.focus();
      }
    }
  };

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Record current selection for onChange history
    const textarea = event.currentTarget;
    lastSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd
    };

    // Undo shortcut: Cmd/Ctrl + Z (but NOT shift)
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (selectedTab) {
        handleUndo(selectedTab.path, event.currentTarget);
      }
      return;
    }

    // Redo shortcut: Cmd/Ctrl + Shift + Z OR Cmd/Ctrl + Y
    if (
      ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z') ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y')
    ) {
      event.preventDefault();
      if (selectedTab) {
        handleRedo(selectedTab.path, event.currentTarget);
      }
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (!selectedTab) return;
      const content = textarea.value;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      const direction = event.key === 'ArrowUp' ? 'up' : 'down';

      const lines = content.split('\n');
      
      const getPosFromIndex = (text: string, index: number) => {
        let line = 0;
        let col = 0;
        for (let i = 0; i < index; i++) {
          if (text[i] === '\n') {
            line++;
            col = 0;
          } else {
            col++;
          }
        }
        return { line, col };
      };

      const getIndexFromPos = (linesArr: string[], line: number, col: number) => {
        let index = 0;
        for (let i = 0; i < line; i++) {
          index += linesArr[i].length + 1;
        }
        index += Math.min(col, linesArr[line] ? linesArr[line].length : 0);
        return index;
      };

      const startPos = getPosFromIndex(content, selStart);
      const endPos = getPosFromIndex(content, selEnd);
      
      let firstLine = startPos.line;
      let lastLine = endPos.line;
      if (selStart < selEnd && endPos.col === 0 && lastLine > firstLine) {
        lastLine--;
      }

      if (direction === 'up') {
        if (firstLine > 0) {
          const newLines = [...lines];
          const lineAbove = newLines[firstLine - 1];
          newLines.splice(firstLine - 1, 1);
          newLines.splice(lastLine, 0, lineAbove);
          
          const newContent = newLines.join('\n');
          const newSelStart = getIndexFromPos(newLines, startPos.line - 1, startPos.col);
          const newSelEnd = getIndexFromPos(newLines, endPos.line - 1, endPos.col);
          
          pushHistory(selectedTab.path, content, selStart, selEnd, 'move');
          updateSelectedContent(newContent);
          window.requestAnimationFrame(() => {
            textarea.selectionStart = newSelStart;
            textarea.selectionEnd = newSelEnd;
          });
        }
      } else {
        if (lastLine < lines.length - 1) {
          const newLines = [...lines];
          const lineBelow = newLines[lastLine + 1];
          newLines.splice(lastLine + 1, 1);
          newLines.splice(firstLine, 0, lineBelow);
          
          const newContent = newLines.join('\n');
          const newSelStart = getIndexFromPos(newLines, startPos.line + 1, startPos.col);
          const newSelEnd = getIndexFromPos(newLines, endPos.line + 1, endPos.col);
          
          pushHistory(selectedTab.path, content, selStart, selEnd, 'move');
          updateSelectedContent(newContent);
          window.requestAnimationFrame(() => {
            textarea.selectionStart = newSelStart;
            textarea.selectionEnd = newSelEnd;
          });
        }
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveFile();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setFindActive(true);
      window.requestAnimationFrame(() => {
        const findInput = document.getElementById('local-find-input');
        if (findInput) {
          findInput.focus();
          (findInput as HTMLInputElement).select();
        }
      });
      return;
    }

    if (event.key === 'Escape' && findActive) {
      event.preventDefault();
      setFindActive(false);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextContent = `${selectedTab?.content.slice(0, start) || ''}  ${selectedTab?.content.slice(end) || ''}`;

      if (selectedTab) {
        pushHistory(selectedTab.path, selectedTab.content, start, end, 'tab');
      }
      updateSelectedContent(nextContent);
      window.requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
    }
  };

  if (!tabs.length) {
    return (
      <div className="file-editor-empty">
        <div className="file-editor-empty-title">Select a file</div>
        <div className="file-editor-empty-text">Choose a file from Explorer to edit it here.</div>
      </div>
    );
  }

  return (
    <section className="file-editor-workspace">
      <div className="file-editor-tabs">
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
      {selectedTab && (
        <>
          <div className="file-editor-toolbar">
            <div className="file-editor-path" title={selectedTab.path}>
              {getRelativePath(selectedTab.path, rootPath)}
            </div>
            <div className="file-editor-actions">
              <span className={`file-editor-save-state${hasDirtyTabs ? ' is-dirty' : ''}`}>
                {selectedTab.saving
                  ? 'Saving...'
                  : selectedTab.content !== selectedTab.savedContent
                  ? 'Unsaved'
                  : selectedTab.modifiedAt
                  ? `Saved ${formatModifiedAt(selectedTab.modifiedAt)}`
                  : 'Saved'}
              </span>
              <button
                className="file-editor-action"
                type="button"
                title="Reload file"
                onClick={() => loadFile(selectedTab.path, true)}
                disabled={selectedTab.loading || selectedTab.saving}
              >
                <RefreshIcon className={selectedTab.loading ? 'spin' : ''} />
              </button>
              <button
                className="file-editor-save-button"
                type="button"
                onClick={() => saveFile()}
                disabled={selectedTab.loading || selectedTab.saving || selectedTab.content === selectedTab.savedContent}
              >
                Save
              </button>
            </div>
          </div>
          {selectedTab.error && <div className="file-editor-error">{selectedTab.error}</div>}
          {findActive && (
            <div className="local-find-widget">
              <div className="local-find-input-wrapper">
                <input
                  id="local-find-input"
                  type="text"
                  placeholder="Find"
                  value={findQuery}
                  onChange={(e) => {
                    setFindQuery(e.target.value);
                    setActiveFindIndex(0);
                  }}
                  onKeyDown={handleFindInputKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="local-find-options">
                  <button
                    type="button"
                    className={`local-find-option ${findCaseSensitive ? 'is-active' : ''}`}
                    onClick={() => {
                      setFindCaseSensitive(prev => !prev);
                      setActiveFindIndex(0);
                    }}
                    title="Match Case (Aa)"
                  >
                    Aa
                  </button>
                  <button
                    type="button"
                    className={`local-find-option ${findWholeWord ? 'is-active' : ''}`}
                    onClick={() => {
                      setFindWholeWord(prev => !prev);
                      setActiveFindIndex(0);
                    }}
                    title="Match Whole Word (ab)"
                  >
                    ab
                  </button>
                  <button
                    type="button"
                    className={`local-find-option ${findUseRegex ? 'is-active' : ''}`}
                    onClick={() => {
                      setFindUseRegex(prev => !prev);
                      setActiveFindIndex(0);
                    }}
                    title="Use Regular Expression (.*)"
                  >
                    .*
                  </button>
                </div>
              </div>
              <div className="local-find-controls">
                <span className="local-find-count">
                  {localMatches.length > 0
                    ? `${activeFindIndex + 1} of ${localMatches.length}`
                    : 'No results'}
                </span>
                <button
                  type="button"
                  className="local-find-action"
                  onClick={() => navigateFind('prev')}
                  disabled={localMatches.length === 0}
                  title="Previous Match (Shift+Enter)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="local-find-action"
                  onClick={() => navigateFind('next')}
                  disabled={localMatches.length === 0}
                  title="Next Match (Enter)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="local-find-action close-action"
                  onClick={() => {
                    setFindActive(false);
                    const editorInput = document.querySelector('.file-editor-input') as HTMLTextAreaElement | null;
                    if (editorInput) {
                      editorInput.focus();
                    }
                  }}
                  title="Close (Escape)"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          )}

          <div ref={surfaceRef} className="file-editor-surface">
            {selectedTab.loading && (
              <div className="file-editor-loading-overlay">
                <div className="file-editor-loading-spinner" />
                <span>Loading file...</span>
              </div>
            )}
            <EditorGutter
              lineCount={lineCount}
              activeLineNumber={activeLineNumber}
              editorHeight={editorHeight}
            />
            <div
              className="file-editor-container"
              style={{ minHeight: `${editorHeight}px`, minWidth: `${editorContentWidth}px` }}
            >
              <pre className="file-editor-highlight" style={{ minHeight: `${editorHeight}px` }}>
                {selectedLines.map((line, index) => {
                  let localMatchRanges: LocalMatchRange[] | undefined = undefined;
                  const regexForLineHighlight = findActive
                    ? localFindRegexForLineHighlight
                    : globalSearchRegexForLineHighlight;

                  if (regexForLineHighlight) {
                    let match;
                    regexForLineHighlight.lastIndex = 0;
                    while ((match = regexForLineHighlight.exec(line)) !== null) {
                      const matchIndex = match.index;
                      const matchText = match[0];
                      if (matchText.length === 0) {
                        regexForLineHighlight.lastIndex++;
                        continue;
                      }
                      
                      const isActiveMatch =
                        findActive &&
                        localMatches[activeFindIndex] &&
                        localMatches[activeFindIndex].lineIndex === index &&
                        localMatches[activeFindIndex].charIndex === matchIndex;
                        
                      if (!localMatchRanges) {
                        localMatchRanges = [];
                      }
                      localMatchRanges.push({
                        start: matchIndex,
                        end: matchIndex + matchText.length,
                        isActive: !!isActiveMatch
                      });
                    }
                  }

                  return (
                    <CodeLine
                      key={index}
                      line={line}
                      filePath={selectedTab.path}
                      isActive={activeLineNumber === index + 1}
                      localMatchRanges={localMatchRanges}
                    />
                  );
                })}
              </pre>
              <textarea
                className="file-editor-input"
                value={selectedTab.content}
                wrap="off"
                spellCheck={false}
                disabled={selectedTab.loading}
                style={{ minHeight: `${editorHeight}px` }}
                onChange={(event) => {
                  const nextVal = event.target.value;
                  const textarea = event.currentTarget;
                  pushHistory(selectedTab.path, selectedTab.content, lastSelectionRef.current.start, lastSelectionRef.current.end, 'type');
                  updateSelectedContent(nextVal);
                  lastSelectionRef.current = {
                    start: textarea.selectionStart,
                    end: textarea.selectionEnd
                  };
                }}
                onKeyDown={handleEditorKeyDown}
                onSelect={(event) => {
                  const textarea = event.currentTarget;
                  lastSelectionRef.current = {
                    start: textarea.selectionStart,
                    end: textarea.selectionEnd
                  };
                }}
                onCopy={handleCopy}
                onCut={handleCut}
                onPaste={handlePaste}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
