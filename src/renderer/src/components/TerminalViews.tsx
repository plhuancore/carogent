import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ISearchOptions } from '@xterm/addon-search';
import type { TerminalShellOption } from '../../../shared/ipcTypes';
import type { LayoutNode, PaneNode, SplitDirection } from '../layout';
import {
  AgentOverlayIcon,
  ChevronDownIcon,
  SearchIcon,
  ShellIcon,
  SplitDownIcon,
  SplitRightIcon
} from './AppIcons';
import {
  captureTerminalScroll,
  getPaneShell,
  getShellOption,
  scheduleTerminalFit,
  scheduleTerminalScrollRestore,
  type TerminalSession
} from '../terminalHelpers';

const HEADER_COLOR_PRESETS = [
  '#0b0f14',
  '#172554',
  '#134e4a',
  '#3b0764',
  '#500724',
  '#431407',
  '#14532d',
  '#1e293b'
];

function getHeaderColor(color?: string): string {
  return color && HEADER_COLOR_PRESETS.includes(color) ? color : HEADER_COLOR_PRESETS[0];
}

function formatBrowserUrlLabel(value?: string): string {
  const rawValue = value?.trim();

  if (!rawValue) {
    return '';
  }

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(rawValue) ? rawValue : `http://${rawValue}`);
    const path = `${url.pathname}${url.search}${url.hash}`;

    return path === '/' ? url.host : `${url.host}${path}`;
  } catch {
    return rawValue;
  }
}

function escapeTerminalPath(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')) {
    return `"${path.replace(/"/g, '\\"')}"`;
  }

  return `'${path.replace(/'/g, "'\\''")}'`;
}

type NodeViewProps = {
  node: LayoutNode;
  path: string;
  activePaneId: string;
  workspaceFocusColor?: string;
  paneCount: number;
  ensureSession: (pane: PaneNode) => TerminalSession;
  onActivate: (paneId: string) => void;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClose: (paneId: string) => void;
  onResize: (path: string, firstSize: number) => void;
  onUpdatePane: (paneId: string, changes: Partial<PaneNode>) => void;
  onChangeShell: (paneId: string, shell: string) => void;
  onOpenBrowser: (browserUrl?: string) => void;
  shellOptions: TerminalShellOption[];
  onPushToOverlay: (paneId: string) => void;
  pinnedPaneIds: Set<string>;
};

export function NodeView(props: NodeViewProps): JSX.Element {
  if (props.node.type === 'pane') {
    return (
      <TerminalPane
        key={props.node.paneId}
        pane={props.node}
        active={props.node.paneId === props.activePaneId}
        workspaceFocusColor={props.workspaceFocusColor}
        canClose={props.paneCount > 1}
        ensureSession={props.ensureSession}
        onActivate={props.onActivate}
        onSplit={props.onSplit}
        onClose={props.onClose}
        onUpdatePane={props.onUpdatePane}
        onChangeShell={props.onChangeShell}
        onOpenBrowser={props.onOpenBrowser}
        shellOptions={props.shellOptions}
        onPushToOverlay={props.onPushToOverlay}
        pinnedPaneIds={props.pinnedPaneIds}
      />
    );
  }

  return (
    <SplitView
      {...props}
      node={props.node}
    />
  );
}

type SplitViewProps = NodeViewProps & {
  node: Extract<LayoutNode, { type: 'split' }>;
};

function SplitView({
  node,
  path,
  activePaneId,
  workspaceFocusColor,
  paneCount,
  ensureSession,
  onActivate,
  onSplit,
  onClose,
  onResize,
  onUpdatePane,
  onChangeShell,
  onOpenBrowser,
  shellOptions,
  onPushToOverlay,
  pinnedPaneIds
}: SplitViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const directionClass = node.direction === 'row' ? 'split-row' : 'split-column';

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      const size = node.direction === 'row' ? rect.width : rect.height;

      if (size <= 0) {
        return;
      }

      const percent =
        node.direction === 'row'
          ? ((moveEvent.clientX - rect.left) / size) * 100
          : ((moveEvent.clientY - rect.top) / size) * 100;

      onResize(path, percent);
    };

    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className={`split ${directionClass}`} ref={containerRef}>
      <div className="split-child" style={{ flex: `${node.sizes[0]} 1 0` }}>
        <NodeView
          node={node.children[0]}
          path={`${path}0`}
          activePaneId={activePaneId}
          workspaceFocusColor={workspaceFocusColor}
          paneCount={paneCount}
          ensureSession={ensureSession}
          onActivate={onActivate}
          onSplit={onSplit}
          onClose={onClose}
          onResize={onResize}
          onUpdatePane={onUpdatePane}
          onChangeShell={onChangeShell}
          onOpenBrowser={onOpenBrowser}
          shellOptions={shellOptions}
          onPushToOverlay={onPushToOverlay}
          pinnedPaneIds={pinnedPaneIds}
        />
      </div>
      <div className="divider" role="separator" onPointerDown={beginResize} />
      <div className="split-child" style={{ flex: `${node.sizes[1]} 1 0` }}>
        <NodeView
          node={node.children[1]}
          path={`${path}1`}
          activePaneId={activePaneId}
          workspaceFocusColor={workspaceFocusColor}
          paneCount={paneCount}
          ensureSession={ensureSession}
          onActivate={onActivate}
          onSplit={onSplit}
          onClose={onClose}
          onResize={onResize}
          onUpdatePane={onUpdatePane}
          onChangeShell={onChangeShell}
          onOpenBrowser={onOpenBrowser}
          shellOptions={shellOptions}
          onPushToOverlay={onPushToOverlay}
          pinnedPaneIds={pinnedPaneIds}
        />
      </div>
    </div>
  );
}

type TerminalPaneProps = {
  pane: PaneNode;
  active: boolean;
  workspaceFocusColor?: string;
  canClose: boolean;
  ensureSession: (pane: PaneNode) => TerminalSession;
  onActivate: (paneId: string) => void;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClose: (paneId: string) => void;
  onUpdatePane: (paneId: string, changes: Partial<PaneNode>) => void;
  onChangeShell: (paneId: string, shell: string) => void;
  onOpenBrowser: (browserUrl?: string) => void;
  shellOptions: TerminalShellOption[];
  onPushToOverlay: (paneId: string) => void;
  pinnedPaneIds: Set<string>;
};

function TerminalPane({
  pane,
  active,
  workspaceFocusColor,
  canClose,
  ensureSession,
  onActivate,
  onSplit,
  onClose,
  onUpdatePane,
  onChangeShell,
  onOpenBrowser,
  shellOptions,
  onPushToOverlay,
  pinnedPaneIds
}: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shellMenuRef = useRef<HTMLDivElement | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchResultIndex, setSearchResultIndex] = useState<number | null>(null);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [draftTitle, setDraftTitle] = useState(pane.customTitle || '');
  const [draftBrowserUrl, setDraftBrowserUrl] = useState(pane.browserUrl || '');
  const displayTitle = pane.customTitle || pane.title;
  const browserUrlLabel = formatBrowserUrlLabel(pane.browserUrl);
  const isPinned = pinnedPaneIds.has(pane.paneId);
  const headerColor = getHeaderColor(pane.headerColor);
  const selectedShell = getShellOption(shellOptions, pane.shell);
  const paneStyle = useMemo(
    () =>
      ({
        '--pane-active-color': workspaceFocusColor || undefined
      }) as CSSProperties,
    [workspaceFocusColor]
  );

  const commitTitle = useCallback(() => {
    const nextTitle = draftTitle.trim();
    const nextBrowserUrl = draftBrowserUrl.trim();

    onUpdatePane(pane.paneId, {
      customTitle: nextTitle.length > 0 ? nextTitle : undefined,
      browserUrl: nextBrowserUrl.length > 0 ? nextBrowserUrl : undefined
    });
  }, [draftBrowserUrl, draftTitle, onUpdatePane, pane.paneId]);

  const closeEditor = useCallback(() => {
    commitTitle();
    setEditorOpen(false);
  }, [commitTitle]);

  const getSearchOptions = useCallback(
    (incremental = false): ISearchOptions | null => {
      if (searchRegex) {
        try {
          new RegExp(searchQuery);
        } catch {
          setSearchError('Invalid regex');
          return null;
        }
      }

      setSearchError(null);

      return {
        caseSensitive: searchCaseSensitive,
        regex: searchRegex,
        incremental,
        decorations: {
          matchBackground: '#facc15',
          matchOverviewRuler: '#facc15',
          activeMatchBackground: '#f97316',
          activeMatchBorder: '#ffffff',
          activeMatchColorOverviewRuler: '#f97316'
        }
      };
    },
    [searchCaseSensitive, searchQuery, searchRegex]
  );

  const focusTerminal = useCallback(() => {
    const session = ensureSession(pane);

    window.setTimeout(() => session.terminal.focus(), 0);
  }, [ensureSession, pane]);

  const closeSearch = useCallback(() => {
    const session = ensureSession(pane);

    session.searchAddon.clearDecorations();
    setSearchResultCount(0);
    setSearchResultIndex(null);
    setSearchOpen(false);
    focusTerminal();
  }, [ensureSession, focusTerminal, pane]);

  const openSearch = useCallback(() => {
    onActivate(pane.paneId);
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [onActivate, pane.paneId]);

  const runSearch = useCallback(
    (direction: 'next' | 'previous', incremental = false) => {
      const query = searchQuery.trim();

      if (!query) {
        setSearchError(null);
        setSearchResultCount(0);
        setSearchResultIndex(null);
        return;
      }

      const searchOptions = getSearchOptions(incremental);

      if (!searchOptions) {
        return;
      }

      try {
        const session = ensureSession(pane);
        const found =
          direction === 'next'
            ? session.searchAddon.findNext(query, searchOptions)
            : session.searchAddon.findPrevious(query, searchOptions);

        setSearchError(found ? null : 'No match');
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : String(error));
      }
    },
    [ensureSession, getSearchOptions, pane, searchQuery]
  );

  const searchCountLabel =
    searchResultIndex === -1
      ? 'Many matches'
      : searchResultIndex !== null && searchResultCount > 0
        ? `${searchResultIndex + 1} of ${searchResultCount}`
        : searchError === 'No match'
          ? '0 of 0'
          : '';

  useEffect(() => {
    const host = hostRef.current;
    const session = ensureSession(pane);

    if (!host) {
      return;
    }

    if (session.terminal.element) {
      host.appendChild(session.terminal.element);
    } else {
      session.terminal.open(host);
    }

    const observer = new ResizeObserver(() => scheduleTerminalFit(session));
    observer.observe(host);
    scheduleTerminalFit(session);
    scheduleTerminalScrollRestore(session);
    window.setTimeout(() => scheduleTerminalFit(session), 0);

    return () => {
      observer.disconnect();
      captureTerminalScroll(session);

      if (session.terminal.element?.parentElement === host) {
        host.removeChild(session.terminal.element);
      }
    };
  }, [ensureSession, pane.paneId, pane.shell]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const session = ensureSession(pane);

    scheduleTerminalFit(session);
    window.setTimeout(() => session.terminal.focus(), 0);
  }, [active, ensureSession, pane.paneId, pane.shell]);

  useEffect(() => {
    const session = ensureSession(pane);
    const disposable = session.searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResultIndex(resultIndex);
      setSearchResultCount(resultCount);
    });

    return () => disposable.dispose();
  }, [ensureSession, pane.paneId, pane.shell]);

  useEffect(() => {
    if (editorOpen) {
      setDraftTitle(pane.customTitle || '');
      setDraftBrowserUrl(pane.browserUrl || '');
    }
  }, [editorOpen, pane.browserUrl, pane.customTitle]);

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    if (!searchQuery.trim()) {
      const session = ensureSession(pane);

      session.searchAddon.clearDecorations();
      setSearchError(null);
      setSearchResultCount(0);
      setSearchResultIndex(null);
      return;
    }

    runSearch('next', true);
  }, [ensureSession, pane, runSearch, searchCaseSensitive, searchOpen, searchQuery, searchRegex]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, openSearch]);

  useEffect(() => {
    if (!editorOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!editorRef.current?.contains(event.target as Node)) {
        closeEditor();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [closeEditor, editorOpen]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!searchRef.current?.contains(event.target as Node)) {
        closeSearch();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [closeSearch, searchOpen]);

  useEffect(() => {
    if (!shellMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!shellMenuRef.current?.contains(event.target as Node)) {
        setShellMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [shellMenuOpen]);

  const handleColorSelect = (color: string): void => {
    commitTitle();
    onUpdatePane(pane.paneId, { headerColor: color === HEADER_COLOR_PRESETS[0] ? undefined : color });
    setEditorOpen(false);
  };

  const handleShellSelect = (shell: string): void => {
    setShellMenuOpen(false);

    if (shell !== getPaneShell(shellOptions, pane)) {
      commitTitle();
      onChangeShell(pane.paneId, shell);
    }
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  };

  const handleDrop = (event: ReactDragEvent<HTMLElement>): void => {
    event.preventDefault();
    setDragActive(false);
    onActivate(pane.paneId);

    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => window.terminalApi.getPathForFile(file))
      .filter((path) => path.length > 0);
    const internalPath =
      event.dataTransfer.getData('application/x-carogent-path') || event.dataTransfer.getData('text/plain');
    const paths = filePaths.length > 0 ? filePaths : [internalPath].filter((path) => path.length > 0);

    if (paths.length === 0) {
      return;
    }

    const session = ensureSession(pane);
    const input = `${paths.map(escapeTerminalPath).join(' ')} `;

    if (session.terminalId && session.status !== 'exited') {
      window.terminalApi.write({ id: session.terminalId, data: input });
      window.setTimeout(() => session.terminal.focus(), 0);
      return;
    }

    session.terminal.writeln('');
    session.terminal.writeln('Dropped file path will be available after the shell starts.');
  };

  return (
    <article
      className={`terminal-pane ${active ? 'is-active' : ''} ${dragActive ? 'is-drag-over' : ''}`}
      style={paneStyle}
      onMouseDown={() => onActivate(pane.paneId)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="pane-toolbar" style={{ backgroundColor: headerColor }}>
        <div className="pane-left-tools">
          <div className="shell-picker" ref={shellMenuRef} onMouseDown={(event) => event.stopPropagation()}>
            <button
              className="shell-picker-button"
              type="button"
              title="Select terminal"
              aria-haspopup="menu"
              aria-expanded={shellMenuOpen}
              onClick={() => setShellMenuOpen((open) => !open)}
            >
              <ShellIcon name={selectedShell.icon} />
              <ChevronDownIcon />
            </button>
            {shellMenuOpen && (
              <div className="shell-menu" role="menu">
                {shellOptions.map((option) => (
                  <button
                    key={option.shell}
                    className={`shell-menu-item ${option.shell === selectedShell.shell ? 'is-selected' : ''}`}
                    type="button"
                    role="menuitem"
                    onClick={() => handleShellSelect(option.shell)}
                  >
                    <ShellIcon name={option.icon} />
                    <span className="shell-menu-label">{option.label}</span>
                    {option.shortcut && <span className="shell-menu-shortcut">{option.shortcut}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {browserUrlLabel && (
            <button
              className="pane-domain"
              type="button"
              title={`Open ${pane.browserUrl || browserUrlLabel}`}
              onClick={() => onOpenBrowser(pane.browserUrl)}
            >
              {browserUrlLabel}
            </button>
          )}
        </div>
        <div
          className="pane-title-group"
          onDoubleClick={(event) => {
            event.preventDefault();
            setEditorOpen(true);
          }}
        >
          <div className="pane-title" title={pane.cwd}>
            {displayTitle}
          </div>
        </div>
        {editorOpen && (
          <div className="pane-editor" ref={editorRef} onMouseDown={(event) => event.stopPropagation()}>
            <label className="pane-editor-label" htmlFor={`pane-title-${pane.paneId}`}>
              Pane name
            </label>
            <input
              id={`pane-title-${pane.paneId}`}
              value={draftTitle}
              placeholder={pane.title}
              autoFocus
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  closeEditor();
                }

                if (event.key === 'Escape') {
                  setDraftTitle(pane.customTitle || '');
                  setDraftBrowserUrl(pane.browserUrl || '');
                  setEditorOpen(false);
                }
              }}
            />
            <label className="pane-editor-label pane-editor-label-secondary" htmlFor={`pane-browser-${pane.paneId}`}>
              Domain
            </label>
            <input
              id={`pane-browser-${pane.paneId}`}
              value={draftBrowserUrl}
              placeholder="localhost:3000"
              onChange={(event) => setDraftBrowserUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  closeEditor();
                }

                if (event.key === 'Escape') {
                  setDraftTitle(pane.customTitle || '');
                  setDraftBrowserUrl(pane.browserUrl || '');
                  setEditorOpen(false);
                }
              }}
            />
            <div className="color-swatches" aria-label="Header color">
              {HEADER_COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className={`color-swatch ${color === headerColor ? 'is-selected' : ''}`}
                  type="button"
                  title={color === HEADER_COLOR_PRESETS[0] ? 'Default' : color}
                  style={{ backgroundColor: color }}
                  onClick={() => handleColorSelect(color)}
                />
              ))}
            </div>
          </div>
        )}
        {searchOpen && (
          <div className="pane-search" ref={searchRef} onMouseDown={(event) => event.stopPropagation()}>
            <input
              ref={searchInputRef}
              className="pane-search-input"
              value={searchQuery}
              placeholder="Search"
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchError(null);
                setSearchResultCount(0);
                setSearchResultIndex(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  runSearch(event.shiftKey ? 'previous' : 'next');
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSearch();
                }
              }}
            />
            <button
              className={`pane-search-toggle ${searchCaseSensitive ? 'is-active' : ''}`}
              type="button"
              title="Match case"
              onClick={() => setSearchCaseSensitive((value) => !value)}
            >
              Aa
            </button>
            <button
              className={`pane-search-toggle ${searchRegex ? 'is-active' : ''}`}
              type="button"
              title="Use regex"
              onClick={() => setSearchRegex((value) => !value)}
            >
              .*
            </button>
            <span className="pane-search-count">{searchCountLabel}</span>
            <button
              className="pane-search-nav"
              type="button"
              title="Previous match"
              onClick={() => runSearch('previous')}
            >
              ↑
            </button>
            <button
              className="pane-search-nav"
              type="button"
              title="Next match"
              onClick={() => runSearch('next')}
            >
              ↓
            </button>
            <button type="button" title="Close search" onClick={closeSearch}>
              x
            </button>
            {searchError && <span className="pane-search-status">{searchError}</span>}
          </div>
        )}
        <div className="pane-actions">
          <button
            className={isPinned ? 'is-pinned' : ''}
            type="button"
            title={isPinned ? 'Remove from overlay' : 'Show in overlay'}
            onClick={() => onPushToOverlay(pane.paneId)}
          >
            <AgentOverlayIcon />
          </button>
          <button type="button" title="Search" onClick={openSearch}>
            <SearchIcon />
          </button>
          <button type="button" title="Split right" onClick={() => onSplit(pane.paneId, 'row')}>
            <SplitRightIcon />
          </button>
          <button type="button" title="Split down" onClick={() => onSplit(pane.paneId, 'column')}>
            <SplitDownIcon />
          </button>
          <button type="button" title="Close pane" onClick={() => onClose(pane.paneId)} disabled={!canClose}>
            x
          </button>
        </div>
      </div>
      <div
        className="terminal-host"
        onWheel={() => onActivate(pane.paneId)}
        onTouchMove={() => onActivate(pane.paneId)}
      >
        <div className="terminal-viewport" ref={hostRef} />
      </div>
    </article>
  );
}

