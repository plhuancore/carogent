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
import { loadLayout, saveLayout } from './storage';
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

function createXterm(): Terminal {
  return new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Mono", "Consolas", "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.18,
    scrollback: 4000,
    theme: {
      background: '#050607',
      foreground: '#d8dee9',
      cursor: '#f7f7f7',
      selectionBackground: '#2f6fed55',
      black: '#1b1f24',
      red: '#ef6b73',
      green: '#42d392',
      yellow: '#f8c555',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e5e7eb',
      brightBlack: '#64748b',
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

function App(): JSX.Element {
  const initialLayout = useMemo(() => loadLayout(), []);
  const [layout, setLayout] = useState<LayoutNode>(() => initialLayout);
  const [activePaneId, setActivePaneId] = useState(() => getFirstPaneId(initialLayout));
  const sessions = useRef<SessionRegistry>(new Map());

  const paneCount = useMemo(() => countPanes(layout), [layout]);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

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

    window.terminalApi
      .create({ cwd: pane.cwd })
      .then(({ id, cwd, shell }) => {
        session.terminalId = id;
        session.cwd = cwd;
        session.shell = shell;
        session.status = 'running';
        setLayout((current) =>
          updatePane(current, pane.paneId, (currentPane) => ({
            ...currentPane,
            cwd,
            title: shell.replace(/\.exe$/i, '')
          }))
        );
      })
      .catch((error: unknown) => {
        session.status = 'exited';
        terminal.writeln(`Failed to start terminal: ${String(error)}`);
      });

    return session;
  }, []);

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
    setLayout((current) => {
      const result = splitPane(current, paneId, direction);
      setActivePaneId(result.newPaneId);
      return result.layout;
    });
  }, []);

  const handleClose = useCallback(
    (paneId: string) => {
      if (countPanes(layout) <= 1) {
        return;
      }

      const nextLayout = closePane(layout, paneId);
      killPaneSession(paneId);
      setLayout(nextLayout);
      setActivePaneId(getFirstPaneId(nextLayout));
    },
    [killPaneSession, layout]
  );

  const handleResize = useCallback((path: string, firstSize: number) => {
    setLayout((current) => resizeSplit(current, path, firstSize));
  }, []);

  const activePane = findPane(layout, activePaneId) || findPane(layout, getFirstPaneId(layout));
  const paneIds = listPaneIds(layout);

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
          <button className="workspace-item active" type="button">
            <span className="status-dot" />
            <span>Workspace</span>
            <span className="badge">{paneCount}</span>
          </button>
        </section>

        <div className="sidebar-footer">
          <div className="footer-label">Active Pane</div>
          <div className="footer-value">{activePane?.title || 'PowerShell'}</div>
          <div className="footer-path">{activePane?.cwd || 'Starting shell...'}</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="topbar-title">Terminal</div>
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
            onActivate={setActivePaneId}
            onSplit={handleSplit}
            onClose={handleClose}
            onResize={handleResize}
          />
        </div>
      </section>
    </main>
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
  onResize
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
};

function TerminalPane({
  pane,
  active,
  canClose,
  ensureSession,
  onActivate,
  onSplit,
  onClose
}: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <article
      className={`terminal-pane ${active ? 'is-active' : ''}`}
      onMouseDown={() => onActivate(pane.paneId)}
    >
      <div className="pane-toolbar">
        <div className="pane-title" title={pane.cwd}>
          {pane.title}
        </div>
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

export default App;
