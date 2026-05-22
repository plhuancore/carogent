import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { delimiter, dirname, extname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
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

const terminals = new Map<string, pty.IPty>();
const terminalCwds = new Map<string, string>();
const terminalOscBuffers = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;

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
  });
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

app.whenReady().then(() => {
  ipcMain.handle('terminal:get-shell-options', () => getShellOptions());

  ipcMain.handle('filesystem:list-directory', (_event, request: DirectoryListRequest) => listDirectory(request));
  ipcMain.handle('filesystem:get-image-preview', (_event, request: ImagePreviewRequest) => getImagePreview(request));

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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
