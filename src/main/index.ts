import { app, BrowserWindow, ipcMain, nativeImage, screen, shell as electronShell } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import os from 'node:os';
import * as pty from 'node-pty';
import { getImagePreview, listDirectory } from './filesystem';
import { createBrowserBridge, DEFAULT_BROWSER_URL } from './browserBridge';
import { registerGitIpcHandlers } from './git/registerGitIpcHandlers';
import type {
  AgentBridgePane,
  AgentBridgeRendererRequest,
  AgentBridgeRendererResponse,
  AgentBridgeRequest,
  AgentBridgeSnapshot,
  AgentBridgeWorkspace,
  AgentDoneOverlayItem,
  AgentOpenPaneRequest,
  BrowserBridgeStatusEvent,
  DirectoryListRequest,
  ImagePreviewRequest,
  OpenBrowserRequest,
  OpenVSCodeRequest,
  TerminalCreateRequest,
  TerminalResizeRequest,
  TerminalShellOption,
  TerminalWriteRequest
} from '../shared/ipcTypes';

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

const OSC_CWD_PREFIX = '\x1b]7;';
const OSC_MAX_BUFFER_LENGTH = 4096;
const BEL = '\x07';
let agentBridgeSettings = { enabled: true, port: 17322 };
let agentBridgeServer: Server | null = null;
const AGENT_BRIDGE_MAX_BODY_BYTES = 64 * 1024;
const AGENT_BRIDGE_TOKEN = randomUUID();
const AGENT_BRIDGE_STATE_PATH = join(os.tmpdir(), 'carogent-agent-bridge.json');
let agentBridgeSnapshot: AgentBridgeSnapshot = {
  activeWorkspaceId: '',
  activePaneId: '',
  workspaces: [],
  panes: []
};
const agentBridgePending = new Map<string, (response: AgentBridgeRendererResponse) => void>();
const browserBridge = createBrowserBridge(() => mainWindow);

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

  agentDoneOverlayWindow.setHasShadow(false);
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
    const existing = agentDoneOverlayItems[existingIndex];
    if (item.notifyTimestamp !== undefined) {
      item.hasUnreadNotification = true;
    } else {
      item.notifyTimestamp = existing.notifyTimestamp;
      item.hasUnreadNotification = existing.hasUnreadNotification;
    }
    // Preserve order and update in-place to avoid reordering stuttering
    agentDoneOverlayItems[existingIndex] = item;
  } else {
    if (item.notifyTimestamp !== undefined) {
      item.hasUnreadNotification = true;
    } else {
      item.hasUnreadNotification = false;
    }
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

      // Fire and forget so we don't block waiting for the renderer response
      dispatchAgentBridgeRendererRequest({
        action: 'notifyDone',
        paneId,
        workspaceId: body.workspaceId || pane.workspaceId
      }).catch((err) => {
        console.error('Failed to notify done in renderer:', err);
      });

      return { paneId, workspaceId: body.workspaceId || pane.workspaceId };
    }

    case 'open_browser': {
      const pane = findAgentBridgePane(body.paneId);
      await browserBridge.openOrFocus({ url: body.url || pane?.browserUrl });
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
  browserBridge.start();

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
  ipcMain.handle('browser:open-or-focus', (_event, request: OpenBrowserRequest = {}) => browserBridge.openOrFocus(request));
  ipcMain.handle('browser:get-bridge-status', () => browserBridge.getStatus());
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

    const existing = agentDoneOverlayItems.find((item) => item.paneId === request.paneId);
    if (existing) {
      existing.hasUnreadNotification = false;
      sendAgentDoneOverlayItems();
    }
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

  registerGitIpcHandlers();

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
