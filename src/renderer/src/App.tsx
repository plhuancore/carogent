import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from 'react';
import type {
  AgentBridgePane,
  AgentBridgeRendererResponse,
  BrowserBridgeStatusEvent,
  TerminalShellOption
} from '../../shared/ipcTypes';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import type { ISearchOptions } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  closePane,
  countPanes,
  findPane,
  getFirstPaneId,
  LayoutNode,
  listPaneIds,
  PaneNode,
  resizeSplit,
  SplitDirection,
  splitPane,
  updatePane
} from './layout';
import {
  createEmptyWorkspace,
  loadWorkspaceStore,
  QuickAccessItem,
  saveWorkspaceStore,
  WorkspaceState
} from './storage';
import carogentLogoUrl from './assets/carogent-logo-v2.png';
import { GitPanel } from './GitPanel';
import {
  AgentOverlayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  CodeIcon,
  CommandPaletteIcon,
  GitIcon,
  McpIcon,
  QuickAccessIcon,
  SearchIcon,
  SettingsIcon,
  ShellIcon,
  SplitDownIcon,
  SplitRightIcon,
  WrenchIcon
} from './components/AppIcons';
import { CurrentFolderTree } from './components/CurrentFolderTree';
import { FileEditorWorkspace } from './components/FileEditorWorkspace';
import { SearchPanel } from './components/SearchPanel';
import { McpSettingsModal } from './components/McpSettingsModal';
import { PinnedFolderPanel } from './components/PinnedFolderPanel';
import { QuickAccessManager, QuickAccessPalette } from './components/QuickAccess';
import { NodeView } from './components/TerminalViews';
import { WorkspaceItem } from './components/WorkspaceItem';
import { scorePaletteItemMatch, type CommandPaletteItem, type PaletteMode } from './commandPalette';
import {
  captureTerminalScroll,
  clearTerminalFitTimers,
  copyTerminalSelection,
  createXterm,
  getDefaultShellOption,
  getPaneShell,
  getShellOption,
  getShellTitle,
  getTerminalPreviewLines,
  scheduleTerminalFit,
  scheduleTerminalScrollRestore,
  type SessionRegistry,
  type TerminalSession
} from './terminalHelpers';
import './styles.css';

type AgentDoneItem = {
  paneId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  cwd?: string;
  lines?: string[];
  notifyTimestamp?: number;
  hasUnreadNotification?: boolean;
};

const WORKSPACE_COLOR_PRESETS = [
  '#a78bfa',
  '#8bb9ff',
  '#8b5cf6',
  '#f0abfc',
  '#f5c77a',
  '#8ee6b0',
  '#a7a0b8',
  '#131217'
];

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

const OVERLAY_PREVIEW_UPDATE_MS = 1000;

function getHeaderColor(color?: string): string {
  return color && HEADER_COLOR_PRESETS.includes(color) ? color : HEADER_COLOR_PRESETS[0];
}

function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
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

function getNextWorkspaceName(workspaces: WorkspaceState[]): string {
  let index = workspaces.length + 1;
  const names = new Set(workspaces.map((workspace) => workspace.name));

  while (names.has(`Project ${index}`)) {
    index += 1;
  }

  return `Project ${index}`;
}

function escapeTerminalPath(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')) {
    return `"${path.replace(/"/g, '\\"')}"`;
  }

  return `'${path.replace(/'/g, "'\\''")}'`;
}

function WorkspaceTabIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px' }}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M15 12h3" />
      <path d="M15 16h2" />
    </svg>
  );
}

function FolderTabIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px' }}>
      <path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
      <path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" />
      <path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
    </svg>
  );
}

function GitCustomIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px' }}>
      <path d="M15 6a9 9 0 0 0-9 9V3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
    </svg>
  );
}

function App(): JSX.Element {
  const initialStore = useMemo(() => loadWorkspaceStore(), []);
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>(() => initialStore.workspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => initialStore.activeWorkspaceId);
  const [pinnedDirectory, setPinnedDirectory] = useState(() => initialStore.pinnedDirectory || '');
  const [pinnedFolderCollapsed, setPinnedFolderCollapsed] = useState(
    () => initialStore.pinnedFolderCollapsed || false
  );
  const [quickAccessItems, setQuickAccessItems] = useState<QuickAccessItem[]>(
    () => initialStore.quickAccessItems || []
  );
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [quickAccessQuery, setQuickAccessQuery] = useState('');
  const [quickAccessSelectedIndex, setQuickAccessSelectedIndex] = useState(0);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('quick-access');
  const [quickAccessManagerOpen, setQuickAccessManagerOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchCaseSensitive, setGlobalSearchCaseSensitive] = useState(false);
  const [globalSearchWholeWord, setGlobalSearchWholeWord] = useState(false);
  const [globalSearchUseRegex, setGlobalSearchUseRegex] = useState(false);
  const [fileSearchResults, setFileSearchResults] = useState<CommandPaletteItem[]>([]);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);
  const [shellOptions, setShellOptions] = useState<TerminalShellOption[] | null>(null);
  const [shellOptionsError, setShellOptionsError] = useState<string | null>(null);
  const [defaultShell, setDefaultShell] = useState<string>(() => {
    return localStorage.getItem('carogent-default-shell') || '';
  });

  const handleSetDefaultShell = useCallback((shell: string) => {
    localStorage.setItem('carogent-default-shell', shell);
    setDefaultShell(shell);
  }, []);
  const activeDefaultShell = useMemo(() => {
    if (defaultShell) return defaultShell;
    if (shellOptions?.length) {
      return getDefaultShellOption(shellOptions).shell;
    }
    return '';
  }, [defaultShell, shellOptions]);

  const [agentOverlayVisible, setAgentOverlayVisible] = useState(false);
  const [browserBridgeStatus, setBrowserBridgeStatus] = useState<BrowserBridgeStatusEvent>({
    connected: false,
    clientCount: 0,
    enabled: true
  });
  const [leftSidebarTab, setLeftSidebarTab] = useState<'workspace' | 'explorer' | 'git' | null>('workspace');
  const [isExplorerSidebarOpen, setIsExplorerSidebarOpenState] = useState(false);
  const setIsExplorerSidebarOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setIsExplorerSidebarOpenState((prev) => {
      const next = typeof open === 'function' ? open(prev) : open;
      if (next) {
        setLeftSidebarTab((currTab) => (currTab === 'git' ? 'git' : 'explorer'));
      } else {
        setLeftSidebarTab('workspace');
      }
      return next;
    });
  }, []);

  const isGitSidebarOpen = leftSidebarTab === 'git';
  const setIsGitSidebarOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setLeftSidebarTab((prevTab) => {
      const isOpen = prevTab === 'git';
      const nextOpen = typeof open === 'function' ? open(isOpen) : open;
      if (!nextOpen) {
        setIsExplorerSidebarOpenState(false);
        return 'workspace';
      }
      return 'git';
    });
  }, []);
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'explorer' | 'search'>('explorer');
  const [activeEditorFilePath, setActiveEditorFilePath] = useState('');
  const [activeEditorLineNumber, setActiveEditorLineNumber] = useState<number | undefined>(undefined);
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);
  const [gitSidebarWidth, setGitSidebarWidth] = useState(380);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('carogent-left-sidebar-width');
    const parsed = saved ? parseInt(saved, 10) : 244;
    return Number.isFinite(parsed) ? Math.max(160, Math.min(600, parsed)) : 244;
  });

  const handleCommitSearchHighlight = useCallback((options: {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
  }) => {
    setGlobalSearchQuery(options.query);
    setGlobalSearchCaseSensitive(options.caseSensitive);
    setGlobalSearchWholeWord(options.wholeWord);
    setGlobalSearchUseRegex(options.useRegex);
  }, []);

  const handleLeftResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    let latestWidth = leftSidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const newWidth = moveEvent.clientX;
      const constrainedWidth = Math.max(160, Math.min(600, newWidth));
      latestWidth = constrainedWidth;
      setLeftSidebarWidth(constrainedWidth);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      localStorage.setItem('carogent-left-sidebar-width', latestWidth.toString());
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
  const sessions = useRef<SessionRegistry>(new Map());
  const pinnedPaneIdsRef = useRef<Set<string>>(new Set());
  const [pinnedPaneIds, setPinnedPaneIds] = useState<Set<string>>(new Set());
  const overlayUpdateTimers = useRef<Map<string, number>>(new Map());
  const workspacesRef = useRef<WorkspaceState[]>(workspaces);
  const shellOptionsRef = useRef<TerminalShellOption[] | null>(shellOptions);
  const quickAccessInputRef = useRef<HTMLInputElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const islandSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [islandSettingsMenuOpen, setIslandSettingsMenuOpen] = useState(false);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0];
  const layout = activeWorkspace.layout;
  const activePaneId = findPane(layout, activeWorkspace.activePaneId)
    ? activeWorkspace.activePaneId
    : getFirstPaneId(layout);
  const paneCount = useMemo(() => countPanes(layout), [layout]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    shellOptionsRef.current = shellOptions;
  }, [shellOptions]);

  useEffect(() => {
    saveWorkspaceStore({
      activeWorkspaceId: activeWorkspace.id,
      workspaces,
      pinnedDirectory,
      pinnedFolderCollapsed,
      quickAccessItems
    });
  }, [activeWorkspace.id, pinnedDirectory, pinnedFolderCollapsed, quickAccessItems, workspaces]);

  const updateActiveWorkspace = useCallback(
    (updater: (workspace: WorkspaceState) => WorkspaceState) => {
      setWorkspaces((current) =>
        current.map((workspace) => (workspace.id === activeWorkspaceId ? updater(workspace) : workspace))
      );
    },
    [activeWorkspaceId]
  );

  const updatePaneInAnyWorkspace = useCallback(
    (paneId: string, updater: (pane: PaneNode, workspace: WorkspaceState) => PaneNode) => {
      setWorkspaces((current) =>
        current.map((workspace) => {
          if (!findPane(workspace.layout, paneId)) {
            return workspace;
          }

          return {
            ...workspace,
            layout: updatePane(workspace.layout, paneId, (pane) => updater(pane, workspace))
          };
        })
      );
    },
    []
  );

  const getAgentDoneItem = useCallback(
    (paneId: string): AgentDoneItem | null => {
      for (const workspace of workspacesRef.current) {
        const pane = findPane(workspace.layout, paneId);

        if (pane) {
          const currentShellOptions = shellOptionsRef.current;

          return {
            paneId,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            title:
              pane.customTitle ||
              pane.title ||
              (currentShellOptions?.length ? getShellTitle(currentShellOptions, pane.shell) : 'terminal'),
            cwd: sessions.current.get(paneId)?.cwd || pane.cwd
          };
        }
      }

      return null;
    },
    []
  );

  const handlePushToOverlay = useCallback(
    (paneId: string) => {
      const doneItem = getAgentDoneItem(paneId);
      if (doneItem) {
        const session = sessions.current.get(paneId);
        if (session) {
          doneItem.lines = getTerminalPreviewLines(session);
        }
        window.terminalApi
          .showAgentDoneOverlay(doneItem)
          .then((paneIds) => {
            const nextIds = new Set(paneIds);
            pinnedPaneIdsRef.current = nextIds;
            setPinnedPaneIds(nextIds);
          })
          .catch(() => {});
      }
    },
    [getAgentDoneItem]
  );

  const handleTogglePinShell = useCallback(
    (paneId: string) => {
      if (pinnedPaneIdsRef.current.has(paneId)) {
        window.terminalApi
          .unpinAgentDonePane(paneId)
          .then((paneIds) => {
            const nextIds = new Set(paneIds);
            pinnedPaneIdsRef.current = nextIds;
            setPinnedPaneIds(nextIds);
          })
          .catch(() => {});
      } else {
        handlePushToOverlay(paneId);
      }
    },
    [handlePushToOverlay]
  );

  const triggerOverlayUpdate = useCallback(
    (paneId: string) => {
      if (overlayUpdateTimers.current.has(paneId)) {
        return;
      }

      const timer = window.setTimeout(() => {
        overlayUpdateTimers.current.delete(paneId);

        if (!pinnedPaneIdsRef.current.has(paneId)) {
          return;
        }

        const doneItem = getAgentDoneItem(paneId);
        if (doneItem) {
          const session = sessions.current.get(paneId);
          if (session) {
            doneItem.lines = getTerminalPreviewLines(session);
          }
          window.terminalApi
            .showAgentDoneOverlay(doneItem)
            .then((paneIds) => {
              pinnedPaneIdsRef.current = new Set(paneIds);
            })
            .catch(() => {});
        }
      }, OVERLAY_PREVIEW_UPDATE_MS);

      overlayUpdateTimers.current.set(paneId, timer);
    },
    [getAgentDoneItem]
  );

  useEffect(() => {
    window.terminalApi
      .getShellOptions()
      .then((options) => {
        setShellOptions(options);
        setShellOptionsError(null);
      })
      .catch((error: unknown) => {
        setShellOptionsError(String(error));
      });
  }, []);

  useEffect(() => {
    window.terminalApi.getAgentDoneOverlayVisible().then(setAgentOverlayVisible).catch(() => {
      setAgentOverlayVisible(false);
    });
  }, []);

  useEffect(() => {
    const stopListening = window.terminalApi.onAgentDoneOverlayVisible(setAgentOverlayVisible);
    return stopListening;
  }, []);

  useEffect(() => {
    window.terminalApi.getAgentDoneOverlayItems().then((items) => {
      const paneIds = items.map((item) => item.paneId);
      const nextIds = new Set(paneIds);
      pinnedPaneIdsRef.current = nextIds;
      setPinnedPaneIds(nextIds);
    }).catch(() => {});

    const stopListening = window.terminalApi.onAgentDoneOverlayPinnedPaneIds((paneIds) => {
      const nextIds = new Set(paneIds);
      pinnedPaneIdsRef.current = nextIds;
      setPinnedPaneIds(nextIds);
    });
    return stopListening;
  }, []);

  useEffect(() => {
    window.terminalApi.getBrowserBridgeStatus().then(setBrowserBridgeStatus).catch(() => {
      setBrowserBridgeStatus({ connected: false, clientCount: 0, enabled: true });
    });

    return window.terminalApi.onBrowserBridgeStatus(setBrowserBridgeStatus);
  }, []);

  useEffect(() => {
    const panes: AgentBridgePane[] = [];

    for (const workspace of workspaces) {
      for (const paneId of listPaneIds(workspace.layout)) {
        const pane = findPane(workspace.layout, paneId);

        if (!pane) {
          continue;
        }

        const session = sessions.current.get(paneId);
        const title =
          pane.customTitle ||
          pane.title ||
          (shellOptions?.length ? getShellTitle(shellOptions, pane.shell) : 'terminal');

        panes.push({
          paneId,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          title,
          cwd: session?.cwd || pane.cwd,
          shell: session?.shell || pane.shell,
          browserUrl: pane.browserUrl,
          active: workspace.id === activeWorkspaceId && paneId === activePaneId,
          pinned: pinnedPaneIds.has(paneId),
          running: session?.status === 'running'
        });
      }
    }

    window.terminalApi
      .updateAgentBridgeSnapshot({
        activeWorkspaceId,
        activePaneId,
        workspaces: workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          active: workspace.id === activeWorkspaceId
        })),
        panes
      })
      .catch(() => {});
  }, [activePaneId, activeWorkspaceId, pinnedPaneIds, shellOptions, workspaces]);

  useEffect(() => {
    return window.terminalApi.onAgentBridgeRequest((request) => {
      const complete = (response: Omit<AgentBridgeRendererResponse, 'id'>): void => {
        window.terminalApi.completeAgentBridgeRequest({ id: request.id, ...response }).catch(() => {});
      };

      try {
        if (request.action === 'focusPane') {
          setActiveWorkspaceId(request.workspaceId || activeWorkspaceId);
          setWorkspaces((current) =>
            current.map((workspace) =>
              workspace.id === (request.workspaceId || activeWorkspaceId)
                ? {
                    ...workspace,
                    activePaneId: request.paneId,
                    maximizedPaneId: workspace.maximizedPaneId === request.paneId ? workspace.maximizedPaneId : undefined
                  }
                : workspace
            )
          );

          const session = sessions.current.get(request.paneId);
          if (session) {
            window.setTimeout(() => session.terminal.focus(), 0);
          }

          complete({ result: { paneId: request.paneId, workspaceId: request.workspaceId || activeWorkspaceId } });
          return;
        }

        if (request.action === 'notifyDone') {
          const doneItem = getAgentDoneItem(request.paneId);

          if (!doneItem) {
            complete({ error: `Pane not found: ${request.paneId}` });
            return;
          }

          const session = sessions.current.get(request.paneId);

          if (session) {
            doneItem.lines = getTerminalPreviewLines(session);
          }

          doneItem.notifyTimestamp = Date.now();

          window.terminalApi
            .showAgentDoneOverlay(doneItem)
            .then((paneIds) => {
              const nextIds = new Set(paneIds);
              pinnedPaneIdsRef.current = nextIds;
              setPinnedPaneIds(nextIds);
              complete({ result: { paneId: request.paneId, pinnedPaneIds: paneIds } });
            })
            .catch((error: unknown) => complete({ error: String(error) }));
          return;
        }

        if (request.action === 'splitPane') {
          const targetPaneId = request.paneId;
          const direction = request.direction || 'row';
          const title = request.title;

          let newPaneId = '';
          updateActiveWorkspace((workspace) => {
            const runtimeCwd = sessions.current.get(targetPaneId)?.cwd;
            const layoutForSplit = runtimeCwd
              ? updatePane(workspace.layout, targetPaneId, (pane) => ({
                  ...pane,
                  cwd: runtimeCwd
                }))
              : workspace.layout;
            const result = splitPane(layoutForSplit, targetPaneId, direction);
            newPaneId = result.newPaneId;

            let nextLayout = result.layout;
            if (title) {
              nextLayout = updatePane(nextLayout, newPaneId, (pane) => ({
                ...pane,
                customTitle: title
              }));
            }

            return {
              ...workspace,
              layout: nextLayout,
              activePaneId: newPaneId,
              maximizedPaneId: undefined
            };
          });

          complete({ result: { paneId: newPaneId } });
          return;
        }

        complete({ error: `Unknown renderer action: ${request.action}` });
      } catch (error) {
        complete({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }, [activeWorkspaceId, getAgentDoneItem, updateActiveWorkspace]);

  useEffect(() => {
    const stopData = window.terminalApi.onData(({ id, data }) => {
      for (const [paneId, session] of sessions.current) {
        if (session.terminalId === id) {
          session.terminal.write(data);

          if (pinnedPaneIdsRef.current.has(paneId)) {
            triggerOverlayUpdate(paneId);
          }
          break;
        }
      }
    });

    const stopCwd = window.terminalApi.onCwd(({ id, cwd }) => {
      for (const [paneId, session] of sessions.current) {
        if (session.terminalId === id) {
          session.cwd = cwd;
          updatePaneInAnyWorkspace(paneId, (currentPane) => ({
            ...currentPane,
            cwd
          }));
          break;
        }
      }
    });

    const stopExit = window.terminalApi.onExit(({ id, exitCode }) => {
      for (const session of sessions.current.values()) {
        if (session.terminalId === id) {
          session.status = 'exited';
          session.terminal.writeln('');
          session.terminal.writeln(`[process exited with code ${exitCode}]`);
          break;
        }
      }
    });

    return () => {
      stopData();
      stopCwd();
      stopExit();

      for (const [paneId, session] of sessions.current) {
        if (session.terminalId) {
          window.terminalApi.kill(session.terminalId);
        }

        clearTerminalFitTimers(session);
        session.input.dispose();
        session.terminal.dispose();
        sessions.current.delete(paneId);
      }

      for (const timer of overlayUpdateTimers.current.values()) {
        window.clearTimeout(timer);
      }

      overlayUpdateTimers.current.clear();
    };
  }, [triggerOverlayUpdate, updatePaneInAnyWorkspace]);

  const ensureSession = useCallback((pane: PaneNode): TerminalSession => {
    const existing = sessions.current.get(pane.paneId);

    if (existing) {
      return existing;
    }

    if (!shellOptions?.length) {
      throw new Error('Shell options are not ready.');
    }

    const terminal = createXterm();
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    const session: TerminalSession = {
      terminal,
      fitAddon,
      searchAddon,
      status: 'starting',
      input: terminal.onData((data) => {
        if (session.terminalId && session.status !== 'exited') {
          window.terminalApi.write({ id: session.terminalId, data });
        }
      })
    };

    terminal.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase();
      const copyShortcut =
        event.type === 'keydown' &&
        ((isMacPlatform() && event.metaKey && !event.ctrlKey && key === 'c') ||
          (!isMacPlatform() && event.ctrlKey && !event.metaKey && key === 'c'));
      const pasteShortcut =
        event.type === 'keydown' &&
        ((isMacPlatform() && event.metaKey && !event.ctrlKey && key === 'v') ||
          (!isMacPlatform() && event.ctrlKey && !event.metaKey && key === 'v') ||
          (event.shiftKey && key === 'insert'));

      if (copyShortcut) {
        if (!copyTerminalSelection(terminal)) {
          return true;
        }

        event.preventDefault();

        return false;
      }

      if (!pasteShortcut) {
        return true;
      }

      event.preventDefault();

      const clipboardText = window.terminalApi.readClipboardText();

      if (clipboardText && session.terminalId && session.status !== 'exited') {
        window.terminalApi.write({
          id: session.terminalId,
          data: clipboardText.replace(/\r?\n/g, '\r')
        });
      }

      return false;
    });

    sessions.current.set(pane.paneId, session);

    const requestedShell = getPaneShell(shellOptions, pane);

    window.terminalApi
      .create({ cwd: pane.cwd, shell: requestedShell, paneId: pane.paneId })
      .then(({ id, cwd, shell }) => {
        session.terminalId = id;
        session.cwd = cwd;
        session.shell = shell;
        session.status = 'running';
        updatePaneInAnyWorkspace(pane.paneId, (currentPane) => ({
          ...currentPane,
          cwd,
          shell,
          title: currentPane.customTitle ? currentPane.title : getShellTitle(shellOptions, shell)
        }));
      })
      .catch((error: unknown) => {
        session.status = 'exited';
        terminal.writeln(`Failed to start terminal: ${String(error)}`);
      });

    return session;
  }, [shellOptions, updatePaneInAnyWorkspace]);

  const killPaneSession = useCallback((paneId: string): void => {
    const session = sessions.current.get(paneId);

    if (!session) {
      return;
    }

    if (session.terminalId) {
      window.terminalApi.kill(session.terminalId);
    }

    clearTerminalFitTimers(session);
    session.input.dispose();
    session.terminal.dispose();
    sessions.current.delete(paneId);
  }, []);

  const handleSplit = useCallback((paneId: string, direction: SplitDirection) => {
    updateActiveWorkspace((workspace) => {
      const runtimeCwd = sessions.current.get(paneId)?.cwd;
      const layoutForSplit = runtimeCwd
        ? updatePane(workspace.layout, paneId, (pane) => ({
            ...pane,
            cwd: runtimeCwd
          }))
        : workspace.layout;
      const result = splitPane(layoutForSplit, paneId, direction);

      return {
        ...workspace,
        layout: result.layout,
        activePaneId: result.newPaneId,
        maximizedPaneId: undefined
      };
    });
  }, [updateActiveWorkspace]);

  const handleClose = useCallback(
    (paneId: string) => {
      if (countPanes(layout) <= 1) {
        return;
      }

      const nextLayout = closePane(layout, paneId);
      killPaneSession(paneId);
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        layout: nextLayout,
        activePaneId: getFirstPaneId(nextLayout),
        maximizedPaneId: workspace.maximizedPaneId === paneId ? undefined : workspace.maximizedPaneId
      }));
    },
    [killPaneSession, layout, updateActiveWorkspace]
  );

  const handleToggleMaximize = useCallback(
    (paneId: string) => {
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        activePaneId: paneId,
        maximizedPaneId: workspace.maximizedPaneId === paneId ? undefined : paneId
      }));
    },
    [updateActiveWorkspace]
  );

  const handleResize = useCallback((path: string, firstSize: number) => {
    updateActiveWorkspace((workspace) => ({
      ...workspace,
      layout: resizeSplit(workspace.layout, path, firstSize)
    }));
  }, [updateActiveWorkspace]);

  const handleUpdatePane = useCallback((paneId: string, changes: Partial<PaneNode>) => {
    updateActiveWorkspace((workspace) => ({
      ...workspace,
      layout: updatePane(workspace.layout, paneId, (pane) => ({
        ...pane,
        ...changes
      }))
    }));
  }, [updateActiveWorkspace]);

  const handleChangeShell = useCallback(
    (paneId: string, shell: string) => {
      if (!shellOptions?.length) {
        return;
      }

      killPaneSession(paneId);
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        layout: updatePane(workspace.layout, paneId, (pane) => ({
          ...pane,
          shell,
          title: pane.customTitle ? pane.title : getShellTitle(shellOptions, shell)
        }))
      }));
    },
    [killPaneSession, shellOptions, updateActiveWorkspace]
  );

  const handleActivatePane = useCallback((paneId: string) => {
    updateActiveWorkspace((workspace) => ({
      ...workspace,
      activePaneId: paneId
    }));
  }, [updateActiveWorkspace]);

  const handleAddWorkspace = useCallback(() => {
    const workspace = createEmptyWorkspace(getNextWorkspaceName(workspaces));

    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceId(workspace.id);
  }, [workspaces]);

  const handleRenameWorkspace = useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim();

    if (!nextName) {
      return;
    }

    setWorkspaces((current) =>
      current.map((workspace) => (workspace.id === workspaceId ? { ...workspace, name: nextName } : workspace))
    );
  }, []);

  const handleUpdateWorkspaceColor = useCallback((workspaceId: string, color: string) => {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, color: color === WORKSPACE_COLOR_PRESETS[0] ? undefined : color }
          : workspace
      )
    );
  }, []);

  const handleDeleteWorkspace = useCallback(
    (workspaceId: string) => {
      if (workspaces.length <= 1) {
        return;
      }

      const workspace = workspaces.find((item) => item.id === workspaceId);

      if (!workspace) {
        return;
      }

      for (const paneId of listPaneIds(workspace.layout)) {
        killPaneSession(paneId);
      }

      const deleteIndex = workspaces.findIndex((item) => item.id === workspaceId);
      const nextWorkspaces = workspaces.filter((item) => item.id !== workspaceId);

      setWorkspaces(nextWorkspaces);

      if (workspaceId === activeWorkspaceId) {
        const nextActiveIndex = Math.min(deleteIndex, nextWorkspaces.length - 1);
        setActiveWorkspaceId(nextWorkspaces[nextActiveIndex].id);
      }
    },
    [activeWorkspaceId, killPaneSession, workspaces]
  );

  const activePane = findPane(layout, activePaneId) || findPane(layout, getFirstPaneId(layout));
  const activePaneCwd = sessions.current.get(activePaneId)?.cwd || activePane?.cwd || '';
  const paneIds = listPaneIds(layout);
  const activePaneTitle =
    activePane?.customTitle ||
    activePane?.title ||
    (shellOptions?.length ? getDefaultShellOption(shellOptions).title : 'terminal');
  const browserBridgeTitle = browserBridgeStatus.connected && !browserBridgeStatus.enabled
    ? 'Browser bridge disabled in extension'
    : browserBridgeStatus.connected
    ? `Browser bridge connected (${browserBridgeStatus.clientCount})`
    : 'Browser bridge disconnected; URL will open normally';

  const handleInsertPath = useCallback(
    (path: string) => {
      if (!activePane) {
        return;
      }

      const session = ensureSession(activePane);
      const input = `${escapeTerminalPath(path)} `;

      if (session.terminalId && session.status !== 'exited') {
        window.terminalApi.write({ id: session.terminalId, data: input });
        window.setTimeout(() => session.terminal.focus(), 0);
        return;
      }

      session.terminal.writeln('');
      session.terminal.writeln('Path will be available after the shell starts.');
    },
    [activePane, ensureSession]
  );

  const handleOpenInVSCode = useCallback(() => {
    const path = activePaneCwd;

    window.terminalApi.openInVSCode({ path });
  }, [activePaneCwd]);

  const handleOpenBrowser = useCallback(() => {
    window.terminalApi.openOrFocusBrowser({ url: activePane?.browserUrl });
  }, [activePane?.browserUrl]);

  const handleToggleAgentOverlay = useCallback(() => {
    const nextVisible = !agentOverlayVisible;

    setAgentOverlayVisible(nextVisible);
    window.terminalApi
      .setAgentDoneOverlayVisible(nextVisible)
      .then((res) => {
        if (typeof res === 'boolean') {
          setAgentOverlayVisible(res);
        }
      })
      .catch(() => setAgentOverlayVisible(agentOverlayVisible));
  }, [agentOverlayVisible]);

  const openQuickAccess = useCallback((mode: PaletteMode = 'quick-access') => {
    setPaletteMode(mode);
    setQuickAccessOpen(true);
    setQuickAccessSelectedIndex(0);
  }, []);

  const closeQuickAccess = useCallback(() => {
    setQuickAccessOpen(false);
    setQuickAccessQuery('');
    setQuickAccessSelectedIndex(0);
    setPaletteMode('quick-access');
  }, []);

  const handleOpenQuickAccessItem = useCallback(
    (item: QuickAccessItem) => {
      window.terminalApi.openOrFocusBrowser({ url: item.domain });
      closeQuickAccess();
    },
    [closeQuickAccess]
  );

  const quickAccessPaletteItems = useMemo<CommandPaletteItem[]>(
    () =>
      quickAccessItems.map((item) => ({
        id: `quick-access-${item.id}`,
        title: item.name,
        subtitle: formatBrowserUrlLabel(item.domain) || item.domain,
        keywords: `quick access browser domain ${item.name} ${item.domain}`,
        icon: 'quick-access',
        run: () => handleOpenQuickAccessItem(item)
      })),
    [handleOpenQuickAccessItem, quickAccessItems]
  );

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const codePath = activePaneCwd || 'Home directory';
    const browserLabel = formatBrowserUrlLabel(activePane?.browserUrl) || 'localhost:3000';

    const items: CommandPaletteItem[] = [
      {
        id: 'open-browser',
        title: 'Browser: Open in Browser',
        subtitle: browserLabel,
        keywords: `browser web chrome open url localhost ${activePane?.browserUrl || ''}`,
        icon: 'browser',
        run: () => {
          handleOpenBrowser();
          closeQuickAccess();
        }
      },
      {
        id: 'open-vscode',
        title: 'VS Code: Open in VS Code',
        subtitle: codePath,
        keywords: `vscode vs code editor open workspace folder ${codePath}`,
        icon: 'code',
        run: () => {
          handleOpenInVSCode();
          closeQuickAccess();
        }
      },
      {
        id: 'toggle-floating-bar',
        title: agentOverlayVisible ? 'Floating Bar: Hide Floating Bar' : 'Floating Bar: Show Floating Bar',
        subtitle: 'Toggle sticky overlay bar visibility',
        keywords: `floating bar sticky overlay show hide toggle settings visual window visibility ${agentOverlayVisible ? 'hide' : 'show'}`,
        icon: 'agent-overlay',
        run: () => {
          handleToggleAgentOverlay();
          closeQuickAccess();
        }
      },
      {
        id: 'toggle-git-control',
        title: isGitSidebarOpen ? 'Git: Hide Git Control' : 'Git: Show Git Control',
        subtitle: 'Toggle Git sidebar panel visibility',
        keywords: `git control sidebar show hide toggle repository branch diff changes version control ${isGitSidebarOpen ? 'hide' : 'show'}`,
        icon: 'git',
        run: () => {
          setIsGitSidebarOpen((open) => !open);
          closeQuickAccess();
        }
      },
      {
        id: 'toggle-explorer-sidebar',
        title: isExplorerSidebarOpen ? 'Explorer: Hide Folder Explorer' : 'Explorer: Show Folder Explorer',
        subtitle: 'Toggle current folder explorer panel visibility',
        keywords: `explorer folder workspace current directory file tree sidebar show hide toggle secondary Wrench ${isExplorerSidebarOpen ? 'hide' : 'show'}`,
        icon: 'folder',
        run: () => {
          setIsExplorerSidebarOpen((open) => !open);
          closeQuickAccess();
        }
      },
      {
        id: 'git-refresh',
        title: 'Git: Refresh',
        subtitle: 'Refresh Git repository status and history',
        keywords: 'git refresh reload update status sync history repository changes',
        icon: 'git',
        run: () => {
          setGitRefreshTrigger((prev) => prev + 1);
          setIsGitSidebarOpen(true);
          closeQuickAccess();
        }
      },
      {
        id: 'git-undo-last-commit',
        title: 'Git: Undo Last Commit',
        subtitle: 'Undo the last commit (soft reset HEAD~1, keep changes staged)',
        keywords: 'git undo last commit reset soft head changes staged repository',
        icon: 'git',
        run: async () => {
          const activeCwd = sessions.current.get(activePaneId)?.cwd || activePane?.cwd;
          if (!activeCwd) return;
          try {
            const undoneMessage = await window.terminalApi.gitUndoLastCommit({ cwd: activeCwd });
            if (undoneMessage) {
              window.dispatchEvent(new CustomEvent('git-undone-commit', { detail: { message: undoneMessage } }));
            }
            setGitRefreshTrigger((prev) => prev + 1);
            setIsGitSidebarOpen(true);
          } catch (err: any) {
            alert('Failed to undo last commit: ' + (err?.message || err));
          }
          closeQuickAccess();
        }
      }
    ];
    if (activePaneId) {
      const isPinned = pinnedPaneIds.has(activePaneId);
      items.push({
        id: 'pin-current-shell',
        title: isPinned ? 'Floating Bar: Unpin Current Shell from Floating Bar' : 'Floating Bar: Pin Current Shell to Floating Bar',
        subtitle: activePane?.title || 'Active shell',
        keywords: `${isPinned ? 'unpin remove delete' : 'pin push show add'} current shell floating bar overlay sticky active pane terminal`,
        icon: 'agent-overlay',
        run: () => {
          handleTogglePinShell(activePaneId);
          closeQuickAccess();
        }
      });

      const isMaximized = activeWorkspace.maximizedPaneId === activePaneId;
      items.push({
        id: 'toggle-fullscreen-shell',
        title: isMaximized ? 'Terminal: Exit Full Screen Shell' : 'Terminal: Full Screen Shell',
        subtitle: activePane?.title || 'Active shell',
        keywords: `${isMaximized ? 'minimize exit shrink restore normal' : 'maximize zoom expand fullscreen full screen'} current shell active pane terminal`,
        icon: 'quick-access',
        run: () => {
          handleToggleMaximize(activePaneId);
          closeQuickAccess();
        }
      });
    }

    return items;
  }, [
    activePane?.browserUrl,
    activePane?.cwd,
    activePane?.title,
    activePaneCwd,
    activePaneId,
    closeQuickAccess,
    handleOpenBrowser,
    handleOpenInVSCode,
    agentOverlayVisible,
    handleToggleAgentOverlay,
    handleTogglePinShell,
    pinnedPaneIds,
    isGitSidebarOpen,
    setGitRefreshTrigger,
    activeWorkspace.maximizedPaneId,
    handleToggleMaximize
  ]);
  const effectivePaletteMode: PaletteMode = quickAccessQuery.trimStart().startsWith('>')
    ? 'command'
    : paletteMode;

  const isSearchingFiles =
    effectivePaletteMode === 'file' ||
    (effectivePaletteMode === 'quick-access' &&
      (quickAccessQuery.includes('/') ||
        quickAccessQuery.includes('\\') ||
        /:\d+$/.test(quickAccessQuery) ||
        /^[A-Za-z]:/.test(quickAccessQuery)));

  useEffect(() => {
    if (!quickAccessOpen || !isSearchingFiles || !activePaneCwd) {
      setFileSearchResults([]);
      return;
    }

    let isCurrent = true;
    let cleanQuery = quickAccessQuery.trim();
    let targetLineNumber: number | undefined = undefined;

    // Check if query matches pattern: <file_path>:<line_number>
    const match = cleanQuery.match(/^(.*?):(\d+)$/);
    if (match) {
      cleanQuery = match[1].trim();
      targetLineNumber = parseInt(match[2], 10);
    }

    window.terminalApi
      .findFiles({ rootPath: activePaneCwd, query: cleanQuery })
      .then((res) => {
        if (!isCurrent) return;
        if (res.results) {
          const items: CommandPaletteItem[] = res.results
            .filter((file) => file.type === 'file')
            .map((file) => ({
              id: `file-search-${file.path}`,
              title: file.name,
              subtitle: file.relativeFilePath.split(/[\\/]/).slice(0, -1).join('/') || '.',
              keywords: `${file.name} ${file.relativeFilePath}`,
              icon: 'code',
              run: () => {
                let line = targetLineNumber;
                const clickMatch = quickAccessQuery.trim().match(/^(.*?):(\d+)$/);
                if (clickMatch) {
                  line = parseInt(clickMatch[2], 10);
                }

                setActiveEditorFilePath(file.path);
                setActiveEditorLineNumber(line);
                setIsExplorerSidebarOpen(true);
                closeQuickAccess();
              }
            }));
          setFileSearchResults(items);
        }
      })
      .catch((err) => {
        console.error('Failed to search files:', err);
      });

    return () => {
      isCurrent = false;
    };
  }, [quickAccessOpen, isSearchingFiles, activePaneCwd, quickAccessQuery, closeQuickAccess]);

  const filteredPaletteItems = useMemo(() => {
    if (isSearchingFiles) {
      return fileSearchResults;
    }

    const rawQuery =
      effectivePaletteMode === 'command' && quickAccessQuery.trimStart().startsWith('>')
        ? quickAccessQuery.trimStart().slice(1)
        : quickAccessQuery;
    const query = rawQuery.trim();
    const sourceItems = effectivePaletteMode === 'command' ? commandPaletteItems : quickAccessPaletteItems;

    if (!query) {
      return sourceItems;
    }

    const terms = query.split(/\s+/).filter(Boolean);

    return sourceItems
      .map((item, index) => ({ item, index, score: scorePaletteItemMatch(item, terms) }))
      .filter((match) => match.score > 0)
      .sort((first, second) => second.score - first.score || first.index - second.index)
      .map((match) => match.item);
  }, [commandPaletteItems, effectivePaletteMode, quickAccessPaletteItems, quickAccessQuery, fileSearchResults]);

  const handleSaveQuickAccessItem = useCallback((item: QuickAccessItem) => {
    const name = item.name.trim();
    const domain = item.domain.trim();

    if (!name || !domain) {
      return;
    }

    setQuickAccessItems((current) => {
      const nextItem = { ...item, name, domain };

      if (current.some((existing) => existing.id === item.id)) {
        return current.map((existing) => (existing.id === item.id ? nextItem : existing));
      }

      return [...current, nextItem];
    });
  }, []);

  const handleDeleteQuickAccessItem = useCallback((itemId: string) => {
    setQuickAccessItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        event.stopPropagation();
        if (isExplorerSidebarOpen && activePaneCwd) {
          openQuickAccess('file');
        } else {
          openQuickAccess(event.shiftKey ? 'command' : 'quick-access');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [openQuickAccess, isExplorerSidebarOpen, activePaneCwd]);

  useEffect(() => {
    if (!quickAccessOpen) {
      return;
    }

    window.setTimeout(() => quickAccessInputRef.current?.focus(), 0);
  }, [quickAccessOpen]);

  useEffect(() => {
    setQuickAccessSelectedIndex(0);
  }, [quickAccessQuery]);

  useEffect(() => {
    if (quickAccessSelectedIndex >= filteredPaletteItems.length) {
      setQuickAccessSelectedIndex(Math.max(0, filteredPaletteItems.length - 1));
    }
  }, [filteredPaletteItems.length, quickAccessSelectedIndex]);

  useEffect(() => {
    if (!settingsMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSettingsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    if (!islandSettingsMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!islandSettingsMenuRef.current?.contains(event.target as Node)) {
        setIslandSettingsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIslandSettingsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [islandSettingsMenuOpen]);

  useEffect(() => {
    return window.terminalApi.onOpenAgentPane(({ workspaceId, paneId }) => {
      setActiveWorkspaceId(workspaceId);
      setWorkspaces((current) =>
        current.map((workspace) => (workspace.id === workspaceId ? { ...workspace, activePaneId: paneId } : workspace))
      );

      const session = sessions.current.get(paneId);
      if (session) {
        window.setTimeout(() => session.terminal.focus(), 0);
      }
    });
  }, []);

  const renderSettingsMenu = (closeMenu: () => void) => (
    <div className="settings-menu" role="menu">
      <button
        className="settings-menu-item"
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu();
          setQuickAccessManagerOpen(true);
        }}
      >
        <QuickAccessIcon />
        Quick Access
      </button>
      <button
        className="settings-menu-item"
        type="button"
        role="menuitemcheckbox"
        aria-checked={agentOverlayVisible}
        onClick={handleToggleAgentOverlay}
      >
        <AgentOverlayIcon />
        Floating Bar
        <span className="settings-menu-check" aria-hidden="true">
          {agentOverlayVisible ? '✓' : ''}
        </span>
      </button>
      <button
        className="settings-menu-item"
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu();
          setMcpSettingsOpen(true);
        }}
      >
        <McpIcon />
        Carogent MCP
      </button>
      <div className="settings-menu-divider" style={{ height: '1px', background: '#2b3038', margin: '6px 0' }} />
      <div className="settings-menu-header" style={{ padding: '4px 10px', fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Default Shell</div>
      {shellOptions?.map((option) => {
        const isSelected = option.shell === activeDefaultShell;
        return (
          <button
            key={option.shell}
            className="settings-menu-item"
            type="button"
            role="menuitemradio"
            aria-checked={isSelected}
            onClick={() => {
              handleSetDefaultShell(option.shell);
            }}
          >
            <ShellIcon name={option.icon} />
            {option.label}
            <span className="settings-menu-check" aria-hidden="true">
              {isSelected ? '✓' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (shellOptionsError) {
    return (
      <main className="app-shell">
        <section className="workspace workspace-full">
          <div className="startup-message">Failed to load shell options: {shellOptionsError}</div>
        </section>
      </main>
    );
  }

  if (!shellOptions?.length) {
    return (
      <main className="app-shell">
        <section className="workspace workspace-full">
          <div className="startup-message">Loading shell options...</div>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${!leftSidebarTab ? 'sidebar-collapsed' : ''}`}
      style={{
        '--sidebar-width': `${leftSidebarWidth}px`,
        '--git-sidebar-width': `${gitSidebarWidth}px`
      } as React.CSSProperties}
    >
      <div className="activity-island">
        <div className="activity-island-top">
          <div className="activity-island-logo">
            <img src={carogentLogoUrl} alt="Carogent" />
          </div>
          <div className="activity-island-divider" />
          <button
            className={`activity-island-btn ${leftSidebarTab === 'workspace' ? 'is-active' : ''}`}
            onClick={() => {
              if (leftSidebarTab === 'workspace') {
                setLeftSidebarTab(null);
              } else {
                setLeftSidebarTab('workspace');
                setIsExplorerSidebarOpenState(false);
              }
            }}
            title="Terminal Workspace"
            type="button"
          >
            <WorkspaceTabIcon />
          </button>
          <button
            className={`activity-island-btn ${leftSidebarTab === 'explorer' ? 'is-active' : ''}`}
            onClick={() => {
              if (leftSidebarTab === 'explorer') {
                setLeftSidebarTab(null);
              } else {
                setLeftSidebarTab('explorer');
              }
            }}
            title="File Explorer"
            type="button"
          >
            <FolderTabIcon />
          </button>
          <button
            className={`activity-island-btn ${leftSidebarTab === 'git' ? 'git-active' : ''}`}
            onClick={() => {
              if (leftSidebarTab === 'git') {
                setLeftSidebarTab(null);
              } else {
                setLeftSidebarTab('git');
              }
            }}
            title="Git Control"
            type="button"
          >
            <GitCustomIcon />
          </button>
        </div>
        <div className="activity-island-bottom">
          <div className="settings-menu-wrap" ref={islandSettingsMenuRef}>
            <button
              className="activity-island-btn"
              onClick={() => setIslandSettingsMenuOpen((open) => !open)}
              title="Settings"
              type="button"
              aria-haspopup="menu"
              aria-expanded={islandSettingsMenuOpen}
            >
              <SettingsIcon />
            </button>
            {islandSettingsMenuOpen && renderSettingsMenu(() => setIslandSettingsMenuOpen(false))}
          </div>
        </div>
      </div>

      {leftSidebarTab === 'git' ? (
        <GitPanel
          cwd={sessions.current.get(activePaneId)?.cwd || activePane?.cwd || ''}
          onClose={() => setLeftSidebarTab(isExplorerSidebarOpen ? 'explorer' : 'workspace')}
          width={leftSidebarWidth}
          onResize={setLeftSidebarWidth}
          activePaneId={activePaneId}
          terminalId={sessions.current.get(activePaneId)?.terminalId}
          refreshTrigger={gitRefreshTrigger}
          onOpenFile={(filePath) => {
            setActiveEditorFilePath(filePath);
            setActiveEditorLineNumber(undefined);
            setIsExplorerSidebarOpenState(true);
          }}
          onLeft={true}
        />
      ) : leftSidebarTab ? (
        <aside className="sidebar">
          {leftSidebarTab === 'explorer' ? (
            <>
              <div className="sidebar-panel-container">
                <div className="sidebar-tabs-header">
                  <div className="sidebar-tabs">
                    <button
                      className={`sidebar-tab-button ${sidebarActiveTab === 'explorer' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setSidebarActiveTab('explorer')}
                    >
                      Explorer
                    </button>
                    <button
                      className={`sidebar-tab-button ${sidebarActiveTab === 'search' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setSidebarActiveTab('search')}
                    >
                      Search
                    </button>
                  </div>
                  <button
                    className="sidebar-close-button"
                    type="button"
                    title="Close sidebar"
                    onClick={() => setIsExplorerSidebarOpen(false)}
                  >
                    <CloseIcon />
                  </button>
                </div>

                <div className="sidebar-panel-content">
                  {sidebarActiveTab === 'explorer' ? (
                    <CurrentFolderTree
                      rootPath={activePaneCwd}
                      onClose={() => setIsExplorerSidebarOpen(false)}
                      onOpenFile={(path, line) => {
                        setActiveEditorFilePath(path);
                        setActiveEditorLineNumber(line);
                        setIsExplorerSidebarOpen(true);
                      }}
                      activeFilePath={activeEditorFilePath}
                    />
                  ) : (
                    <SearchPanel
                      rootPath={activePaneCwd}
                      onClose={() => setIsExplorerSidebarOpen(false)}
                      onOpenFile={(path, line) => {
                        setActiveEditorFilePath(path);
                        setActiveEditorLineNumber(line);
                        setIsExplorerSidebarOpen(true);
                      }}
                      onCommitSearchHighlight={handleCommitSearchHighlight}
                      activeFilePath={activeEditorFilePath}
                      activeLineNumber={activeEditorLineNumber}
                    />
                  )}
                </div>
              </div>
              <div className="sidebar-resize-handle" onPointerDown={handleLeftResizeStart} />
            </>
          ) : (
            <>
              <div className="sidebar-brand-workspace">
                <div className="brand">
                  <div className="brand-mark">
                    <img className="brand-mark-logo" src={carogentLogoUrl} alt="" />
                  </div>
                  <div>
                    <div className="brand-title">Carogent</div>
                    <div className="brand-subtitle">Terminal Workspace</div>
                  </div>
                </div>

                <section className="workspace-list">
                  <div className="workspace-list-header">
                    <span>Workspaces</span>
                    <button className="workspace-add-button" type="button" title="Add workspace" onClick={handleAddWorkspace}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="lucide lucide-plus-icon lucide-plus"
                      >
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>
                    </button>
                  </div>
                  {workspaces.map((workspace) => (
                    <WorkspaceItem
                      key={workspace.id}
                      workspace={workspace}
                      active={workspace.id === activeWorkspaceId}
                      canDelete={workspaces.length > 1}
                      onSelect={setActiveWorkspaceId}
                      onRename={handleRenameWorkspace}
                      onColorChange={handleUpdateWorkspaceColor}
                      onDelete={handleDeleteWorkspace}
                    />
                  ))}
                </section>
              </div>

              <PinnedFolderPanel
                pinnedDirectory={pinnedDirectory}
                collapsed={pinnedFolderCollapsed}
                onPinnedDirectoryChange={setPinnedDirectory}
                onCollapsedChange={setPinnedFolderCollapsed}
                onInsertPath={handleInsertPath}
              />

              <div className="sidebar-footer">
                <div className="footer-label">Active Pane</div>
                <div className="footer-value">{activePaneTitle}</div>
                <div className="footer-path">{activePaneCwd || 'Starting shell...'}</div>
              </div>
              <div className="sidebar-resize-handle" onPointerDown={handleLeftResizeStart} />
            </>
          )}
        </aside>
      ) : null}

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="topbar-title">{activeWorkspace.name}</div>
            <div className="topbar-subtitle">{paneIds.length} shell session{paneIds.length === 1 ? '' : 's'}</div>
          </div>
          <div className="topbar-actions">
            <button
              className="command-palette-button"
              type="button"
              onClick={() => openQuickAccess()}
              title="Open quick access"
            >
              <span className="command-palette-shortcut">{isMacPlatform() ? '⌘P' : 'Ctrl P'}</span>
              <span>Quick Access</span>
            </button>
            <button
              className="topbar-button topbar-button-secondary"
              type="button"
              onClick={handleOpenBrowser}
              title={browserBridgeStatus.lastError ? `${browserBridgeTitle}: ${browserBridgeStatus.lastError}` : browserBridgeTitle}
            >
              <span
                className={`topbar-status-dot ${browserBridgeStatus.connected ? 'is-connected' : ''} ${
                  browserBridgeStatus.connected && !browserBridgeStatus.enabled ? 'is-disabled' : ''
                }`}
                aria-hidden="true"
              />
              Open in Browser
            </button>
            <button
              className="settings-button"
              type="button"
              onClick={() => setIsExplorerSidebarOpen((open) => !open)}
              title="Toggle current folder explorer"
              aria-label="Toggle current folder explorer"
              style={isExplorerSidebarOpen ? { borderColor: 'var(--color-accent-strong)', color: 'var(--color-accent-strong)' } : undefined}
            >
              <WrenchIcon />
            </button>
            <div className="settings-menu-wrap" ref={settingsMenuRef}>
              <button
                className="settings-button"
                type="button"
                title="Settings"
                aria-haspopup="menu"
                aria-expanded={settingsMenuOpen}
                onClick={() => setSettingsMenuOpen((open) => !open)}
              >
                <SettingsIcon />
              </button>
              {settingsMenuOpen && renderSettingsMenu(() => setSettingsMenuOpen(false))}
            </div>
          </div>
        </header>

        {isExplorerSidebarOpen ? (
          <FileEditorWorkspace
            activeFilePath={activeEditorFilePath}
            activeLineNumber={activeEditorLineNumber}
            rootPath={activePaneCwd}
            onActiveFileChange={(path) => {
              setActiveEditorFilePath(path);
              setActiveEditorLineNumber(undefined);
            }}
            globalSearchQuery={globalSearchQuery}
            globalSearchCaseSensitive={globalSearchCaseSensitive}
            globalSearchWholeWord={globalSearchWholeWord}
            globalSearchUseRegex={globalSearchUseRegex}
          />
        ) : (
          <div className="terminal-canvas">
            <NodeView
              key={activeWorkspace.id}
              node={layout}
              path=""
              activePaneId={activePaneId}
              workspaceFocusColor={activeWorkspace.color}
              paneCount={paneCount}
              ensureSession={ensureSession}
              onActivate={handleActivatePane}
              onSplit={handleSplit}
              onClose={handleClose}
              onResize={handleResize}
              onUpdatePane={handleUpdatePane}
              onChangeShell={handleChangeShell}
              onOpenBrowser={(browserUrl) => window.terminalApi.openOrFocusBrowser({ url: browserUrl })}
              shellOptions={shellOptions}
              onPushToOverlay={handleTogglePinShell}
              pinnedPaneIds={pinnedPaneIds}
              maximizedPaneId={activeWorkspace.maximizedPaneId}
              onToggleMaximize={handleToggleMaximize}
            />
          </div>
        )}
      </section>
      {quickAccessOpen && (
        <QuickAccessPalette
          inputRef={quickAccessInputRef}
          query={quickAccessQuery}
          mode={effectivePaletteMode}
          items={filteredPaletteItems}
          selectedIndex={quickAccessSelectedIndex}
          onQueryChange={setQuickAccessQuery}
          onSelectedIndexChange={setQuickAccessSelectedIndex}
          onOpenItem={(item) => item.run()}
          onClose={closeQuickAccess}
          onOpenManager={() => {
            closeQuickAccess();
            setQuickAccessManagerOpen(true);
          }}
        />
      )}
      {quickAccessManagerOpen && (
        <QuickAccessManager
          items={quickAccessItems}
          onSave={handleSaveQuickAccessItem}
          onDelete={handleDeleteQuickAccessItem}
          onClose={() => setQuickAccessManagerOpen(false)}
        />
      )}
      {mcpSettingsOpen && (
        <McpSettingsModal
          onClose={() => setMcpSettingsOpen(false)}
        />
      )}
    </main>
  );
}


export default App;
