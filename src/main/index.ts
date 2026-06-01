import { app, BrowserWindow, ipcMain, nativeImage, screen, shell as electronShell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { delimiter, dirname, extname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import os from 'node:os';
import * as pty from 'node-pty';

type TerminalCreateRequest = {
  cwd?: string;
  shell?: string;
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

const terminals = new Map<string, pty.IPty>();
const terminalCwds = new Map<string, string>();
const terminalOscBuffers = new Map<string, string>();
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
const browserBridgeClients = new Set<BrowserBridgeClient>();
const browserBridgePending = new Map<string, (result: BrowserBridgeCommandResult) => void>();
let browserBridgeLastError: string | undefined;
let browserBridgeEnabled = true;

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

function getTerminalEnv(shell: string): NodeJS.ProcessEnv {
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
    show: false,
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

  agentDoneOverlayEnabled = true;

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

app.whenReady().then(() => {
  showDockIcon();
  startBrowserBridgeServer();

  ipcMain.handle('terminal:get-shell-options', () => getShellOptions());

  ipcMain.handle('filesystem:list-directory', (_event, request: DirectoryListRequest) => listDirectory(request));
  ipcMain.handle('filesystem:get-image-preview', (_event, request: ImagePreviewRequest) => getImagePreview(request));
  ipcMain.handle('workspace:open-vscode', (_event, request: OpenVSCodeRequest = {}) => openVSCode(request));
  ipcMain.handle('browser:open-or-focus', (_event, request: OpenBrowserRequest = {}) => openOrFocusBrowser(request));
  ipcMain.handle('browser:get-bridge-status', () => getBrowserBridgeStatus());
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
      env: getTerminalEnv(shell)
    });

    terminals.set(id, terminal);
    terminalCwds.set(id, cwd);

    terminal.onData((data) => {
      parseTerminalCwdReports(id, data);
      mainWindow?.webContents.send('terminal:data', { id, data });
    });

    terminal.onExit(({ exitCode, signal }) => {
      terminals.delete(id);
      terminalCwds.delete(id);
      terminalOscBuffers.delete(id);
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
