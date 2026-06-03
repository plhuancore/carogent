import { app, BrowserWindow, ipcMain, nativeImage, screen, shell as electronShell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { delimiter, dirname, extname, join, relative } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, watch, readFileSync, unlinkSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { Socket } from 'node:net';
import os from 'node:os';
import * as pty from 'node-pty';

type TerminalCreateRequest = {
  cwd?: string;
  shell?: string;
  paneId?: string;
};

type TerminalShellOption = {
  shell: string;
  label: string;
  title: string;
  icon: string;
  shortcut?: string;
  isDefault?: boolean;
};

type TerminalResizeRequest = {
  id: string;
  cols: number;
  rows: number;
};

type TerminalWriteRequest = {
  id: string;
  data: string;
};

type DirectoryListRequest = {
  path: string;
};

type DirectoryEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  createdAt?: number;
  modifiedAt?: number;
};

type ImagePreviewRequest = {
  path: string;
};

type OpenVSCodeRequest = {
  path?: string;
};

type OpenBrowserRequest = {
  url?: string;
};

type BrowserDebugTarget = {
  id?: string;
  type?: string;
  url?: string;
};

type BrowserBridgeClient = {
  socket: Socket;
  buffer: Buffer;
};

type BrowserBridgeResponse = {
  id?: string;
  type?: string;
  handled?: boolean;
  enabled?: boolean;
  error?: string;
};

type BrowserBridgeStatusEvent = {
  connected: boolean;
  clientCount: number;
  enabled: boolean;
  lastError?: string;
};

type BrowserBridgeCommandResult = 'handled' | 'disabled' | 'unhandled';

type AgentDoneOverlayItem = {
  paneId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  cwd?: string;
  lines?: string[];
};

type AgentOpenPaneRequest = {
  paneId: string;
  workspaceId: string;
};

type AgentBridgePane = {
  paneId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  cwd?: string;
  shell?: string;
  browserUrl?: string;
  active: boolean;
  pinned: boolean;
  running: boolean;
};

type AgentBridgeWorkspace = {
  id: string;
  name: string;
  active: boolean;
};

type AgentBridgeSnapshot = {
  activeWorkspaceId: string;
  activePaneId: string;
  workspaces: AgentBridgeWorkspace[];
  panes: AgentBridgePane[];
};

type AgentBridgeRequest = {
  action?: string;
  paneId?: string;
  workspaceId?: string;
  text?: string;
  url?: string;
  direction?: 'row' | 'column';
  title?: string;
};

type AgentBridgeRendererRequest = {
  id: string;
  action: 'notifyDone' | 'focusPane' | 'splitPane';
  paneId: string;
  workspaceId?: string;
  direction?: 'row' | 'column';
  title?: string;
};

type AgentBridgeRendererResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

const terminals = new Map<string, pty.IPty>();
const terminalCwds = new Map<string, string>();
const terminalOscBuffers = new Map<string, string>();
const paneTerminalIds = new Map<string, string>();
const terminalPaneIds = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;
let agentDoneOverlayWindow: BrowserWindow | null = null;
let agentDoneOverlayItems: AgentDoneOverlayItem[] = [];
let agentDoneOverlayExpanded = false;
let agentDoneOverlayMovedByUser = false;
let agentDoneOverlayPositioning = false;
let agentDoneOverlayEnabled = false;
const FLOATING_BAR_COLLAPSED_HEIGHT = 44;
const FLOATING_BAR_ROW_HEIGHT = 82;
const FLOATING_BAR_MENU_GAP = 6;
const FLOATING_BAR_MENU_PADDING = 12;
const FLOATING_BAR_ITEM_WIDTH = 200;
const FLOATING_BAR_MAX_WIDTH = 220;

const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml']
]);

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const OSC_CWD_PREFIX = '\x1b]7;';
const OSC_MAX_BUFFER_LENGTH = 4096;
const BEL = '\x07';
const DEFAULT_BROWSER_URL = 'http://localhost:3000';
const DEFAULT_BROWSER_DEBUG_URL = 'http://127.0.0.1:9222';
const BROWSER_BRIDGE_PORT = 17321;
const BROWSER_BRIDGE_TIMEOUT_MS = 5000;
let agentBridgeSettings = { enabled: true, port: 17322 };
let agentBridgeServer: Server | null = null;
const AGENT_BRIDGE_MAX_BODY_BYTES = 64 * 1024;
const AGENT_BRIDGE_TOKEN = randomUUID();
const AGENT_BRIDGE_STATE_PATH = '/tmp/carogent-agent-bridge.json';
const browserBridgeClients = new Set<BrowserBridgeClient>();
const browserBridgePending = new Map<string, (result: BrowserBridgeCommandResult) => void>();
let browserBridgeLastError: string | undefined;
let browserBridgeEnabled = true;
let agentBridgeSnapshot: AgentBridgeSnapshot = {
  activeWorkspaceId: '',
  activePaneId: '',
  workspaces: [],
  panes: []
};
const agentBridgePending = new Map<string, (response: AgentBridgeRendererResponse) => void>();

function getAppIconPath(): string {
  return join(__dirname, '../../build/icon.png');
}

function getShellOptions(): TerminalShellOption[] {
  if (process.platform === 'win32') {
    return [
      {
        shell: 'cmd.exe',
        label: 'Command Prompt',
        title: 'cmd',
        icon: 'cmd',
        shortcut: 'Ctrl+Shift+1',
        isDefault: true
      },
      {
        shell: 'powershell.exe',
        label: 'Windows PowerShell',
        title: 'powershell',
        icon: 'powershell',
        shortcut: 'Ctrl+Shift+2'
      }
    ];
  }

  if (process.platform === 'darwin') {
    return [
      {
        shell: '/bin/zsh',
        label: 'zsh',
        title: 'zsh',
        icon: 'terminal',
        shortcut: 'Cmd+Shift+1',
        isDefault: true
      },
      {
        shell: '/bin/bash',
        label: 'bash',
        title: 'bash',
        icon: 'terminal',
        shortcut: 'Cmd+Shift+2'
      }
    ];
  }

  const defaultShell = process.env.SHELL || '/bin/bash';

  return [
    {
      shell: defaultShell,
      label: defaultShell.split('/').pop() || defaultShell,
      title: defaultShell.split('/').pop() || defaultShell,
      icon: 'terminal',
      isDefault: true
    }
  ];
}

function getDefaultShell(): string {
  return getShellOptions().find((option) => option.isDefault)?.shell || getShellOptions()[0].shell;
}

function getShell(requestedShell?: string): string {
  const shellOptions = getShellOptions();
  const normalizedShell = requestedShell?.toLowerCase();
  const matchedShell = shellOptions.find((option) => option.shell.toLowerCase() === normalizedShell);

  if (matchedShell) {
    return matchedShell.shell;
  }

  return getDefaultShell();
}

function getShellIntegrationDirectory(): string {
  const integrationDirectory = join(app.getPath('userData'), 'shell-integration');
  mkdirSync(integrationDirectory, { recursive: true });

  return integrationDirectory;
}

function writeShellIntegrationFile(name: string, content: string): string {
  const filePath = join(getShellIntegrationDirectory(), name);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf8');
  }

  return filePath;
}

function getBashIntegrationScript(): string {
  return writeShellIntegrationFile(
    'bashrc',
    [
      'if [ -f "$HOME/.bashrc" ]; then',
      '  . "$HOME/.bashrc"',
      'fi',
      'carogent_report_cwd() {',
      '  printf "\\033]7;file://localhost/%s\\007" "$PWD"',
      '}',
      'case "$PROMPT_COMMAND" in',
      '  *carogent_report_cwd*) ;;',
      '  "") PROMPT_COMMAND="carogent_report_cwd" ;;',
      '  *) PROMPT_COMMAND="carogent_report_cwd; $PROMPT_COMMAND" ;;',
      'esac',
      ''
    ].join('\n')
  );
}

function ensureZshIntegrationFiles(): string {
  const integrationDirectory = getShellIntegrationDirectory();
  const zprofilePath = join(integrationDirectory, '.zprofile');
  const zshrcPath = join(integrationDirectory, '.zshrc');

  if (!existsSync(zprofilePath)) {
    writeFileSync(
      zprofilePath,
      [
        'if [ -n "$CAROGENT_ORIGINAL_ZDOTDIR" ] && [ -f "$CAROGENT_ORIGINAL_ZDOTDIR/.zprofile" ]; then',
        '  . "$CAROGENT_ORIGINAL_ZDOTDIR/.zprofile"',
        'fi',
        ''
      ].join('\n'),
      'utf8'
    );
  }

  if (!existsSync(zshrcPath)) {
    writeFileSync(
      zshrcPath,
      [
        'if [ -n "$CAROGENT_ORIGINAL_ZDOTDIR" ] && [ -f "$CAROGENT_ORIGINAL_ZDOTDIR/.zshrc" ]; then',
        '  . "$CAROGENT_ORIGINAL_ZDOTDIR/.zshrc"',
        'fi',
        'carogent_report_cwd() {',
        '  printf "\\033]7;file://localhost/%s\\007" "$PWD"',
        '}',
        'autoload -Uz add-zsh-hook',
        'add-zsh-hook precmd carogent_report_cwd',
        ''
      ].join('\n'),
      'utf8'
    );
  }

  return integrationDirectory;
}

function getPowerShellIntegrationCommand(): string {
  return [
    '$global:__carogentOriginalPrompt = (Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue).ScriptBlock',
    'function global:prompt {',
    '  $cwd = (Get-Location).ProviderPath',
    '  [Console]::Write("`e]7;file://localhost/$cwd`a")',
    '  if ($global:__carogentOriginalPrompt) { & $global:__carogentOriginalPrompt } else { "PS $cwd> " }',
    '}'
  ].join('; ');
}

function getShellArgs(shell: string): string[] {
  if (process.platform === 'win32') {
    const shellName = shell.split(/[\\/]/).pop()?.toLowerCase();

    if (shellName === 'powershell.exe' || shellName === 'powershell') {
      return ['-NoExit', '-Command', getPowerShellIntegrationCommand()];
    }

    return [];
  }

  const shellName = shell.split('/').pop()?.toLowerCase();

  if (shellName === 'zsh') {
    return ['-l'];
  }

  if (shellName === 'bash') {
    return ['--init-file', getBashIntegrationScript(), '-i'];
  }

  return [];
}

function getTerminalEnv(shell: string, paneId?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const key of Object.keys(env)) {
    if (key.toLowerCase().startsWith('npm_')) {
      delete env[key];
    }
  }

  delete env.INIT_CWD;
  delete env.NODE;
  delete env.NODE_ENV;
  delete env.NODE_ENV_ELECTRON_VITE;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_ENTRY;
  delete env.ELECTRON_CLI_ARGS;
  delete env.ELECTRON_EXEC_PATH;
  delete env.ELECTRON_MAJOR_VER;
  delete env.NO_SANDBOX;

  if (env.PATH) {
    env.PATH = env.PATH.split(delimiter)
      .filter((segment) => {
        const normalized = segment.replace(/\\/g, '/');

        return !normalized.endsWith('/node_modules/.bin') && !normalized.includes('/@npmcli/run-script/lib/node-gyp-bin');
      })
      .join(delimiter);
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'Carogent';
  env.CAROGENT_BRIDGE_URL = `http://127.0.0.1:${agentBridgeSettings.port}`;
  env.CAROGENT_AGENT_TOKEN = AGENT_BRIDGE_TOKEN;
  if (paneId) {
    env.CAROGENT_PANE_ID = paneId;
  }

  const shellName = shell.split(/[\\/]/).pop()?.toLowerCase();

  if (process.platform === 'win32' && (shellName === 'cmd.exe' || shellName === 'cmd')) {
    env.PROMPT = `${OSC_CWD_PREFIX}file://localhost/$P${BEL}${env.PROMPT || '$P$G'}`;
  }

  if (shellName === 'zsh') {
    env.CAROGENT_ORIGINAL_ZDOTDIR = env.ZDOTDIR || os.homedir();
    env.ZDOTDIR = ensureZshIntegrationFiles();
  }

  return env;
}

function parseCwdPayload(payload: string): string | null {
  if (!payload.startsWith('file://')) {
    return null;
  }

  const withoutScheme = payload.slice('file://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  const pathPart = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;

  if (!pathPart) {
    return null;
  }

  let cwd: string;

  try {
    cwd = decodeURIComponent(pathPart);
  } catch {
    cwd = pathPart;
  }

  if (process.platform === 'win32') {
    cwd = cwd.replace(/\//g, '\\');
    cwd = cwd.replace(/^\\([A-Za-z]:\\)/, '$1');
  } else if (!cwd.startsWith('/')) {
    cwd = `/${cwd}`;
  }

  return cwd;
}

function reportTerminalCwd(id: string, cwd: string): void {
  if (terminalCwds.get(id) === cwd) {
    return;
  }

  terminalCwds.set(id, cwd);
  mainWindow?.webContents.send('terminal:cwd', { id, cwd });
}

function parseTerminalCwdReports(id: string, data: string): void {
  const combined = `${terminalOscBuffers.get(id) || ''}${data}`;
  const pattern = /\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(combined))) {
    const cwd = parseCwdPayload(match[1]);

    if (cwd) {
      reportTerminalCwd(id, cwd);
    }
  }

  const lastPrefixIndex = combined.lastIndexOf(OSC_CWD_PREFIX);

  if (lastPrefixIndex >= 0) {
    const tail = combined.slice(lastPrefixIndex);
    const hasTerminator = tail.includes(BEL) || tail.includes('\x1b\\');

    terminalOscBuffers.set(id, hasTerminator ? '' : tail.slice(-OSC_MAX_BUFFER_LENGTH));
    return;
  }

  terminalOscBuffers.set(id, '');
}

function expandHomePath(path: string): string {
  if (path === '~') {
    return os.homedir();
  }

  if (path.startsWith(`~${process.platform === 'win32' ? '\\' : '/'}`)) {
    return join(os.homedir(), path.slice(2));
  }

  return path;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: 'Carogent Terminal',
    backgroundColor: '#050607',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (agentDoneOverlayWindow) {
      agentDoneOverlayWindow.close();
    }
  });
}

function showDockIcon(): void {
  if (process.platform !== 'darwin') {
    return;
  }

  app.setActivationPolicy('regular');
  app.dock.setIcon(nativeImage.createFromPath(getAppIconPath()));
  app.dock.show();
}

function getRendererEntryUrl(search = ''): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    rendererUrl.search = search;
    return rendererUrl.href;
  }

  return join(__dirname, '../renderer/index.html');
}

function positionAgentDoneOverlay(): void {
  if (!agentDoneOverlayWindow || agentDoneOverlayMovedByUser) {
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = getAgentDoneOverlayWidth();
  const height = getAgentDoneOverlayHeight();

  agentDoneOverlayPositioning = true;
  agentDoneOverlayWindow.setBounds({
    x: Math.round(workArea.x + workArea.width - width - 18),
    y: Math.round(workArea.y + 18),
    width,
    height
  });
  agentDoneOverlayPositioning = false;
}

function getAgentDoneOverlayHeight(): number {
  if (!agentDoneOverlayExpanded || agentDoneOverlayItems.length === 0) {
    return FLOATING_BAR_COLLAPSED_HEIGHT;
  }

  return (
    FLOATING_BAR_COLLAPSED_HEIGHT +
    FLOATING_BAR_MENU_GAP +
    FLOATING_BAR_MENU_PADDING +
    agentDoneOverlayItems.length * FLOATING_BAR_ROW_HEIGHT
  );
}

function getAgentDoneOverlayWidth(): number {
  // Always return fixed width to prevent macOS transparent window white background glitch
  // on resize. CSS content right-aligns within the window via justify-content: flex-end.
  return Math.min(FLOATING_BAR_MAX_WIDTH, FLOATING_BAR_ITEM_WIDTH);
}

function sendAgentDoneOverlayItems(): void {
  agentDoneOverlayWindow?.webContents.send('agent-overlay:items', agentDoneOverlayItems);
}

function sendAgentDoneOverlayPinnedPaneIds(paneIds = agentDoneOverlayItems.map((item) => item.paneId)): void {
  mainWindow?.webContents.send(
    'agent-overlay:pinned-pane-ids',
    paneIds
  );
}

function sendAgentDoneOverlayVisibility(): void {
  mainWindow?.webContents.send('agent-overlay:visible', agentDoneOverlayEnabled);
}

function createAgentDoneOverlayWindow(): BrowserWindow {
  if (agentDoneOverlayWindow) {
    return agentDoneOverlayWindow;
  }

  agentDoneOverlayWindow = new BrowserWindow({
    width: Math.min(FLOATING_BAR_MAX_WIDTH, FLOATING_BAR_ITEM_WIDTH),
    height: FLOATING_BAR_COLLAPSED_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    icon: getAppIconPath(),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  agentDoneOverlayWindow.setAlwaysOnTop(true, 'floating');
  agentDoneOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionAgentDoneOverlay();

  if (process.env.ELECTRON_RENDERER_URL) {
    agentDoneOverlayWindow.loadURL(getRendererEntryUrl('?overlay=1'));
  } else {
    agentDoneOverlayWindow.loadFile(getRendererEntryUrl(), { search: 'overlay=1' });
  }

  agentDoneOverlayWindow.webContents.once('did-finish-load', sendAgentDoneOverlayItems);

  // Debounced setBackgroundColor after move to fix macOS transparent window
  // losing transparency when dragged between monitors with different display profiles.
  let moveRepaintTimer: NodeJS.Timeout | null = null;
  agentDoneOverlayWindow.on('move', () => {
    if (!agentDoneOverlayPositioning) {
      agentDoneOverlayMovedByUser = true;
    }
    if (process.platform === 'darwin') {
      if (moveRepaintTimer) clearTimeout(moveRepaintTimer);
      moveRepaintTimer = setTimeout(() => {
        if (agentDoneOverlayWindow && !agentDoneOverlayWindow.isDestroyed()) {
          agentDoneOverlayWindow.setBackgroundColor('#00000000');
        }
      }, 200);
    }
  });
  agentDoneOverlayWindow.on('closed', () => {
    agentDoneOverlayWindow = null;
  });

  return agentDoneOverlayWindow;
}

function updateAgentDoneOverlayVisibility(forceResize = true): void {
  if (!agentDoneOverlayEnabled) {
    if (agentDoneOverlayWindow && !agentDoneOverlayWindow.isDestroyed()) {
      agentDoneOverlayWindow.close();
    }
    sendAgentDoneOverlayPinnedPaneIds([]);
    sendAgentDoneOverlayVisibility();
    return;
  }

  const overlayWindow = createAgentDoneOverlayWindow();

  if (forceResize) {
    const width = getAgentDoneOverlayWidth();
    const height = getAgentDoneOverlayHeight();

    if (agentDoneOverlayMovedByUser) {
      const bounds = overlayWindow.getBounds();
      const newX = bounds.x + bounds.width - width;
      agentDoneOverlayPositioning = true;
      overlayWindow.setBounds({
        x: Math.round(newX),
        y: bounds.y,
        width,
        height
      });
      agentDoneOverlayPositioning = false;
    } else {
      positionAgentDoneOverlay();
    }
  }

  if (forceResize || !overlayWindow.isVisible()) {
    overlayWindow.showInactive();
  }

  sendAgentDoneOverlayItems();
  sendAgentDoneOverlayPinnedPaneIds();
  sendAgentDoneOverlayVisibility();
}

function showAgentDoneOverlay(item: AgentDoneOverlayItem): string[] {
  const existingIndex = agentDoneOverlayItems.findIndex((current) => current.paneId === item.paneId);
  let sizeChanged = false;
  const wasOverlayEnabled = agentDoneOverlayEnabled;

  agentDoneOverlayEnabled = true;
  if (!wasOverlayEnabled) {
    showDockIcon();
  }

  if (existingIndex !== -1) {
    // Preserve order and update in-place to avoid reordering stuttering
    agentDoneOverlayItems[existingIndex] = item;
  } else {
    agentDoneOverlayItems = [item, ...agentDoneOverlayItems].slice(0, 4);
    sizeChanged = true;
  }
  updateAgentDoneOverlayVisibility(sizeChanged);
  return agentDoneOverlayItems.map((current) => current.paneId);
}

function unpinAgentDonePane(paneId: string): string[] {
  agentDoneOverlayItems = agentDoneOverlayItems.filter((item) => item.paneId !== paneId);
  if (agentDoneOverlayItems.length === 0) {
    agentDoneOverlayExpanded = false;
  }
  updateAgentDoneOverlayVisibility(true);
  return agentDoneOverlayItems.map((item) => item.paneId);
}

function killTerminal(id: string): void {
  const terminal = terminals.get(id);

  if (!terminal) {
    return;
  }

  terminal.kill();
  terminals.delete(id);
  terminalCwds.delete(id);
  terminalOscBuffers.delete(id);
  const paneId = terminalPaneIds.get(id);
  if (paneId) {
    paneTerminalIds.delete(paneId);
  }
  terminalPaneIds.delete(id);
}

async function listDirectory(request: DirectoryListRequest): Promise<{
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
}> {
  const directoryPath = expandHomePath(request.path.trim());

  if (!directoryPath) {
    throw new Error('Enter a folder path.');
  }

  const directoryStat = await stat(directoryPath);

  if (!directoryStat.isDirectory()) {
    throw new Error('Path is not a folder.');
  }

  const dirents = await readdir(directoryPath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .map(async (dirent): Promise<DirectoryEntry> => {
        const entryPath = join(directoryPath, dirent.name);
        const entryStat = await stat(entryPath);

        return {
          name: dirent.name,
          path: entryPath,
          type: dirent.isDirectory() ? 'directory' : 'file',
          size: entryStat.size,
          createdAt: entryStat.birthtimeMs,
          modifiedAt: entryStat.mtimeMs
        };
      })
  );

  entries.sort((first, second) => {
    if (first.type !== second.type) {
      return first.type === 'directory' ? -1 : 1;
    }

    const firstTime = first.createdAt || first.modifiedAt || 0;
    const secondTime = second.createdAt || second.modifiedAt || 0;

    if (firstTime !== secondTime) {
      return secondTime - firstTime;
    }

    return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
  });

  return {
    path: directoryPath,
    parentPath: dirname(directoryPath) !== directoryPath ? dirname(directoryPath) : undefined,
    entries
  };
}

async function getImagePreview(request: ImagePreviewRequest): Promise<{ dataUrl: string }> {
  const imagePath = expandHomePath(request.path.trim());
  const extension = extname(imagePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES.get(extension);

  if (!imagePath || !mimeType) {
    throw new Error('Preview unavailable.');
  }

  const imageStat = await stat(imagePath);

  if (!imageStat.isFile() || imageStat.size > MAX_PREVIEW_BYTES) {
    throw new Error('Preview unavailable.');
  }

  const data = await readFile(imagePath);

  return {
    dataUrl: `data:${mimeType};base64,${data.toString('base64')}`
  };
}

function openVSCodeProtocol(targetPath: string): Promise<void> {
  const normalizedPath = targetPath.replace(/\\/g, '/');
  const uriPath =
    process.platform === 'win32' && /^[A-Za-z]:\//.test(normalizedPath)
      ? `/${normalizedPath}`
      : normalizedPath;

  return electronShell.openExternal(`vscode://file${encodeURI(uriPath)}`);
}

function openVSCode(request: OpenVSCodeRequest): Promise<void> {
  const targetPath = request.path?.trim() || os.homedir();

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn('code', [targetPath], {
      shell: process.platform === 'win32',
      stdio: 'ignore'
    });

    const finishWithProtocol = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      openVSCodeProtocol(targetPath).finally(resolve);
    };

    child.once('error', finishWithProtocol);

    child.once('spawn', () => {
      child.unref();
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;

      if (code === 0) {
        resolve();
        return;
      }

      openVSCodeProtocol(targetPath).finally(resolve);
    });

    setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    }, 3000);
  });
}

function createWebSocketAcceptKey(key: string): string {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function createWebSocketTextFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8');

  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }

  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);

    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);

  return Buffer.concat([header, payload]);
}

function readWebSocketMessages(client: BrowserBridgeClient, chunk: Buffer): string[] {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages: string[] = [];

  while (client.buffer.length >= 2) {
    const firstByte = client.buffer[0];
    const secondByte = client.buffer[1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (client.buffer.length < offset + 2) {
        break;
      }

      payloadLength = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (client.buffer.length < offset + 8) {
        break;
      }

      const bigLength = client.buffer.readBigUInt64BE(offset);

      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        client.socket.destroy();
        break;
      }

      payloadLength = Number(bigLength);
      offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = offset + maskLength + payloadLength;

    if (client.buffer.length < frameLength) {
      break;
    }

    if (opcode === 0x8) {
      client.socket.end();
      client.buffer = client.buffer.subarray(frameLength);
      continue;
    }

    if (opcode !== 0x1) {
      client.buffer = client.buffer.subarray(frameLength);
      continue;
    }

    const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;

    const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLength));

    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    messages.push(payload.toString('utf8'));
    client.buffer = client.buffer.subarray(frameLength);
  }

  return messages;
}

function handleBrowserBridgeMessage(message: string): void {
  let response: BrowserBridgeResponse;

  try {
    response = JSON.parse(message) as BrowserBridgeResponse;
  } catch {
    return;
  }

  if (response.type === 'hello' || response.type === 'ping') {
    if (typeof response.enabled === 'boolean') {
      browserBridgeEnabled = response.enabled;
    }

    browserBridgeLastError = undefined;
    sendBrowserBridgeStatus();
    return;
  }

  if (!response.id) {
    return;
  }

  const resolve = browserBridgePending.get(response.id);

  if (!resolve) {
    return;
  }

  browserBridgePending.delete(response.id);
  browserBridgeLastError = response.error;
  sendBrowserBridgeStatus();
  resolve(response.error === 'Extension disabled' ? 'disabled' : response.handled === true ? 'handled' : 'unhandled');
}

function getBrowserBridgeStatus(): BrowserBridgeStatusEvent {
  return {
    connected: browserBridgeClients.size > 0,
    clientCount: browserBridgeClients.size,
    enabled: browserBridgeEnabled,
    lastError: browserBridgeLastError
  };
}

function sendBrowserBridgeStatus(): void {
  mainWindow?.webContents.send('browser:bridge-status', getBrowserBridgeStatus());
}

function startBrowserBridgeServer(): void {
  const server = createServer();

  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    const key = request.headers['sec-websocket-key'];

    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${createWebSocketAcceptKey(key)}`,
        '',
        ''
      ].join('\r\n')
    );

    const client: BrowserBridgeClient = { socket, buffer: Buffer.alloc(0) };
    browserBridgeClients.add(client);
    browserBridgeLastError = undefined;
    sendBrowserBridgeStatus();

    socket.on('data', (chunk) => {
      for (const message of readWebSocketMessages(client, chunk)) {
        handleBrowserBridgeMessage(message);
      }
    });

    socket.on('close', () => {
      browserBridgeClients.delete(client);
      sendBrowserBridgeStatus();
    });
    socket.on('error', () => {
      browserBridgeClients.delete(client);
      sendBrowserBridgeStatus();
    });
  });

  server.on('error', () => {
    // Another app instance may already own the bridge port. Browser opening still falls back normally.
  });

  server.listen(BROWSER_BRIDGE_PORT, '127.0.0.1');
}

function sendBrowserBridgeCommand(url: string): Promise<BrowserBridgeCommandResult> {
  if (browserBridgeClients.size === 0) {
    return Promise.resolve('unhandled');
  }

  const id = randomUUID();
  const payload = createWebSocketTextFrame(JSON.stringify({ id, type: 'openOrFocus', url }));

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      browserBridgePending.delete(id);
      resolve('unhandled');
    }, BROWSER_BRIDGE_TIMEOUT_MS);

    browserBridgePending.set(id, (handled) => {
      clearTimeout(timeout);
      resolve(handled);
    });

    for (const client of browserBridgeClients) {
      client.socket.write(payload);
    }
  });
}

function normalizeBrowserUrl(input?: string): URL {
  const value = input?.trim() || DEFAULT_BROWSER_URL;

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return new URL(value);
  }

  const host = value.split(/[/?#]/, 1)[0];
  const isLocal = host === 'localhost' || host.startsWith('localhost:') || /^[\d.:]+$/.test(host);
  const normalizedValue = !isLocal && host && !host.includes('.') && !host.includes(':')
    ? `${host}.com${value.slice(host.length)}`
    : value;

  return new URL(`${isLocal ? 'http' : 'https'}://${normalizedValue}`);
}

function normalizeBrowserHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function shouldMatchBrowserTab(targetUrl: string, requestedUrl: URL): boolean {
  let tabUrl: URL;

  try {
    tabUrl = new URL(targetUrl);
  } catch {
    return false;
  }

  if (normalizeBrowserHostname(tabUrl.hostname) !== normalizeBrowserHostname(requestedUrl.hostname)) {
    return false;
  }

  if (requestedUrl.port && tabUrl.port !== requestedUrl.port) {
    return false;
  }

  const hasSpecificPath = requestedUrl.pathname !== '/' || requestedUrl.search !== '' || requestedUrl.hash !== '';

  if (!hasSpecificPath) {
    return true;
  }

  return tabUrl.href.startsWith(requestedUrl.href);
}

async function openOrFocusBrowser(request: OpenBrowserRequest): Promise<void> {
  const targetUrl = normalizeBrowserUrl(request.url);
  const debugUrl = process.env.CAROGENT_BROWSER_DEBUG_URL || DEFAULT_BROWSER_DEBUG_URL;

  const bridgeResult = await sendBrowserBridgeCommand(targetUrl.href);

  if (bridgeResult === 'handled' || bridgeResult === 'disabled') {
    return;
  }

  try {
    const response = await fetch(`${debugUrl.replace(/\/$/, '')}/json/list`);

    if (response.ok) {
      const targets = (await response.json()) as BrowserDebugTarget[];
      const matchedTarget = targets.find(
        (target) => target.type === 'page' && target.id && target.url && shouldMatchBrowserTab(target.url, targetUrl)
      );

      if (matchedTarget?.id) {
        await fetch(`${debugUrl.replace(/\/$/, '')}/json/activate/${encodeURIComponent(matchedTarget.id)}`);
        return;
      }
    }
  } catch {
    // Browser remote debugging is optional. Fall back to opening the URL normally.
  }

  await electronShell.openExternal(targetUrl.href);
}

function findAgentBridgePane(paneId?: string): AgentBridgePane | undefined {
  if (!paneId) {
    return undefined;
  }

  return agentBridgeSnapshot.panes.find((pane) => pane.paneId === paneId);
}

function resolveAgentBridgePaneId(request: AgentBridgeRequest): string {
  const paneId = request.paneId?.trim() || agentBridgeSnapshot.activePaneId;

  if (!paneId) {
    throw new Error('No target pane. Pass paneId or focus a Carogent pane first.');
  }

  if (!findAgentBridgePane(paneId)) {
    throw new Error(`Pane not found: ${paneId}`);
  }

  return paneId;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function isAuthorizedAgentRequest(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${AGENT_BRIDGE_TOKEN}`;
}

function readJsonBody(request: IncomingMessage): Promise<AgentBridgeRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;

      if (size > AGENT_BRIDGE_MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as AgentBridgeRequest);
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    request.on('error', reject);
  });
}

function dispatchAgentBridgeRendererRequest(
  payload: Omit<AgentBridgeRendererRequest, 'id'>
): Promise<unknown> {
  const window = mainWindow;

  if (!window || window.isDestroyed()) {
    return Promise.reject(new Error('Carogent renderer is not ready.'));
  }

  const id = randomUUID();
  const request: AgentBridgeRendererRequest = { id, ...payload };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      agentBridgePending.delete(id);
      reject(new Error('Timed out waiting for Carogent renderer.'));
    }, 5000);

    agentBridgePending.set(id, (response) => {
      clearTimeout(timeout);

      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response.result);
    });

    window.webContents.send('agent-bridge:request', request);
  });
}

async function handleAgentBridgeAction(body: AgentBridgeRequest): Promise<unknown> {
  switch (body.action) {
    case undefined:
    case 'status':
      return {
        ok: true,
        version: '1',
        activeWorkspaceId: agentBridgeSnapshot.activeWorkspaceId,
        activePaneId: agentBridgeSnapshot.activePaneId,
        workspaceCount: agentBridgeSnapshot.workspaces.length,
        paneCount: agentBridgeSnapshot.panes.length
      };

    case 'list_workspaces':
      return { workspaces: agentBridgeSnapshot.workspaces };

    case 'list_panes':
      return { panes: agentBridgeSnapshot.panes };

    case 'insert_text': {
      const paneId = resolveAgentBridgePaneId(body);
      const text = body.text;

      if (typeof text !== 'string') {
        throw new Error('insert_text requires text.');
      }

      const terminalId = paneTerminalIds.get(paneId);

      if (!terminalId || !terminals.has(terminalId)) {
        throw new Error(`Pane is not running: ${paneId}`);
      }

      terminals.get(terminalId)?.write(text);
      return { paneId, inserted: text.length };
    }

    case 'focus_pane': {
      const paneId = resolveAgentBridgePaneId(body);
      const pane = findAgentBridgePane(paneId);

      if (!pane) {
        throw new Error(`Pane not found: ${paneId}`);
      }

      if (mainWindow?.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow?.show();
      mainWindow?.focus();
      await dispatchAgentBridgeRendererRequest({
        action: 'focusPane',
        paneId,
        workspaceId: body.workspaceId || pane.workspaceId
      });
      return { paneId, workspaceId: body.workspaceId || pane.workspaceId };
    }

    case 'notify_done': {
      const paneId = resolveAgentBridgePaneId(body);
      const pane = findAgentBridgePane(paneId);

      if (!pane) {
        throw new Error(`Pane not found: ${paneId}`);
      }

      return dispatchAgentBridgeRendererRequest({
        action: 'notifyDone',
        paneId,
        workspaceId: body.workspaceId || pane.workspaceId
      });
    }

    case 'open_browser': {
      const pane = findAgentBridgePane(body.paneId);
      await openOrFocusBrowser({ url: body.url || pane?.browserUrl });
      return { opened: body.url || pane?.browserUrl || DEFAULT_BROWSER_URL };
    }

    case 'open_vscode': {
      const paneId = resolveAgentBridgePaneId(body);
      const pane = findAgentBridgePane(paneId);
      await openVSCode({ path: pane?.cwd });
      return { paneId, path: pane?.cwd || os.homedir() };
    }

    case 'split_pane': {
      const paneId = resolveAgentBridgePaneId(body);
      const direction = body.direction || 'row';
      const title = body.title;

      return dispatchAgentBridgeRendererRequest({
        action: 'splitPane',
        paneId,
        direction,
        title
      });
    }

    default:
      throw new Error(`Unknown action: ${body.action}`);
  }
}

function startAgentBridgeServer(port: number): void {
  if (agentBridgeServer) {
    try {
      agentBridgeServer.close();
    } catch (e) {
      // ignore
    }
    agentBridgeServer = null;
  }

  writeFileSync(
    AGENT_BRIDGE_STATE_PATH,
    JSON.stringify({
      bridgeUrl: `http://127.0.0.1:${port}`,
      agentToken: AGENT_BRIDGE_TOKEN
    }),
    { encoding: 'utf8', mode: 0o600 }
  );

  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp' || request.method !== 'POST') {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (!isAuthorizedAgentRequest(request)) {
      sendJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await handleAgentBridgeAction(body);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.on('error', () => {
    // Another Carogent instance may own the agent bridge port.
  });

  agentBridgeServer = server;
  server.listen(port, '127.0.0.1');
}

function stopAgentBridgeServer(): void {
  if (agentBridgeServer) {
    try {
      agentBridgeServer.close();
    } catch (e) {
      // ignore
    }
    agentBridgeServer = null;
  }

  if (existsSync(AGENT_BRIDGE_STATE_PATH)) {
    try {
      unlinkSync(AGENT_BRIDGE_STATE_PATH);
    } catch (e) {
      // ignore
    }
  }
}

app.whenReady().then(() => {
  showDockIcon();
  startBrowserBridgeServer();

  // Load agent bridge settings
  const settingsPath = join(app.getPath('userData'), 'mcp-settings.json');
  try {
    if (existsSync(settingsPath)) {
      const data = readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.enabled === 'boolean' && typeof parsed.port === 'number') {
        agentBridgeSettings = parsed;
      }
    }
  } catch (e) {
    // ignore
  }

  if (agentBridgeSettings.enabled) {
    startAgentBridgeServer(agentBridgeSettings.port);
  }

  ipcMain.handle('agent-bridge:get-settings', () => {
    return agentBridgeSettings;
  });

  ipcMain.handle('agent-bridge:set-settings', (_event, settings: { enabled: boolean; port: number }) => {
    agentBridgeSettings = settings;

    // Save settings
    const settingsPath = join(app.getPath('userData'), 'mcp-settings.json');
    try {
      writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');
    } catch (e) {
      // ignore
    }

    if (settings.enabled) {
      startAgentBridgeServer(settings.port);
    } else {
      stopAgentBridgeServer();
    }

    return agentBridgeSettings;
  });

  ipcMain.handle('agent-bridge:get-script-path', () => {
    return join(app.getAppPath(), 'scripts/carogent-mcp.mjs');
  });

  ipcMain.handle('terminal:get-shell-options', () => getShellOptions());

  ipcMain.handle('filesystem:list-directory', (_event, request: DirectoryListRequest) => listDirectory(request));
  ipcMain.handle('filesystem:get-image-preview', (_event, request: ImagePreviewRequest) => getImagePreview(request));
  ipcMain.handle('workspace:open-vscode', (_event, request: OpenVSCodeRequest = {}) => openVSCode(request));
  ipcMain.handle('browser:open-or-focus', (_event, request: OpenBrowserRequest = {}) => openOrFocusBrowser(request));
  ipcMain.handle('browser:get-bridge-status', () => getBrowserBridgeStatus());
  ipcMain.handle('agent-bridge:update-snapshot', (_event, snapshot: AgentBridgeSnapshot) => {
    agentBridgeSnapshot = snapshot;
  });
  ipcMain.handle('agent-bridge:complete-request', (_event, response: AgentBridgeRendererResponse) => {
    const resolve = agentBridgePending.get(response.id);

    if (!resolve) {
      return;
    }

    agentBridgePending.delete(response.id);
    resolve(response);
  });
  ipcMain.handle('agent-overlay:get-items', () => agentDoneOverlayItems);
  ipcMain.handle('agent-overlay:get-visible', () => agentDoneOverlayEnabled);
  ipcMain.handle('agent-overlay:show-done', (_event, item: AgentDoneOverlayItem) => {
    return showAgentDoneOverlay(item);
  });
  ipcMain.handle('agent-overlay:unpin-pane', (_event, paneId: string) => {
    return unpinAgentDonePane(paneId);
  });
  ipcMain.handle('agent-overlay:open-pane', (_event, request: AgentOpenPaneRequest) => {
    if (mainWindow?.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send('agent:open-pane', request);
  });
  ipcMain.handle('agent-overlay:close', () => {
    agentDoneOverlayEnabled = false;
    updateAgentDoneOverlayVisibility();
  });
  ipcMain.handle('agent-overlay:set-expanded', (_event, expanded: boolean) => {
    agentDoneOverlayExpanded = expanded;
    updateAgentDoneOverlayVisibility();
  });
  ipcMain.handle('agent-overlay:set-visible', (_event, visible: boolean) => {
    agentDoneOverlayEnabled = visible;
    updateAgentDoneOverlayVisibility();
    return agentDoneOverlayEnabled;
  });
  ipcMain.handle('agent-overlay:focus-app', () => {
    if (mainWindow?.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow?.show();
    mainWindow?.focus();
  });

  ipcMain.handle('terminal:create', (_event, request: TerminalCreateRequest = {}) => {
    const id = randomUUID();
    const shell = getShell(request.shell);
    const shellArgs = getShellArgs(shell);
    const cwd = request.cwd || os.homedir();
    const terminal = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env: getTerminalEnv(shell, request.paneId)
    });

    terminals.set(id, terminal);
    terminalCwds.set(id, cwd);
    if (request.paneId) {
      paneTerminalIds.set(request.paneId, id);
      terminalPaneIds.set(id, request.paneId);
    }

    terminal.onData((data) => {
      parseTerminalCwdReports(id, data);
      mainWindow?.webContents.send('terminal:data', { id, data });
    });

    terminal.onExit(({ exitCode, signal }) => {
      terminals.delete(id);
      terminalCwds.delete(id);
      terminalOscBuffers.delete(id);
      const paneId = terminalPaneIds.get(id);
      if (paneId) {
        paneTerminalIds.delete(paneId);
      }
      terminalPaneIds.delete(id);
      mainWindow?.webContents.send('terminal:exit', { id, exitCode, signal });
    });

    return { id, cwd, shell };
  });

  ipcMain.handle('terminal:resize', (_event, request: TerminalResizeRequest) => {
    const terminal = terminals.get(request.id);

    if (terminal) {
      terminal.resize(Math.max(2, request.cols), Math.max(1, request.rows));
    }
  });

  ipcMain.handle('terminal:write', (_event, request: TerminalWriteRequest) => {
    terminals.get(request.id)?.write(request.data);
  });

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    killTerminal(id);
  });

  // Git Helper Functions and IPC Handlers
  const GIT_DIFF_PREVIEW_MAX_BYTES = 1024 * 1024;
  const GIT_DIFF_PREVIEW_MAX_LINES = 5000;
  const GIT_WATCH_DEBOUNCE_MS = 450;
  const GIT_WATCH_MAX_DIRECTORIES = 2000;
  const GIT_UNTRACKED_DIRECTORY_PREVIEW_LIMIT = 200;

  type GitWatchState = {
    cwd: string;
    watchers: FSWatcher[];
    timeout: NodeJS.Timeout | null;
  };

  const gitWatchers = new Map<number, GitWatchState>();

  function runGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trimEnd());
        } else {
          reject(new Error(stderr.trim() || `Git command failed with exit code ${code}`));
        }
      });
      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  function normalizeGitPath(pathValue: string): string {
    return pathValue.replace(/\\/g, '/').replace(/^"\s*/, '').replace(/\s*"$/, '');
  }

  function parsePorcelainPath(line: string): string {
    let filePath = normalizeGitPath(line.slice(3).trim());

    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop() || filePath;
    }

    return filePath;
  }

  async function getGitWorktrees(cwd: string) {
    try {
      await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
    } catch {
      return [];
    }

    try {
      const output = await runGitCommand(['worktree', 'list', '--porcelain'], cwd);
      const blocks = output.split('\n\n');
      const worktrees: any[] = [];
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        let path = '';
        let commit = '';
        let branch = '';

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            path = line.slice(9).trim();
          } else if (line.startsWith('commit ')) {
            commit = line.slice(7).trim();
          } else if (line.startsWith('branch ')) {
            const rawBranch = line.slice(7).trim();
            branch = rawBranch.startsWith('refs/heads/')
              ? rawBranch.slice(11)
              : rawBranch;
          }
        }

        if (path) {
          const normalizedPath = path.replace(/[/\\]$/, '');
          const normalizedCwd = cwd.replace(/[/\\]$/, '');
          const isCurrent = normalizedPath.toLowerCase() === normalizedCwd.toLowerCase();
          const name = path.split(/[/\\]/).pop() || 'worktree';

          worktrees.push({
            path,
            name,
            commit,
            branch,
            isCurrent
          });
        }
      }
      return worktrees;
    } catch (err) {
      console.error('Error listing git worktrees:', err);
      return [];
    }
  }

  async function getGitStatus(cwd: string) {
    try {
      await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
    } catch {
      return { isRepo: false };
    }

    try {
      let branch = '';
      let statusText = await runGitCommand(['status', '--porcelain=v1', '-b', '--untracked-files=all'], cwd);
      const statusLines = statusText.split('\n');
      const firstLine = statusLines[0] || '';
      if (firstLine.startsWith('## ')) {
        const branchText = firstLine.slice(3);
        branch = branchText.startsWith('No commits yet on ')
          ? branchText.slice('No commits yet on '.length)
          : branchText.split('...')[0].split(' ')[0] || 'HEAD';
        statusText = statusLines.slice(1).join('\n');
      }

      const repoBasename = cwd.split(/[/\\]/).pop() || 'Repository';
      const lines = statusText ? statusText.split('\n') : [];

      const staged: any[] = [];
      const unstaged: any[] = [];

      for (const line of lines) {
        if (!line || line.length < 4) continue;
        const x = line[0];
        const y = line[1];
        const filePath = parsePorcelainPath(line);

        const isDirectory = filePath.endsWith('/');
        const displayPath = isDirectory ? filePath.slice(0, -1) : filePath;
        const fileBasename = displayPath.split(/[/\\]/).pop() || displayPath;
        const fileDir = displayPath.substring(0, displayPath.length - fileBasename.length - 1) || '';
        const kind = isDirectory ? 'directory' : 'file';

        if (['M', 'A', 'D', 'R', 'C'].includes(x)) {
          staged.push({
            path: filePath,
            status: x,
            dir: fileDir,
            name: fileBasename,
            kind
          });
        }

        if (['M', 'D'].includes(y) || (x === '?' && y === '?')) {
          unstaged.push({
            path: filePath,
            status: x === '?' ? '?' : y,
            dir: fileDir,
            name: fileBasename,
            kind
          });
        }
      }

      return {
        isRepo: true,
        branch,
        repoName: repoBasename,
        staged,
        unstaged
      };
    } catch (err: any) {
      return {
        isRepo: true,
        error: err.message || String(err)
      };
    }
  }

  function createSkippedDiff(filePath: string, reason: string) {
    return [
      `diff --git a/${filePath} b/${filePath}`,
      `--- /dev/null`,
      `+++ b/${filePath}`,
      `@@ -0,0 +1 @@`,
      `+${reason}`
    ].join('\n');
  }

  async function createUntrackedDirectoryDiff(cwd: string, filePath: string) {
    const filesText = await runGitCommand(['ls-files', '--others', '--exclude-standard', '-z', '--', filePath], cwd);
    const files = filesText.split('\0').filter(Boolean);
    const visibleFiles = files.slice(0, GIT_UNTRACKED_DIRECTORY_PREVIEW_LIMIT);
    const hiddenCount = Math.max(0, files.length - visibleFiles.length);
    const diffLines = [
      `diff --git a/${filePath} b/${filePath}`,
      `new directory mode 040000`,
      `--- /dev/null`,
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${files.length || 1} @@`
    ];

    if (visibleFiles.length === 0) {
      diffLines.push('+No untracked files found in this directory.');
    } else {
      for (const file of visibleFiles) {
        diffLines.push(`+${file}`);
      }
      if (hiddenCount > 0) {
        diffLines.push(`+... Preview truncated: ${hiddenCount} more files not shown.`);
      }
    }

    return diffLines.join('\n');
  }

  function isLikelyBinary(buffer: Buffer): boolean {
    if (buffer.includes(0)) return true;
    const sampleLength = Math.min(buffer.length, 4096);
    let suspicious = 0;

    for (let i = 0; i < sampleLength; i += 1) {
      const byte = buffer[i];
      if (byte < 7 || (byte > 14 && byte < 32)) {
        suspicious += 1;
      }
    }

    return sampleLength > 0 && suspicious / sampleLength > 0.3;
  }

  async function getGitDiff(cwd: string, filePath: string, isStaged: boolean) {
    try {
      let diff = '';
      if (isStaged) {
        diff = await runGitCommand(['diff', '--cached', '--', filePath], cwd);
      } else {
        const statusText = await runGitCommand(['status', '--porcelain', '--', filePath], cwd);
        const isUntracked = statusText.startsWith('??');

        if (isUntracked) {
          try {
            const fullPath = join(cwd, filePath);
            const fileStat = await stat(fullPath);
            if (fileStat.isDirectory()) {
              diff = await createUntrackedDirectoryDiff(cwd, filePath);
              return { diff };
            }

            if (fileStat.size > GIT_DIFF_PREVIEW_MAX_BYTES) {
              diff = createSkippedDiff(filePath, `Preview skipped: file is larger than ${GIT_DIFF_PREVIEW_MAX_BYTES / 1024 / 1024} MB.`);
              return { diff };
            }

            const buffer = await readFile(fullPath);
            if (isLikelyBinary(buffer)) {
              diff = createSkippedDiff(filePath, 'Preview skipped: binary file.');
              return { diff };
            }

            const content = buffer.toString('utf8');
            const lines = content.split('\n');
            const visibleLines = lines.slice(0, GIT_DIFF_PREVIEW_MAX_LINES);
            const truncatedLineCount = Math.max(0, lines.length - visibleLines.length);
            const diffLines = [
              `diff --git a/${filePath} b/${filePath}`,
              `new file mode 100644`,
              `--- /dev/null`,
              `+++ b/${filePath}`,
              `@@ -0,0 +1,${lines.length} @@`
            ];

            for (const line of visibleLines) {
              diffLines.push(`+${line}`);
            }
            if (truncatedLineCount > 0) {
              diffLines.push(`+... Preview truncated: ${truncatedLineCount} more lines not shown.`);
            }
            diff = diffLines.join('\n');
          } catch {
            diff = 'Could not read untracked file content.';
          }
        } else {
          diff = await runGitCommand(['diff', '--', filePath], cwd);
        }
      }
      return { diff };
    } catch (err: any) {
      return { error: err.message || String(err) };
    }
  }

  function closeGitWatchState(webContentsId: number) {
    const state = gitWatchers.get(webContentsId);
    if (!state) return;

    for (const watcher of state.watchers) {
      try {
        watcher.close();
      } catch (err) {
        console.error('Error closing watcher:', err);
      }
    }

    if (state.timeout) {
      clearTimeout(state.timeout);
    }

    gitWatchers.delete(webContentsId);
  }

  function addWatchDirectory(directories: Set<string>, cwd: string, relativeDirectory: string) {
    const normalized = normalizeGitPath(relativeDirectory).replace(/\/$/, '');
    if (!normalized || normalized === '.') {
      directories.add(cwd);
      return;
    }
    const parts = normalized.split('/').filter(Boolean);
    let current = cwd;

    directories.add(cwd);
    for (const part of parts) {
      current = join(current, part);
      directories.add(current);
    }
  }

  async function getGitWatchDirectories(cwd: string) {
    const directories = new Set<string>([cwd]);

    try {
      await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
    } catch {
      return Array.from(directories);
    }

    try {
      const filesText = await runGitCommand(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd);
      const files = filesText.split('\0').filter(Boolean);
      for (const file of files) {
        addWatchDirectory(directories, cwd, dirname(file));
        if (directories.size >= GIT_WATCH_MAX_DIRECTORIES) {
          console.warn(`Git watcher directory cap reached (${GIT_WATCH_MAX_DIRECTORIES}) for ${cwd}`);
          break;
        }
      }
    } catch (err) {
      console.error('Failed to enumerate git watch directories:', err);
    }

    const gitDirectory = join(cwd, '.git');
    const gitRefsDirectory = join(gitDirectory, 'refs');
    if (existsSync(gitDirectory)) {
      directories.add(gitDirectory);
    }
    if (existsSync(gitRefsDirectory)) {
      directories.add(gitRefsDirectory);
      await collectDirectories(gitRefsDirectory, directories);
    }

    return Array.from(directories).filter((directory) => existsSync(directory));
  }

  async function collectDirectories(parent: string, directories: Set<string>) {
    try {
      const entries = await readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const childPath = join(parent, entry.name);
        directories.add(childPath);
        await collectDirectories(childPath, directories);
      }
    } catch {
      // Refs can disappear while git updates them; next watcher restart will rescan.
    }
  }

  function shouldIgnoreWatchedPath(relativePath: string) {
    const normalized = normalizeGitPath(relativePath);
    if (!normalized) return false;

    if (normalized.startsWith('.git/')) {
      return !(
        normalized === '.git/HEAD' ||
        normalized === '.git/index' ||
        normalized.startsWith('.git/refs/')
      );
    }

    return normalized.split('/').some((part) => part.startsWith('.'));
  }

  ipcMain.handle('git:watch', async (event, { cwd }) => {
    const webContentsId = event.sender.id;
    closeGitWatchState(webContentsId);

    if (!cwd) return;

    const state: GitWatchState = {
      cwd,
      watchers: [],
      timeout: null
    };
    gitWatchers.set(webContentsId, state);
    event.sender.once('destroyed', () => {
      closeGitWatchState(webContentsId);
    });

    const sendChange = () => {
      if (state.timeout) clearTimeout(state.timeout);
      state.timeout = setTimeout(() => {
        if (!event.sender.isDestroyed() && gitWatchers.get(webContentsId) === state) {
          event.sender.send('git:change');
        }
      }, GIT_WATCH_DEBOUNCE_MS);
    };

    try {
      const directories = await getGitWatchDirectories(cwd);
      if (gitWatchers.get(webContentsId) !== state) return;

      for (const directory of directories) {
        try {
          const watcher = watch(directory, (eventType, filename) => {
            if (!filename) {
              sendChange();
              return;
            }

            const absolutePath = join(directory, filename.toString());
            const relativePath = relative(cwd, absolutePath);
            if (relativePath.startsWith('..') || shouldIgnoreWatchedPath(relativePath)) {
              return;
            }

            sendChange();
          });
          watcher.on('error', (err: any) => {
            console.error('Git watcher error:', err);
          });
          state.watchers.push(watcher);
        } catch (err) {
          console.error(`Failed to watch git directory ${directory}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to start git watcher:', err);
    }
  });

  ipcMain.handle('git:worktrees', (_event, { cwd }) => getGitWorktrees(cwd));
  ipcMain.handle('git:status', (_event, { cwd }) => getGitStatus(cwd));
  ipcMain.handle('git:diff', (_event, { cwd, filePath, isStaged }) => getGitDiff(cwd, filePath, isStaged));
  ipcMain.handle('git:stage', (_event, { cwd, filePath }) => runGitCommand(['add', filePath], cwd));
  ipcMain.handle('git:unstage', (_event, { cwd, filePath }) => runGitCommand(['reset', 'HEAD', '--', filePath], cwd));
  ipcMain.handle('git:stage-all', (_event, { cwd }) => runGitCommand(['add', '-A'], cwd));
  ipcMain.handle('git:unstage-all', (_event, { cwd }) => runGitCommand(['reset', 'HEAD'], cwd));
  ipcMain.handle('git:discard-all', async (_event, { cwd }) => {
    await runGitCommand(['checkout', '--', '.'], cwd);
    await runGitCommand(['clean', '-fd'], cwd);
  });
  ipcMain.handle('git:discard', async (_event, { cwd, filePath, isUntracked }) => {
    if (isUntracked) {
      const fullPath = join(cwd, filePath);
      const fileStat = await stat(fullPath);
      if (fileStat.isDirectory()) {
        await rm(fullPath, { recursive: true, force: true });
      } else {
        await unlink(fullPath);
      }
    } else {
      await runGitCommand(['checkout', '--', filePath], cwd);
    }
  });
  ipcMain.handle('git:commit', (_event, { cwd, message }) => runGitCommand(['commit', '-m', message], cwd));
  ipcMain.handle('git:history', (_event, { cwd }) => runGitCommand(['log', '--all', '--date-order', '--pretty=format:%H|%P|%d|%s|%an|%cr|%ct', '-n', '100'], cwd));
  ipcMain.handle('git:init', (_event, { cwd }) => runGitCommand(['init'], cwd));
  ipcMain.handle('git:undo-last-commit', async (_event, { cwd }) => {
    let message = '';
    try {
      message = await runGitCommand(['log', '-1', '--pretty=%B'], cwd);
    } catch (e) {
      // ignore
    }
    await runGitCommand(['reset', '--soft', 'HEAD~1'], cwd);
    return message;
  });

  createWindow();

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow();
    }

    if (agentDoneOverlayEnabled) {
      updateAgentDoneOverlayVisibility();
    }
  });
});

app.on('before-quit', () => {
  for (const id of terminals.keys()) {
    killTerminal(id);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
