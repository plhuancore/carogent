import { Terminal } from '@xterm/xterm';
import type { IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import type { TerminalShellOption } from '../../shared/ipcTypes';
import type { PaneNode } from './layout';

export type TerminalSession = {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  input: IDisposable;
  fitFrame?: number;
  fitTimer?: number;
  restoreScrollFrame?: number;
  restoreScrollTimer?: number;
  viewportY?: number;
  viewportAtBottom?: boolean;
  viewportBottomOffset?: number;
  isScrollCaptured?: boolean;
  terminalId?: string;
  cwd?: string;
  shell?: string;
  status: 'starting' | 'running' | 'exited';
};

export type SessionRegistry = Map<string, TerminalSession>;

type TerminalWithViewportSync = Terminal & {
  _core?: {
    viewport?: {
      syncScrollArea: (immediate?: boolean) => void;
    };
  };
};

export function getDefaultShellOption(shellOptions: TerminalShellOption[]): TerminalShellOption {
  return shellOptions.find((option) => option.isDefault) || shellOptions[0];
}

export function getShellOption(shellOptions: TerminalShellOption[], shell?: string): TerminalShellOption {
  const normalizedShell = shell?.toLowerCase();

  return (
    shellOptions.find((option) => option.shell.toLowerCase() === normalizedShell) ||
    getDefaultShellOption(shellOptions)
  );
}

export function getPaneShell(shellOptions: TerminalShellOption[], pane: PaneNode): string {
  return getShellOption(shellOptions, pane.shell).shell;
}

export function getShellTitle(shellOptions: TerminalShellOption[], shell?: string): string {
  return getShellOption(shellOptions, shell).title;
}

function getTerminalFontFamily(): string {
  if (navigator.platform.toLowerCase().includes('win')) {
    return 'Consolas, "Courier New", monospace';
  }

  return '"SF Mono", "SFMono-Regular", Menlo, Monaco, "Cascadia Mono", "Consolas", monospace';
}

export function createXterm(): Terminal {
  return new Terminal({
    allowProposedApi: true,
    windowsMode: navigator.platform.toLowerCase().includes('win'),
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
      background: '#15141a',
      foreground: '#e7e3ee',
      cursor: '#c4b5fd',
      selectionBackground: '#a78bfa55',
      black: '#24212c',
      red: '#f38ba8',
      green: '#8ee6b0',
      yellow: '#f5c77a',
      blue: '#8bb9ff',
      magenta: '#f0abfc',
      cyan: '#94e2d5',
      white: '#e7e3ee',
      brightBlack: '#a7a0b8',
      brightRed: '#ffb4c8',
      brightGreen: '#b5f4ca',
      brightYellow: '#ffe0a3',
      brightBlue: '#b6d2ff',
      brightMagenta: '#f6c7ff',
      brightCyan: '#b6f2e8',
      brightWhite: '#ffffff'
    }
  });
}

function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function copyTerminalSelection(terminal: Terminal): boolean {
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

export function fitTerminalSession(session: TerminalSession): void {
  if (!session.terminal.element?.parentElement) {
    return;
  }

  try {
    if (!session.isScrollCaptured) {
      captureTerminalScroll(session);
    }
    session.fitAddon.fit();

    if (session.terminalId) {
      window.terminalApi.resize({
        id: session.terminalId,
        cols: session.terminal.cols,
        rows: session.terminal.rows
      });
    }

    scheduleTerminalScrollRestore(session);
  } catch {
    // xterm can briefly have zero dimensions while panes attach, split, or hide.
  }
}

export function scheduleTerminalFit(session: TerminalSession): void {
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

export function captureTerminalScroll(session: TerminalSession): void {
  const buffer = session.terminal.buffer?.active;
  if (!buffer) {
    return;
  }
  const viewport = session.terminal.element?.querySelector<HTMLElement>('.xterm-viewport');
  const domAtBottom = viewport
    ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    : false;

  session.viewportY = buffer.viewportY;
  session.viewportBottomOffset = Math.max(0, buffer.baseY - buffer.viewportY);
  session.viewportAtBottom = domAtBottom || session.viewportBottomOffset <= 1;
  session.isScrollCaptured = true;
}

function syncTerminalScrollArea(session: TerminalSession): void {
  (session.terminal as TerminalWithViewportSync)._core?.viewport?.syncScrollArea(true);
}

function restoreTerminalScroll(session: TerminalSession): void {
  if (!session.terminal.element?.parentElement || session.viewportY === undefined) {
    return;
  }

  const buffer = session.terminal.buffer?.active;
  if (!buffer) {
    session.isScrollCaptured = false;
    return;
  }

  if (session.viewportAtBottom) {
    session.terminal.scrollToBottom();
    syncTerminalScrollArea(session);
    session.isScrollCaptured = false;
    return;
  }

  session.terminal.scrollToLine(Math.min(session.viewportY, buffer.baseY));
  syncTerminalScrollArea(session);
  session.isScrollCaptured = false;
}

export function scheduleTerminalScrollRestore(session: TerminalSession): void {
  restoreTerminalScroll(session);

  if (session.restoreScrollFrame === undefined) {
    session.restoreScrollFrame = window.requestAnimationFrame(() => {
      session.restoreScrollFrame = undefined;
      restoreTerminalScroll(session);
    });
  }

  if (session.restoreScrollTimer !== undefined) {
    window.clearTimeout(session.restoreScrollTimer);
  }

  session.restoreScrollTimer = window.setTimeout(() => {
    session.restoreScrollTimer = undefined;
    restoreTerminalScroll(session);
  }, 75);
}

export function clearTerminalFitTimers(session: TerminalSession): void {
  if (session.fitFrame !== undefined) {
    window.cancelAnimationFrame(session.fitFrame);
    session.fitFrame = undefined;
  }

  if (session.fitTimer !== undefined) {
    window.clearTimeout(session.fitTimer);
    session.fitTimer = undefined;
  }

  if (session.restoreScrollFrame !== undefined) {
    window.cancelAnimationFrame(session.restoreScrollFrame);
    session.restoreScrollFrame = undefined;
  }

  if (session.restoreScrollTimer !== undefined) {
    window.clearTimeout(session.restoreScrollTimer);
    session.restoreScrollTimer = undefined;
  }
}

export function getTerminalPreviewLines(session: TerminalSession): string[] {
  const buffer = session.terminal.buffer?.active;
  if (!buffer) {
    return [];
  }
  const lines: string[] = [];
  const end = Math.min(buffer.length - 1, Math.max(6, buffer.baseY + buffer.cursorY));
  const start = Math.max(0, end - 6);

  for (let index = start; index <= end; index += 1) {
    const line = buffer.getLine(index);

    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  return lines;
}
