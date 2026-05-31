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
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import type { ISearchOptions } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import type { IDisposable } from '@xterm/xterm';
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
import carogentLogoUrl from './assets/carogent-logo.png';
import './styles.css';

type TerminalSession = {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  input: IDisposable;
  fitFrame?: number;
  fitTimer?: number;
  terminalId?: string;
  cwd?: string;
  shell?: string;
  status: 'starting' | 'running' | 'exited';
};

type SessionRegistry = Map<string, TerminalSession>;

type CommandPaletteItem = {
  id: string;
  title: string;
  subtitle: string;
  keywords: string;
  icon: 'browser' | 'code' | 'quick-access';
  run: () => void;
};

type PaletteMode = 'quick-access' | 'command';

type AgentDoneItem = {
  paneId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  cwd?: string;
  lines?: string[];
};

const WORKSPACE_COLOR_PRESETS = [
  '#07090c',
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#db2777',
  '#d97706',
  '#16a34a',
  '#475569'
];

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

const AGENT_DONE_SENTINEL = 'carogent_done';
const AGENT_DONE_VISIBLE_MS = 8000;

function getHeaderColor(color?: string): string {
  return color && HEADER_COLOR_PRESETS.includes(color) ? color : HEADER_COLOR_PRESETS[0];
}

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

function scorePaletteItemMatch(item: CommandPaletteItem, terms: string[]): number {
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

function getDefaultShellOption(shellOptions: TerminalShellOption[]): TerminalShellOption {
  return shellOptions.find((option) => option.isDefault) || shellOptions[0];
}

function getShellOption(shellOptions: TerminalShellOption[], shell?: string): TerminalShellOption {
  const normalizedShell = shell?.toLowerCase();

  return (
    shellOptions.find((option) => option.shell.toLowerCase() === normalizedShell) ||
    getDefaultShellOption(shellOptions)
  );
}

function getPaneShell(shellOptions: TerminalShellOption[], pane: PaneNode): string {
  return getShellOption(shellOptions, pane.shell).shell;
}

function getShellTitle(shellOptions: TerminalShellOption[], shell?: string): string {
  return getShellOption(shellOptions, shell).title;
}

function getTerminalFontFamily(): string {
  if (navigator.platform.toLowerCase().includes('win')) {
    return 'Consolas, "Courier New", monospace';
  }

  return '"SF Mono", "SFMono-Regular", Menlo, Monaco, "Cascadia Mono", "Consolas", monospace';
}

function createXterm(): Terminal {
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorInactiveStyle: 'bar',
    cursorStyle: 'bar',
    cursorWidth: 2,
    fontFamily: getTerminalFontFamily(),
    fontSize: 14,
    fontWeight: 500,
    fontWeightBold: 700,
    letterSpacing: 0,
    lineHeight: 1.28,
    minimumContrastRatio: 7,
    scrollback: 4000,
    theme: {
      background: '#111315',
      foreground: '#eef2f7',
      cursor: '#ffffff',
      selectionBackground: '#3b82f680',
      black: '#2d3748',
      red: '#ff7b86',
      green: '#5ee9a7',
      yellow: '#ffd166',
      blue: '#7cb7ff',
      magenta: '#d6a8ff',
      cyan: '#5eead4',
      white: '#f1f5f9',
      brightBlack: '#a8b3c5',
      brightRed: '#fb7185',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff'
    }
  });
}

function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
}

function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

function copyTerminalSelection(terminal: Terminal): boolean {
  const selection = terminal.getSelection();

  if (!selection) {
    return false;
  }

  window.terminalApi.writeClipboardText(selection);

  const copiedText = window.terminalApi.readClipboardText();

  if (normalizeClipboardText(copiedText) !== normalizeClipboardText(selection) && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(selection);
  }

  return true;
}

function fitTerminalSession(session: TerminalSession): void {
  if (!session.terminal.element?.parentElement) {
    return;
  }

  try {
    session.fitAddon.fit();

    if (session.terminalId) {
      window.terminalApi.resize({
        id: session.terminalId,
        cols: session.terminal.cols,
        rows: session.terminal.rows
      });
    }
  } catch {
    // xterm can briefly have zero dimensions while panes attach, split, or hide.
  }
}

function scheduleTerminalFit(session: TerminalSession): void {
  if (session.fitFrame === undefined) {
    session.fitFrame = window.requestAnimationFrame(() => {
      session.fitFrame = undefined;
      fitTerminalSession(session);
    });
  }

  if (session.fitTimer !== undefined) {
    window.clearTimeout(session.fitTimer);
  }

  session.fitTimer = window.setTimeout(() => {
    session.fitTimer = undefined;
    fitTerminalSession(session);
  }, 50);
}

function clearTerminalFitTimers(session: TerminalSession): void {
  if (session.fitFrame !== undefined) {
    window.cancelAnimationFrame(session.fitFrame);
    session.fitFrame = undefined;
  }

  if (session.fitTimer !== undefined) {
    window.clearTimeout(session.fitTimer);
    session.fitTimer = undefined;
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

function isImageFile(entry: DirectoryEntry): boolean {
  return entry.type === 'file' && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(entry.name);
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
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [shellOptions, setShellOptions] = useState<TerminalShellOption[] | null>(null);
  const [shellOptionsError, setShellOptionsError] = useState<string | null>(null);
  const [agentOverlayVisible, setAgentOverlayVisible] = useState(true);
  const [browserBridgeStatus, setBrowserBridgeStatus] = useState<BrowserBridgeStatusEvent>({
    connected: false,
    clientCount: 0,
    enabled: true
  });
  const [agentDonePaneIds, setAgentDonePaneIds] = useState<Set<string>>(() => new Set());
  const sessions = useRef<SessionRegistry>(new Map());
  const agentDoneTimers = useRef<Map<string, number>>(new Map());
  const pinnedPaneIdsRef = useRef<Set<string>>(new Set());
  const overlayUpdateTimers = useRef<Map<string, number>>(new Map());
  const workspacesRef = useRef<WorkspaceState[]>(workspaces);
  const shellOptionsRef = useRef<TerminalShellOption[] | null>(shellOptions);
  const quickAccessInputRef = useRef<HTMLInputElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

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
          const term = session.terminal;
          const buffer = term.buffer.active;
          const lines: string[] = [];
          
          // Use cursor-aware positioning to grab active lines instead of empty terminal viewport bottom (7 lines)
          const end = Math.min(buffer.length - 1, Math.max(6, buffer.baseY + buffer.cursorY));
          const start = Math.max(0, end - 6);
          for (let i = start; i <= end; i++) {
            const line = buffer.getLine(i);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
          doneItem.lines = lines;
        }
        window.terminalApi.showAgentDoneOverlay(doneItem).catch(() => {});
      }
    },
    [getAgentDoneItem]
  );

  const triggerOverlayUpdate = useCallback(
    (paneId: string) => {
      if (overlayUpdateTimers.current.has(paneId)) {
        return;
      }

      const timer = window.setTimeout(() => {
        overlayUpdateTimers.current.delete(paneId);

        const doneItem = getAgentDoneItem(paneId);
        if (doneItem) {
          const session = sessions.current.get(paneId);
          if (session) {
            const term = session.terminal;
            const buffer = term.buffer.active;
            const lines: string[] = [];
            
            // Grab 7 lines of active terminal preview
            const end = Math.min(buffer.length - 1, Math.max(6, buffer.baseY + buffer.cursorY));
            const start = Math.max(0, end - 6);
            for (let i = start; i <= end; i++) {
              const line = buffer.getLine(i);
              if (line) {
                lines.push(line.translateToString(true));
              }
            }
            doneItem.lines = lines;
          }
          window.terminalApi.showAgentDoneOverlay(doneItem).catch(() => {});
        }
      }, 100);

      overlayUpdateTimers.current.set(paneId, timer);
    },
    [getAgentDoneItem]
  );

  const markAgentDonePane = useCallback((paneId: string) => {
    const existingTimer = agentDoneTimers.current.get(paneId);

    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    setAgentDonePaneIds((current) => {
      const next = new Set(current);
      next.add(paneId);
      return next;
    });

    const timer = window.setTimeout(() => {
      agentDoneTimers.current.delete(paneId);
      setAgentDonePaneIds((current) => {
        if (!current.has(paneId)) {
          return current;
        }

        const next = new Set(current);
        next.delete(paneId);
        return next;
      });
    }, AGENT_DONE_VISIBLE_MS);

    agentDoneTimers.current.set(paneId, timer);
  }, []);

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
      setAgentOverlayVisible(true);
    });
  }, []);

  useEffect(() => {
    const stopListening = window.terminalApi.onAgentDoneOverlayItems((nextItems) => {
      const nextIds = new Set(nextItems.map((item) => item.paneId));
      pinnedPaneIdsRef.current = nextIds;
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
    const stopData = window.terminalApi.onData(({ id, data }) => {
      for (const [paneId, session] of sessions.current) {
        if (session.terminalId === id) {
          // Automatic check for carogent_done is disabled per user request
          /*
          if (data.includes(AGENT_DONE_SENTINEL)) {
            markAgentDonePane(paneId);
            const doneItem = getAgentDoneItem(paneId);

            if (doneItem) {
              window.terminalApi.showAgentDoneOverlay(doneItem).catch(() => {});
            }
          }
          */

          session.terminal.write(data);
          scheduleTerminalFit(session);

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

      for (const timer of agentDoneTimers.current.values()) {
        window.clearTimeout(timer);
      }

      agentDoneTimers.current.clear();

      for (const timer of overlayUpdateTimers.current.values()) {
        window.clearTimeout(timer);
      }

      overlayUpdateTimers.current.clear();
    };
  }, [getAgentDoneItem, markAgentDonePane, updatePaneInAnyWorkspace]);

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
      .create({ cwd: pane.cwd, shell: requestedShell })
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
        activePaneId: result.newPaneId
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
        activePaneId: getFirstPaneId(nextLayout)
      }));
    },
    [killPaneSession, layout, updateActiveWorkspace]
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
    const path = sessions.current.get(activePaneId)?.cwd || activePane?.cwd;

    window.terminalApi.openInVSCode({ path });
  }, [activePane?.cwd, activePaneId]);

  const handleOpenBrowser = useCallback(() => {
    window.terminalApi.openOrFocusBrowser({ url: activePane?.browserUrl });
  }, [activePane?.browserUrl]);

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
    const codePath = sessions.current.get(activePaneId)?.cwd || activePane?.cwd || 'Home directory';
    const browserLabel = formatBrowserUrlLabel(activePane?.browserUrl) || 'localhost:3000';

    return [
      {
        id: 'open-browser',
        title: 'Open in Browser',
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
        title: 'Open in VS Code',
        subtitle: codePath,
        keywords: `vscode vs code editor open workspace folder ${codePath}`,
        icon: 'code',
        run: () => {
          handleOpenInVSCode();
          closeQuickAccess();
        }
      }
    ];
  }, [
    activePane?.browserUrl,
    activePane?.cwd,
    activePaneId,
    closeQuickAccess,
    handleOpenBrowser,
    handleOpenInVSCode
  ]);

  const effectivePaletteMode: PaletteMode = quickAccessQuery.trimStart().startsWith('>')
    ? 'command'
    : paletteMode;

  const filteredPaletteItems = useMemo(() => {
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
  }, [commandPaletteItems, effectivePaletteMode, quickAccessPaletteItems, quickAccessQuery]);

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
        openQuickAccess(event.shiftKey ? 'command' : 'quick-access');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [openQuickAccess]);

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
    return window.terminalApi.onOpenAgentPane(({ workspaceId, paneId }) => {
      setActiveWorkspaceId(workspaceId);
      setWorkspaces((current) =>
        current.map((workspace) => (workspace.id === workspaceId ? { ...workspace, activePaneId: paneId } : workspace))
      );
    });
  }, []);

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
    <main className="app-shell">
      <aside className="sidebar">
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
              +
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
          <div className="footer-path">{activePane?.cwd || 'Starting shell...'}</div>
        </div>
      </aside>

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
              className="topbar-button topbar-button-secondary"
              type="button"
              onClick={handleOpenInVSCode}
              title="Open active pane folder in VS Code"
            >
              Open in VS Code
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
              {settingsMenuOpen && (
                <div className="settings-menu" role="menu">
                  <button
                    className="settings-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSettingsMenuOpen(false);
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
                    onClick={() => {
                      const nextVisible = !agentOverlayVisible;

                      setAgentOverlayVisible(nextVisible);
                      window.terminalApi
                        .setAgentDoneOverlayVisible(nextVisible)
                        .then(setAgentOverlayVisible)
                        .catch(() => setAgentOverlayVisible(agentOverlayVisible));
                    }}
                  >
                    <AgentOverlayIcon />
                    Floating Bar
                    <span className="settings-menu-check" aria-hidden="true">
                      {agentOverlayVisible ? '✓' : ''}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

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
            agentDonePaneIds={agentDonePaneIds}
            onPushToOverlay={handlePushToOverlay}
          />
        </div>
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
    </main>
  );
}

type QuickAccessPaletteProps = {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  mode: PaletteMode;
  items: CommandPaletteItem[];
  selectedIndex: number;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onOpenItem: (item: CommandPaletteItem) => void;
  onClose: () => void;
  onOpenManager: () => void;
};

function QuickAccessPalette({
  inputRef,
  query,
  mode,
  items,
  selectedIndex,
  onQueryChange,
  onSelectedIndexChange,
  onOpenItem,
  onClose,
  onOpenManager
}: QuickAccessPaletteProps): JSX.Element {
  const isCommandMode = mode === 'command';
  const hasQuery = query.trim().length > 0;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onSelectedIndexChange(items.length === 0 ? 0 : Math.min(items.length - 1, selectedIndex + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onSelectedIndexChange(Math.max(0, selectedIndex - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      const item = items[selectedIndex];

      if (item) {
        onOpenItem(item);
      } else {
        onOpenManager();
      }
    }
  };

  return (
    <div className="quick-access-overlay" onMouseDown={onClose}>
      <div className="quick-access-palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-access-search">
          <span className="quick-access-search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="quick-access-input"
            value={query}
            placeholder={isCommandMode ? 'Search commands' : 'Search quick access'}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="quick-access-results">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={`quick-access-result ${index === selectedIndex ? 'is-selected' : ''}`}
              type="button"
              onMouseEnter={() => onSelectedIndexChange(index)}
              onClick={() => onOpenItem(item)}
            >
              <span className="quick-access-result-icon" aria-hidden="true">
                <CommandPaletteIcon type={item.icon} />
              </span>
              <span className="quick-access-result-copy">
                <span className="quick-access-result-name">{item.title}</span>
                <span className="quick-access-result-domain">{item.subtitle}</span>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <div className="quick-access-empty">
              <div>
                <div className="quick-access-empty-title">
                  {isCommandMode
                    ? 'No matching commands'
                    : hasQuery
                    ? 'No matching quick access items'
                    : 'No quick access items'}
                </div>
                <div className="quick-access-empty-copy">
                  {isCommandMode
                    ? 'Try another command search.'
                    : 'Create entries to open your frequent domains faster.'}
                </div>
              </div>
              {!isCommandMode && (
                <button type="button" onClick={onOpenManager}>
                  Manage Quick Access
                </button>
              )}
            </div>
          )}
        </div>
        <div className="quick-access-footer">
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
          <span><kbd>↑↓</kbd> Navigate</span>
          {!isCommandMode && <span><kbd>&gt;</kbd> Commands</span>}
        </div>
      </div>
    </div>
  );
}

type QuickAccessManagerProps = {
  items: QuickAccessItem[];
  onSave: (item: QuickAccessItem) => void;
  onDelete: (itemId: string) => void;
  onClose: () => void;
};

function QuickAccessManager({ items, onSave, onDelete, onClose }: QuickAccessManagerProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDomain, setDraftDomain] = useState('');

  const resetDraft = (): void => {
    setEditingId(null);
    setDraftName('');
    setDraftDomain('');
  };

  const beginEdit = (item: QuickAccessItem): void => {
    setEditingId(item.id);
    setDraftName(item.name);
    setDraftDomain(item.domain);
  };

  const handleSubmit = (event: ReactFormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const name = draftName.trim();
    const domain = draftDomain.trim();

    if (!name || !domain) {
      return;
    }

    onSave({
      id: editingId || crypto.randomUUID(),
      name,
      domain
    });
    resetDraft();
  };

  return (
    <div className="quick-access-overlay" onMouseDown={onClose}>
      <section className="quick-access-manager" onMouseDown={(event) => event.stopPropagation()}>
        <header className="quick-access-manager-header">
          <div className="quick-access-manager-title">
            <span className="quick-access-manager-icon" aria-hidden="true">
              <QuickAccessIcon />
            </span>
            <div>
              <h2>Quick Access</h2>
              <p>{items.length} item{items.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <form className="quick-access-form" onSubmit={handleSubmit}>
          <input
            value={draftName}
            placeholder="Name"
            onChange={(event) => setDraftName(event.target.value)}
          />
          <input
            value={draftDomain}
            placeholder="localhost:3000"
            onChange={(event) => setDraftDomain(event.target.value)}
          />
          <button type="submit" disabled={!draftName.trim() || !draftDomain.trim()}>
            {editingId ? 'Save' : 'Add'}
          </button>
          {editingId && (
            <button type="button" onClick={resetDraft}>
              Cancel
            </button>
          )}
        </form>

        <div className="quick-access-manager-list">
          {items.map((item) => (
            <div className="quick-access-manager-item" key={item.id}>
              <div>
                <div className="quick-access-manager-name">{item.name}</div>
                <div className="quick-access-manager-domain">{formatBrowserUrlLabel(item.domain) || item.domain}</div>
              </div>
              <button type="button" onClick={() => beginEdit(item)}>
                Edit
              </button>
              <button type="button" onClick={() => onDelete(item.id)}>
                Delete
              </button>
            </div>
          ))}
          {items.length === 0 && <div className="quick-access-manager-empty">No quick access items yet.</div>}
        </div>
      </section>
    </div>
  );
}

type WorkspaceItemProps = {
  workspace: WorkspaceState;
  active: boolean;
  canDelete: boolean;
  onSelect: (workspaceId: string) => void;
  onRename: (workspaceId: string, name: string) => void;
  onColorChange: (workspaceId: string, color: string) => void;
  onDelete: (workspaceId: string) => void;
};

type PinnedFolderPanelProps = {
  pinnedDirectory: string;
  collapsed: boolean;
  onPinnedDirectoryChange: (path: string) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onInsertPath: (path: string) => void;
};

function PinnedFolderPanel({
  pinnedDirectory,
  collapsed,
  onPinnedDirectoryChange,
  onCollapsedChange,
  onInsertPath
}: PinnedFolderPanelProps): JSX.Element {
  const [draftPath, setDraftPath] = useState(pinnedDirectory);
  const [directory, setDirectory] = useState<DirectoryListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    entry: DirectoryEntry;
    x: number;
    y: number;
    status: 'loading' | 'ready' | 'error';
    dataUrl?: string;
  } | null>(null);
  const previewTimer = useRef<number | null>(null);
  const previewRequestId = useRef(0);
  const previewPosition = useRef<{ x: number; y: number } | null>(null);

  const clearImagePreview = useCallback((): void => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }

    previewRequestId.current += 1;
    previewPosition.current = null;
    setPreview(null);
  }, []);

  const loadDirectory = useCallback((path: string): void => {
    const nextPath = path.trim();

    clearImagePreview();
    setDraftPath(nextPath);

    if (!nextPath) {
      setDirectory(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    window.terminalApi
      .listDirectory({ path: nextPath })
      .then((result) => {
        setDirectory(result);
        setDraftPath(result.path);
        setError(null);
        onPinnedDirectoryChange(result.path);
      })
      .catch((loadError: unknown) => {
        setDirectory(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => setLoading(false));
  }, [clearImagePreview, onPinnedDirectoryChange]);

  useEffect(() => {
    setDraftPath(pinnedDirectory);
    loadDirectory(pinnedDirectory);
  }, [loadDirectory, pinnedDirectory]);

  const handleSubmit = (event: ReactFormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    loadDirectory(draftPath);
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, path: string): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-carogent-path', path);
    event.dataTransfer.setData('text/plain', path);
  };

  const handleToggleCollapsed = (): void => {
    const nextCollapsed = !collapsed;

    if (nextCollapsed) {
      clearImagePreview();
    }

    onCollapsedChange(nextCollapsed);
  };

  const showImagePreviewAt = (entry: DirectoryEntry, x: number, y: number): void => {
    if (!isImageFile(entry)) {
      clearImagePreview();
      return;
    }

    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
    }

    previewPosition.current = { x, y };
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;

    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      const position = previewPosition.current || { x, y };

      setPreview({
        entry,
        x: position.x,
        y: position.y,
        status: 'loading'
      });

      window.terminalApi
        .getImagePreview({ path: entry.path })
        .then(({ dataUrl }) => {
          if (previewRequestId.current !== requestId) {
            return;
          }

          const nextPosition = previewPosition.current || position;
          setPreview({
            entry,
            x: nextPosition.x,
            y: nextPosition.y,
            status: 'ready',
            dataUrl
          });
        })
        .catch(() => {
          if (previewRequestId.current !== requestId) {
            return;
          }

          const nextPosition = previewPosition.current || position;
          setPreview({
            entry,
            x: nextPosition.x,
            y: nextPosition.y,
            status: 'error'
          });
        });
    }, 500);
  };

  const showImagePreview = (entry: DirectoryEntry, event: ReactMouseEvent<HTMLButtonElement>): void => {
    showImagePreviewAt(entry, event.clientX, event.clientY);
  };

  const moveImagePreview = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    previewPosition.current = {
      x: event.clientX,
      y: event.clientY
    };

    setPreview((current) =>
      current
        ? {
            ...current,
            x: event.clientX,
            y: event.clientY
          }
        : null
    );
  };

  useEffect(() => clearImagePreview, [clearImagePreview]);

  return (
    <section className={`pinned-folder ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="pinned-folder-header">
        <span>Pinned Folder</span>
        <div className="pinned-folder-header-actions">
          {!collapsed && (
            <button
              type="button"
              title="Refresh pinned folder"
              onClick={() => loadDirectory(draftPath)}
              disabled={!draftPath.trim() || loading}
            >
              refresh
            </button>
          )}
          <button
            className="pinned-folder-toggle-button"
            type="button"
            title={collapsed ? 'Expand pinned folder' : 'Collapse pinned folder'}
            aria-label={collapsed ? 'Expand pinned folder' : 'Collapse pinned folder'}
            aria-expanded={!collapsed}
            onClick={handleToggleCollapsed}
          >
            {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
      <form className="pinned-folder-form" onSubmit={handleSubmit}>
        <input
          value={draftPath}
          placeholder="Folder path"
          onChange={(event) => setDraftPath(event.target.value)}
        />
        <button type="submit" disabled={!draftPath.trim() || loading}>
          Open
        </button>
      </form>
      {directory && (
        <div className="pinned-folder-current" title={directory.path}>
          {directory.path}
        </div>
      )}
      {error && <div className="pinned-folder-error">{error}</div>}
      <div className="pinned-folder-list">
        {directory?.parentPath && (
          <button
            className="pinned-folder-row"
            type="button"
            onClick={() => loadDirectory(directory.parentPath || '')}
          >
            <span className="pinned-folder-icon">
              <ParentFolderIcon />
            </span>
            <span className="pinned-folder-name">Parent folder</span>
          </button>
        )}
        {directory?.entries.map((entry) => (
          <button
            key={entry.path}
            className="pinned-folder-row"
            type="button"
            draggable
            onClick={() => {
              if (entry.type === 'directory') {
                loadDirectory(entry.path);
                return;
              }

              onInsertPath(entry.path);
            }}
            onDragStart={(event) => handleDragStart(event, entry.path)}
            onMouseEnter={(event) => showImagePreview(entry, event)}
            onMouseMove={moveImagePreview}
            onMouseLeave={clearImagePreview}
            onFocus={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              showImagePreviewAt(entry, rect.right, rect.top);
            }}
            onBlur={clearImagePreview}
          >
            <span className="pinned-folder-icon">
              <FileTreeIcon type={entry.type} />
            </span>
            <span className="pinned-folder-name">{entry.name}</span>
          </button>
        ))}
        {loading && <div className="pinned-folder-empty">Loading...</div>}
        {!loading && !directory && !error && <div className="pinned-folder-empty">Enter folder path</div>}
        {!loading && directory && directory.entries.length === 0 && (
          <div className="pinned-folder-empty">Empty folder</div>
        )}
      </div>
      {preview && (
        <div
          className="pinned-image-preview"
          style={{ left: preview.x + 14, top: preview.y + 14 }}
        >
          {preview.status === 'loading' ? (
            <span>Loading preview...</span>
          ) : preview.status === 'error' ? (
            <span>Preview unavailable</span>
          ) : (
            <div
              className="pinned-image-preview-media"
              role="img"
              aria-label={preview.entry.name}
              style={{ backgroundImage: `url("${preview.dataUrl}")` }}
            />
          )}
        </div>
      )}
        </>
      )}
    </section>
  );
}

function WorkspaceItem({
  workspace,
  active,
  canDelete,
  onSelect,
  onRename,
  onColorChange,
  onDelete
}: WorkspaceItemProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);
  const workspaceColor = workspace.color || WORKSPACE_COLOR_PRESETS[0];
  const dotStyle = {
    backgroundColor: workspaceColor,
    boxShadow: active
      ? `0 0 0 2px rgba(255, 255, 255, 0.58), 0 0 12px ${workspaceColor}, 0 0 24px ${workspaceColor}, 0 0 38px ${workspaceColor}`
      : `0 0 0 1px rgba(255, 255, 255, 0.38), 0 0 12px ${workspaceColor}, 0 0 24px ${workspaceColor}`
  };

  const commitName = (): void => {
    onRename(workspace.id, draftName);
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) {
      setDraftName(workspace.name);
    }
  }, [editing, workspace.name]);

  if (editing) {
    return (
      <div className={`workspace-item is-editing ${active ? 'active' : ''}`}>
        <div className="workspace-edit-row">
          <span className="status-dot" style={dotStyle} />
          <input
            className="workspace-name-input"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitName();
              }

              if (event.key === 'Escape') {
                setDraftName(workspace.name);
                setEditing(false);
              }
            }}
          />
          <span className="badge">{countPanes(workspace.layout)}</span>
        </div>
        <div className="workspace-color-swatches" aria-label="Workspace color">
          {WORKSPACE_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              className={`workspace-color-swatch ${color === workspaceColor ? 'is-selected' : ''}`}
              type="button"
              title={color === WORKSPACE_COLOR_PRESETS[0] ? 'Default' : color}
              style={{ backgroundColor: color }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onColorChange(workspace.id, color)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`workspace-item ${active ? 'active' : ''}`}>
      <button
        className="workspace-select-button"
        type="button"
        onClick={() => onSelect(workspace.id)}
        onDoubleClick={() => setEditing(true)}
      >
        <span className="status-dot" style={dotStyle} />
        <span className="workspace-name">{workspace.name}</span>
      </button>
      <span className="badge">{countPanes(workspace.layout)}</span>
      <button
        className="workspace-delete-button"
        type="button"
        title={canDelete ? 'Delete workspace' : 'Cannot delete the last workspace'}
        onClick={() => onDelete(workspace.id)}
        disabled={!canDelete}
      >
        <CloseIcon />
      </button>
    </div>
  );
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
  agentDonePaneIds: Set<string>;
  onPushToOverlay: (paneId: string) => void;
};

function NodeView(props: NodeViewProps): JSX.Element {
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
        agentDone={props.agentDonePaneIds.has(props.node.paneId)}
        onPushToOverlay={props.onPushToOverlay}
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
  agentDonePaneIds,
  onPushToOverlay
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
          agentDonePaneIds={agentDonePaneIds}
          onPushToOverlay={onPushToOverlay}
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
          agentDonePaneIds={agentDonePaneIds}
          onPushToOverlay={onPushToOverlay}
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
  agentDone: boolean;
  onPushToOverlay: (paneId: string) => void;
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
  agentDone,
  onPushToOverlay
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
    window.setTimeout(() => scheduleTerminalFit(session), 0);

    return () => {
      observer.disconnect();

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
          {agentDone && <span className="pane-agent-done-dot" title="Agent finished" aria-label="Agent finished" />}
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
            type="button"
            title="Show in overlay"
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

function SearchIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.75 4.75 6.5 6.5" />
      <path d="m11.25 4.75-6.5 6.5" />
    </svg>
  );
}

function ParentFolderIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m6.25 5.75-3 3 3 3" />
      <path d="M3.5 8.75h9" />
      <path d="M12.5 8.75V4.5H7.25" />
    </svg>
  );
}

function FileTreeIcon({ type }: { type: 'file' | 'directory' }): JSX.Element {
  if (type === 'directory') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M1.75 5.25h12.5v7.25a1.25 1.25 0 0 1-1.25 1.25H3a1.25 1.25 0 0 1-1.25-1.25z" />
        <path d="M1.75 5.25V3.75A1.25 1.25 0 0 1 3 2.5h3l1.25 1.5H13a1.25 1.25 0 0 1 1.25 1.25" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4 2.25h5.25L12.5 5.5v8.25H4z" />
      <path d="M9.25 2.25V5.5h3.25" />
    </svg>
  );
}

function SplitRightIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M8 3v10" />
      <path className="icon-accent" d="M10.5 6.25 12.25 8l-1.75 1.75" />
    </svg>
  );
}

function SplitDownIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M3 8h10" />
      <path className="icon-accent" d="M6.25 10.5 8 12.25l1.75-1.75" />
    </svg>
  );
}

function ShellIcon({ name }: { name: string }): JSX.Element {
  if (name === 'powershell') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <rect className="shell-icon-bg" x="1.75" y="3" width="12.5" height="10" rx="1.5" />
        <path d="m5 6 2 2-2 2" />
        <path d="M8.25 10h3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1" />
      <path d="m4.75 6.5 1.65 1.5-1.65 1.5" />
      <path d="M7.7 9.5h3.35" />
    </svg>
  );
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function ChevronUpIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.5 9.75 3.5-3.5 3.5 3.5" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
      <path d="M18.2 13.3c.08-.42.12-.85.12-1.3s-.04-.88-.12-1.3l2.05-1.6-2-3.46-2.42.98a7.3 7.3 0 0 0-2.25-1.3L13.2 2.75h-4l-.38 2.57a7.3 7.3 0 0 0-2.25 1.3l-2.42-.98-2 3.46 2.05 1.6a7 7 0 0 0 0 2.6l-2.05 1.6 2 3.46 2.42-.98a7.3 7.3 0 0 0 2.25 1.3l.38 2.57h4l.38-2.57a7.3 7.3 0 0 0 2.25-1.3l2.42.98 2-3.46-2.05-1.6Z" />
    </svg>
  );
}

function AgentOverlayIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.25" y="4.25" width="11.5" height="7.5" rx="3.75" />
      <circle cx="5.6" cy="8" r="1" />
      <path d="M8 8h3" />
    </svg>
  );
}

function QuickAccessIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
      <path d="M4.75 6.25h4.5" />
      <path d="M4.75 8h6.5" />
      <path d="M4.75 9.75h3.5" />
    </svg>
  );
}

function BrowserIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.75 8h10.5" />
      <path d="M8 2.25c1.5 1.55 2.25 3.47 2.25 5.75S9.5 12.2 8 13.75" />
      <path d="M8 2.25C6.5 3.8 5.75 5.72 5.75 8s.75 4.2 2.25 5.75" />
    </svg>
  );
}

function CodeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m6.25 4.75-3 3.25 3 3.25" />
      <path d="m9.75 4.75 3 3.25-3 3.25" />
      <path d="m8.85 3.5-1.7 9" />
    </svg>
  );
}

function CommandPaletteIcon({ type }: { type: CommandPaletteItem['icon'] }): JSX.Element {
  if (type === 'browser') {
    return <BrowserIcon />;
  }

  if (type === 'code') {
    return <CodeIcon />;
  }

  return <QuickAccessIcon />;
}

export default App;
