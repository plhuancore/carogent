import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { FitAddon } from '@xterm/addon-fit';
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
import { createEmptyWorkspace, loadWorkspaceStore, saveWorkspaceStore, WorkspaceState } from './storage';
import './styles.css';

type TerminalSession = {
  terminal: Terminal;
  fitAddon: FitAddon;
  input: IDisposable;
  terminalId?: string;
  cwd?: string;
  shell?: string;
  status: 'starting' | 'running' | 'exited';
};

type SessionRegistry = Map<string, TerminalSession>;

const HEADER_COLOR_PRESETS = [
  '#07090c',
  '#102a43',
  '#123235',
  '#2b2545',
  '#3b1f2b',
  '#3a2f16',
  '#163326',
  '#2f343f'
];

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

function createXterm(): Terminal {
  return new Terminal({
    cursorBlink: true,
    fontFamily: '"SF Mono", "SFMono-Regular", Menlo, Monaco, "Cascadia Mono", "Consolas", monospace',
    fontSize: 14,
    fontWeight: 500,
    fontWeightBold: 700,
    letterSpacing: 0,
    lineHeight: 1.28,
    minimumContrastRatio: 7,
    scrollback: 4000,
    theme: {
      background: '#050607',
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

function getNextWorkspaceName(workspaces: WorkspaceState[]): string {
  let index = workspaces.length + 1;
  const names = new Set(workspaces.map((workspace) => workspace.name));

  while (names.has(`Project ${index}`)) {
    index += 1;
  }

  return `Project ${index}`;
}

function App(): JSX.Element {
  const initialStore = useMemo(() => loadWorkspaceStore(), []);
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>(() => initialStore.workspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => initialStore.activeWorkspaceId);
  const [shellOptions, setShellOptions] = useState<TerminalShellOption[] | null>(null);
  const [shellOptionsError, setShellOptionsError] = useState<string | null>(null);
  const sessions = useRef<SessionRegistry>(new Map());

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0];
  const layout = activeWorkspace.layout;
  const activePaneId = findPane(layout, activeWorkspace.activePaneId)
    ? activeWorkspace.activePaneId
    : getFirstPaneId(layout);
  const paneCount = useMemo(() => countPanes(layout), [layout]);

  useEffect(() => {
    saveWorkspaceStore({ activeWorkspaceId: activeWorkspace.id, workspaces });
  }, [activeWorkspace.id, activeWorkspaceId, workspaces]);

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
    const stopData = window.terminalApi.onData(({ id, data }) => {
      for (const session of sessions.current.values()) {
        if (session.terminalId === id) {
          session.terminal.write(data);
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
      stopExit();

      for (const [paneId, session] of sessions.current) {
        if (session.terminalId) {
          window.terminalApi.kill(session.terminalId);
        }

        session.input.dispose();
        session.terminal.dispose();
        sessions.current.delete(paneId);
      }
    };
  }, []);

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
    terminal.loadAddon(fitAddon);

    const session: TerminalSession = {
      terminal,
      fitAddon,
      status: 'starting',
      input: terminal.onData((data) => {
        if (session.terminalId && session.status !== 'exited') {
          window.terminalApi.write({ id: session.terminalId, data });
        }
      })
    };

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

    session.input.dispose();
    session.terminal.dispose();
    sessions.current.delete(paneId);
  }, []);

  const handleSplit = useCallback((paneId: string, direction: SplitDirection) => {
    updateActiveWorkspace((workspace) => {
      const result = splitPane(workspace.layout, paneId, direction);

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
          ? { ...workspace, color: color === HEADER_COLOR_PRESETS[0] ? undefined : color }
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
          <div className="brand-mark">C</div>
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
          <button
            className="topbar-button"
            type="button"
            onClick={() => handleSplit(activePaneId, 'row')}
            title="Split active pane to the right"
          >
            Split
          </button>
        </header>

        <div className="terminal-canvas">
          <NodeView
            node={layout}
            path=""
            activePaneId={activePaneId}
            paneCount={paneCount}
            ensureSession={ensureSession}
            onActivate={handleActivatePane}
            onSplit={handleSplit}
            onClose={handleClose}
            onResize={handleResize}
            onUpdatePane={handleUpdatePane}
            onChangeShell={handleChangeShell}
            shellOptions={shellOptions}
          />
        </div>
      </section>
    </main>
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
  const workspaceColor = workspace.color || HEADER_COLOR_PRESETS[0];

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
      <div className={`workspace-item is-editing ${active ? 'active' : ''}`} style={{ backgroundColor: workspaceColor }}>
        <div className="workspace-edit-row">
          <span className="status-dot" />
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
          {HEADER_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              className={`workspace-color-swatch ${color === workspaceColor ? 'is-selected' : ''}`}
              type="button"
              title={color === HEADER_COLOR_PRESETS[0] ? 'Default' : color}
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
    <div className={`workspace-item ${active ? 'active' : ''}`} style={{ backgroundColor: workspaceColor }}>
      <button
        className="workspace-select-button"
        type="button"
        onClick={() => onSelect(workspace.id)}
        onDoubleClick={() => setEditing(true)}
      >
        <span className="status-dot" />
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
        x
      </button>
    </div>
  );
}

type NodeViewProps = {
  node: LayoutNode;
  path: string;
  activePaneId: string;
  paneCount: number;
  ensureSession: (pane: PaneNode) => TerminalSession;
  onActivate: (paneId: string) => void;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClose: (paneId: string) => void;
  onResize: (path: string, firstSize: number) => void;
  onUpdatePane: (paneId: string, changes: Partial<PaneNode>) => void;
  onChangeShell: (paneId: string, shell: string) => void;
  shellOptions: TerminalShellOption[];
};

function NodeView(props: NodeViewProps): JSX.Element {
  if (props.node.type === 'pane') {
    return (
      <TerminalPane
        pane={props.node}
        active={props.node.paneId === props.activePaneId}
        canClose={props.paneCount > 1}
        ensureSession={props.ensureSession}
        onActivate={props.onActivate}
        onSplit={props.onSplit}
        onClose={props.onClose}
        onUpdatePane={props.onUpdatePane}
        onChangeShell={props.onChangeShell}
        shellOptions={props.shellOptions}
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
  paneCount,
  ensureSession,
  onActivate,
  onSplit,
  onClose,
  onResize,
  onUpdatePane,
  onChangeShell,
  shellOptions
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
          paneCount={paneCount}
          ensureSession={ensureSession}
          onActivate={onActivate}
          onSplit={onSplit}
          onClose={onClose}
          onResize={onResize}
          onUpdatePane={onUpdatePane}
          onChangeShell={onChangeShell}
          shellOptions={shellOptions}
        />
      </div>
      <div className="divider" role="separator" onPointerDown={beginResize} />
      <div className="split-child" style={{ flex: `${node.sizes[1]} 1 0` }}>
        <NodeView
          node={node.children[1]}
          path={`${path}1`}
          activePaneId={activePaneId}
          paneCount={paneCount}
          ensureSession={ensureSession}
          onActivate={onActivate}
          onSplit={onSplit}
          onClose={onClose}
          onResize={onResize}
          onUpdatePane={onUpdatePane}
          onChangeShell={onChangeShell}
          shellOptions={shellOptions}
        />
      </div>
    </div>
  );
}

type TerminalPaneProps = {
  pane: PaneNode;
  active: boolean;
  canClose: boolean;
  ensureSession: (pane: PaneNode) => TerminalSession;
  onActivate: (paneId: string) => void;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClose: (paneId: string) => void;
  onUpdatePane: (paneId: string, changes: Partial<PaneNode>) => void;
  onChangeShell: (paneId: string, shell: string) => void;
  shellOptions: TerminalShellOption[];
};

function TerminalPane({
  pane,
  active,
  canClose,
  ensureSession,
  onActivate,
  onSplit,
  onClose,
  onUpdatePane,
  onChangeShell,
  shellOptions
}: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const shellMenuRef = useRef<HTMLDivElement | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(pane.customTitle || '');
  const displayTitle = pane.customTitle || pane.title;
  const headerColor = pane.headerColor || HEADER_COLOR_PRESETS[0];
  const selectedShell = getShellOption(shellOptions, pane.shell);

  const commitTitle = useCallback(() => {
    const nextTitle = draftTitle.trim();

    onUpdatePane(pane.paneId, {
      customTitle: nextTitle.length > 0 ? nextTitle : undefined
    });
  }, [draftTitle, onUpdatePane, pane.paneId]);

  const closeEditor = useCallback(() => {
    commitTitle();
    setEditorOpen(false);
  }, [commitTitle]);

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

    const fit = (): void => {
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
        // xterm may briefly have zero dimensions while a pane is being split.
      }
    };

    const observer = new ResizeObserver(fit);
    observer.observe(host);
    window.setTimeout(fit, 0);

    if (active) {
      window.setTimeout(() => session.terminal.focus(), 0);
    }

    return () => {
      observer.disconnect();
    };
  }, [active, ensureSession, pane]);

  useEffect(() => {
    if (editorOpen) {
      setDraftTitle(pane.customTitle || '');
    }
  }, [editorOpen, pane.customTitle]);

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

  return (
    <article
      className={`terminal-pane ${active ? 'is-active' : ''}`}
      onMouseDown={() => onActivate(pane.paneId)}
    >
      <div className="pane-toolbar" style={{ backgroundColor: headerColor }}>
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
        <div
          className="pane-title"
          title={pane.cwd}
          onDoubleClick={(event) => {
            event.preventDefault();
            setEditorOpen(true);
          }}
        >
          {displayTitle}
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
        <div className="pane-actions">
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
      <div className="terminal-host">
        <div className="terminal-viewport" ref={hostRef} />
      </div>
    </article>
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

export default App;
