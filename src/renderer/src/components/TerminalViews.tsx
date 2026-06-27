import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ISearchOptions } from '@xterm/addon-search';
import type { TerminalShellOption } from '../../../shared/ipcTypes';
import type { LayoutNode, PaneNode, SplitDirection } from '../layout';
import { findPane, getFirstPaneId } from '../layout';
import {
  AgentOverlayIcon,
  CloseIcon,
  MenuIcon,
  SearchIcon,
  ShellIcon,
  SplitDownIcon,
  SplitRightIcon,
  MaximizeIcon,
  MinimizeIcon
} from './AppIcons';
import {
  captureTerminalScroll,
  getPaneShell,
  getShellOption,
  scheduleTerminalFit,
  scheduleTerminalScrollRestore,
  type TerminalSession
} from '../terminalHelpers';
import { isEventMatchingKeybinding } from './KeyboardShortcutsModal';

const HEADER_COLOR_PRESETS = [
  '#191820',
  '#211d34',
  '#1c2337',
  '#182b28',
  '#301f31',
  '#332819',
  '#1c2d22',
  '#24212c'
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

const SearchArrowUpIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M8 2.75a.75.75 0 0 1 .53.22l4.25 4.25a.75.75 0 1 1-1.06 1.06L8.75 5.31v7.94a.75.75 0 0 1-1.5 0V5.31L4.28 8.28a.75.75 0 0 1-1.06-1.06l4.25-4.25A.75.75 0 0 1 8 2.75z" />
  </svg>
);

const SearchArrowDownIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M8 13.25a.75.75 0 0 1-.53-.22L3.22 8.78a.75.75 0 0 1 1.06-1.06l2.97 2.97V2.75a.75.75 0 0 1 1.5 0v7.94l2.97-2.97a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-.53.22z" />
  </svg>
);

const SearchCloseIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);


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
  maximizedPaneId?: string | null;
  onToggleMaximize?: (paneId: string) => void;
  onSwapPanes?: (paneId1: string, paneId2: string) => void;
  onDockPane?: (
    draggedId: string,
    targetId: string,
    position:
      | 'top'
      | 'bottom'
      | 'left'
      | 'right'
      | 'swap'
      | 'parent-top'
      | 'parent-bottom'
      | 'parent-left'
      | 'parent-right'
  ) => void;
  onInsertBetween?: (draggedId: string, leftPaneId: string, rightPaneId: string) => void;
  draggingPaneId?: string | null;
  onDragStart?: (paneId: string) => void;
  onDragEnd?: () => void;
  parentDirection?: SplitDirection;
  keybindings?: Record<string, string>;
};

export function NodeView(props: NodeViewProps): JSX.Element {
  if (props.maximizedPaneId) {
    const maximizedPane = findPane(props.node, props.maximizedPaneId);
    if (maximizedPane) {
      return (
        <TerminalPane
          key={maximizedPane.paneId}
          pane={maximizedPane}
          active={maximizedPane.paneId === props.activePaneId}
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
          maximizedPaneId={props.maximizedPaneId}
          onToggleMaximize={props.onToggleMaximize}
          onSwapPanes={props.onSwapPanes}
          onDockPane={props.onDockPane}
          draggingPaneId={props.draggingPaneId}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          parentDirection={props.parentDirection}
          keybindings={props.keybindings}
        />
      );
    }
  }

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
        maximizedPaneId={props.maximizedPaneId}
        onToggleMaximize={props.onToggleMaximize}
        onSwapPanes={props.onSwapPanes}
        onDockPane={props.onDockPane}
        draggingPaneId={props.draggingPaneId}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        parentDirection={props.parentDirection}
        keybindings={props.keybindings}
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
  pinnedPaneIds,
  maximizedPaneId,
  onToggleMaximize,
  onSwapPanes,
  onDockPane,
  onInsertBetween,
  draggingPaneId,
  onDragStart,
  onDragEnd,
  keybindings
}: SplitViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const directionClass = node.direction === 'row' ? 'split-row' : 'split-column';
  const [isDragOverDivider, setIsDragOverDivider] = useState(false);

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

  const handleDividerDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (draggingPaneId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setIsDragOverDivider(true);
    }
  };

  const handleDividerDragLeave = (): void => {
    setIsDragOverDivider(false);
  };

  const handleDividerDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (draggingPaneId) {
      event.preventDefault();
      setIsDragOverDivider(false);

      const leftPaneId = getFirstPaneId(node.children[0]);
      const rightPaneId = getFirstPaneId(node.children[1]);

      if (onInsertBetween) {
        onInsertBetween(draggingPaneId, leftPaneId, rightPaneId);
      }
      onDragEnd?.();
    }
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
          maximizedPaneId={maximizedPaneId}
          onToggleMaximize={onToggleMaximize}
          onSwapPanes={onSwapPanes}
          onDockPane={onDockPane}
          onInsertBetween={onInsertBetween}
          draggingPaneId={draggingPaneId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          parentDirection={node.direction}
          keybindings={keybindings}
        />
      </div>
      <div
        className={`divider ${isDragOverDivider ? 'is-drag-over' : ''}`}
        role="separator"
        onPointerDown={beginResize}
        onDragOver={handleDividerDragOver}
        onDragLeave={handleDividerDragLeave}
        onDrop={handleDividerDrop}
      >
        {isDragOverDivider && <div className="divider-dock-preview" />}
      </div>
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
          maximizedPaneId={maximizedPaneId}
          onToggleMaximize={onToggleMaximize}
          onSwapPanes={onSwapPanes}
          onDockPane={onDockPane}
          onInsertBetween={onInsertBetween}
          draggingPaneId={draggingPaneId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          parentDirection={node.direction}
          keybindings={keybindings}
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
  maximizedPaneId?: string | null;
  onToggleMaximize?: (paneId: string) => void;
  onSwapPanes?: (paneId1: string, paneId2: string) => void;
  onDockPane?: (
    draggedId: string,
    targetId: string,
    position:
      | 'top'
      | 'bottom'
      | 'left'
      | 'right'
      | 'swap'
      | 'parent-top'
      | 'parent-bottom'
      | 'parent-left'
      | 'parent-right'
  ) => void;
  draggingPaneId?: string | null;
  onDragStart?: (paneId: string) => void;
  onDragEnd?: () => void;
  parentDirection?: SplitDirection;
  keybindings?: Record<string, string>;
};

function getActiveZone(
  px: number,
  py: number,
  parentDirection?: 'row' | 'column'
):
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'swap'
  | 'parent-top'
  | 'parent-bottom'
  | 'parent-left'
  | 'parent-right' {
  // Center region (e.g., middle 30% width and middle 40% height) is swap
  if (px >= 0.35 && px <= 0.65 && py >= 0.3 && py <= 0.7) {
    return 'swap';
  }

  // If parent is a row (horizontal layout of side-by-side panes)
  if (parentDirection === 'row') {
    // Extreme top/bottom edges split the whole row
    if (py < 0.2) return 'parent-top';
    if (py > 0.8) return 'parent-bottom';

    // Otherwise, left/right splits the pane horizontally
    if (px < 0.35) return 'left';
    if (px > 0.65) return 'right';

    // Fallback inner top/bottom splits the pane vertically
    return py < 0.5 ? 'top' : 'bottom';
  }

  // If parent is a column (vertical stack of panes)
  if (parentDirection === 'column') {
    // Extreme left/right edges split the whole column
    if (px < 0.2) return 'parent-left';
    if (px > 0.8) return 'parent-right';

    // Otherwise, top/bottom splits the pane vertically
    if (py < 0.35) return 'top';
    if (py > 0.65) return 'bottom';

    // Fallback inner left/right splits the pane horizontally
    return px < 0.5 ? 'left' : 'right';
  }

  // Default behavior (no parent layout context, e.g. single pane)
  // Split inside the pane based on closest edge
  const distToLeft = px;
  const distToRight = 1 - px;
  const distToTop = py;
  const distToBottom = 1 - py;
  const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

  if (minDist === distToTop) return 'top';
  if (minDist === distToBottom) return 'bottom';
  if (minDist === distToLeft) return 'left';
  return 'right';
}

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
  pinnedPaneIds,
  maximizedPaneId,
  onToggleMaximize,
  onSwapPanes,
  onDockPane,
  draggingPaneId,
  onDragStart,
  onDragEnd,
  parentDirection,
  keybindings
}: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const paneMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchResultIndex, setSearchResultIndex] = useState<number | null>(null);
  const [paneMoreMenuOpen, setPaneMoreMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeDropZone, setActiveDropZone] = useState<
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'swap'
    | 'parent-top'
    | 'parent-bottom'
    | 'parent-left'
    | 'parent-right'
    | null
  >(null);
  const [draftTitle, setDraftTitle] = useState(pane.customTitle || '');
  const [draftBrowserUrl, setDraftBrowserUrl] = useState(pane.browserUrl || '');
  const displayTitle = pane.customTitle || pane.title;
  const browserUrlLabel = formatBrowserUrlLabel(pane.browserUrl);
  const isPinned = pinnedPaneIds.has(pane.paneId);
  const headerColor = getHeaderColor(pane.headerColor);
  const paneShellOption = getShellOption(shellOptions, pane.shell);
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

    const observer = new ResizeObserver(() => {
      captureTerminalScroll(session);
      scheduleTerminalFit(session);
    });
    observer.observe(host);
    captureTerminalScroll(session);
    scheduleTerminalFit(session);
    scheduleTerminalScrollRestore(session);
    window.setTimeout(() => {
      captureTerminalScroll(session);
      scheduleTerminalFit(session);
    }, 0);

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

    captureTerminalScroll(session);
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
      const kbTerminalSearch = keybindings?.terminalSearch || 'Ctrl+F';
      if (isEventMatchingKeybinding(event, kbTerminalSearch)) {
        event.preventDefault();
        openSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, openSearch, keybindings]);

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
    if (!paneMoreMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!paneMoreMenuRef.current?.contains(event.target as Node)) {
        setPaneMoreMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [paneMoreMenuOpen]);

  const handleColorSelect = (color: string): void => {
    commitTitle();
    onUpdatePane(pane.paneId, { headerColor: color === HEADER_COLOR_PRESETS[0] ? undefined : color });
    setEditorOpen(false);
  };



  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData('application/x-carogent-pane-id', pane.paneId);
    event.dataTransfer.effectAllowed = 'move';
    onDragStart?.(pane.paneId);
  };

  const handleDragEnd = (): void => {
    onDragEnd?.();
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLElement>): void => {
    event.preventDefault();
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    event.preventDefault();
    if (draggingPaneId) {
      if (draggingPaneId === pane.paneId) {
        event.dataTransfer.dropEffect = 'none';
        setActiveDropZone(null);
        return;
      }

      event.dataTransfer.dropEffect = 'move';

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const px = x / rect.width;
      const py = y / rect.height;

      const zone = getActiveZone(px, py, parentDirection);
      setActiveDropZone(zone);
      return;
    }
    const isPaneDrag = event.dataTransfer.types.includes('application/x-carogent-pane-id');
    event.dataTransfer.dropEffect = isPaneDrag ? 'move' : 'copy';
    setDragActive(true);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    if (draggingPaneId) {
      setActiveDropZone(null);
    } else {
      setDragActive(false);
    }
  };

  const handleDrop = (event: ReactDragEvent<HTMLElement>): void => {
    event.preventDefault();
    setDragActive(false);
    setActiveDropZone(null);
    onActivate(pane.paneId);

    if (draggingPaneId) {
      if (draggingPaneId !== pane.paneId && onDockPane && activeDropZone) {
        onDockPane(draggingPaneId, pane.paneId, activeDropZone);
      }
      onDragEnd?.();
      return;
    }

    const sourcePaneId = event.dataTransfer.getData('application/x-carogent-pane-id');
    if (sourcePaneId) {
      if (sourcePaneId !== pane.paneId && onSwapPanes) {
        onSwapPanes(sourcePaneId, pane.paneId);
      }
      return;
    }

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
      className={`terminal-pane ${active ? 'is-active' : ''} ${dragActive ? 'is-drag-over' : ''} ${pane.paneId === draggingPaneId ? 'is-dragging' : ''}`}
      style={paneStyle}
      onMouseDown={() => onActivate(pane.paneId)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDragEnter={handleDragEnter}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
    >
      {activeDropZone && (
        <div className={`pane-dock-preview is-${activeDropZone}`} />
      )}
      <div
        className="pane-toolbar"
        draggable={!editorOpen}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ backgroundColor: headerColor, cursor: editorOpen ? 'default' : 'grab' }}
      >
        <div className="pane-left-tools">
          <div className="pane-more-menu-wrap" ref={paneMoreMenuRef} onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              title="Pane actions"
              aria-haspopup="menu"
              aria-expanded={paneMoreMenuOpen}
              onClick={() => setPaneMoreMenuOpen((open) => !open)}
            >
              <MenuIcon />
            </button>
            {paneMoreMenuOpen && (
              <div className="pane-more-menu" role="menu">
                <button
                  className="pane-more-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPaneMoreMenuOpen(false);
                    onPushToOverlay(pane.paneId);
                  }}
                >
                  <AgentOverlayIcon />
                  {isPinned ? 'Remove from Floating Bar' : 'Show in Floating Bar'}
                </button>
                <button
                  className="pane-more-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPaneMoreMenuOpen(false);
                    openSearch();
                  }}
                >
                  <SearchIcon />
                  Search
                </button>
              </div>
            )}
          </div>

          {onToggleMaximize && (
            <button
              className={`pane-maximize-button ${maximizedPaneId === pane.paneId ? 'is-maximized' : ''}`}
              type="button"
              title={maximizedPaneId === pane.paneId ? 'Exit full screen' : 'Full screen'}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onToggleMaximize(pane.paneId)}
            >
              {maximizedPaneId === pane.paneId ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>
          )}
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
            <div className="pane-editor-shell-info" style={{ marginTop: '10px', marginBottom: '4px' }}>
              <span className="pane-editor-label" style={{ fontSize: '9px', opacity: 0.8 }}>Active Shell</span>
              <div className="pane-editor-shell-value">
                <ShellIcon name={paneShellOption.icon} />
                <span>{paneShellOption.label}</span>
                <span style={{ fontSize: '10px', color: 'var(--color-muted)', marginLeft: 'auto' }}>
                  {paneShellOption.shell}
                </span>
              </div>
            </div>
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
            <div className="pane-search-box">
              <SearchIcon />
              <input
                ref={searchInputRef}
                className="pane-search-input"
                type="search"
                value={searchQuery}
                placeholder="Search"
                spellCheck={false}
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
                className="pane-search-clear"
                type="button"
                title="Clear search"
                disabled={!searchQuery}
                onClick={() => {
                  setSearchQuery('');
                  setSearchError(null);
                  setSearchResultCount(0);
                  setSearchResultIndex(null);
                  searchInputRef.current?.focus();
                }}
              >
                <SearchCloseIcon />
              </button>
            </div>
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
              <SearchArrowUpIcon />
            </button>
            <button
              className="pane-search-nav"
              type="button"
              title="Next match"
              onClick={() => runSearch('next')}
            >
              <SearchArrowDownIcon />
            </button>
            <button className="pane-search-close" type="button" title="Close search" onClick={closeSearch}>
              <SearchCloseIcon />
            </button>
            {searchError && <span className="pane-search-status">{searchError}</span>}
          </div>
        )}
        <div className="pane-actions">
          <button type="button" title="Split right" onClick={() => onSplit(pane.paneId, 'row')}>
            <SplitRightIcon />
          </button>
          <button type="button" title="Split down" onClick={() => onSplit(pane.paneId, 'column')}>
            <SplitDownIcon />
          </button>
          <button type="button" title="Close pane" onClick={() => onClose(pane.paneId)} disabled={!canClose}>
            <CloseIcon />
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

