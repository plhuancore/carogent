import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CloseIcon, RefreshIcon } from './AppIcons';
import { highlightCodeLine } from '../git/syntaxHighlight';
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

type FileEditorWorkspaceProps = {
  activeFilePath: string;
  rootPath: string;
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

export function FileEditorWorkspace({ activeFilePath, rootPath }: FileEditorWorkspaceProps): JSX.Element {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const tabsRef = useRef<EditorTab[]>([]);

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

    window.terminalApi
      .readTextFile({ path: nextPath })
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

  const selectedTab = tabs.find((tab) => tab.path === selectedPath) || null;
  const hasDirtyTabs = tabs.some((tab) => tab.content !== tab.savedContent);

  const lineCount = useMemo(() => {
    if (!selectedTab) {
      return 1;
    }

    return Math.max(1, selectedTab.content.split('\n').length);
  }, [selectedTab]);
  const editorHeight = lineCount * 20 + 24;

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
    }
  };

  const updateSelectedContent = (content: string): void => {
    if (!selectedTab) {
      return;
    }

    setTabs((current) => current.map((tab) => (tab.path === selectedTab.path ? { ...tab, content } : tab)));
  };

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveFile();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextContent = `${selectedTab?.content.slice(0, start) || ''}  ${selectedTab?.content.slice(end) || ''}`;

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
              onClick={() => setSelectedPath(tab.path)}
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
          <div className="file-editor-surface">
            <div className="file-editor-gutter" style={{ minHeight: `${editorHeight}px` }}>
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index + 1}>{index + 1}</div>
              ))}
            </div>
            <div className="file-editor-container" style={{ minHeight: `${editorHeight}px` }}>
              <pre className="file-editor-highlight" style={{ minHeight: `${editorHeight}px` }}>
                {selectedTab.content.split('\n').map((line, index) => (
                  <div key={index} className="file-editor-line">
                    {highlightCodeLine(line, selectedTab.path) || '\n'}
                  </div>
                ))}
              </pre>
              <textarea
                className="file-editor-input"
                value={selectedTab.content}
                wrap="off"
                spellCheck={false}
                disabled={selectedTab.loading}
                style={{ minHeight: `${editorHeight}px` }}
                onChange={(event) => updateSelectedContent(event.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
