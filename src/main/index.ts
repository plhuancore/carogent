import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { delimiter, dirname, join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
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
  modifiedAt?: number;
};

const terminals = new Map<string, pty.IPty>();
let mainWindow: BrowserWindow | null = null;

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

function getShellArgs(shell: string): string[] {
  if (process.platform !== 'darwin') {
    return [];
  }

  const shellName = shell.split('/').pop()?.toLowerCase();

  if (shellName === 'zsh') {
    return ['-l'];
  }

  if (shellName === 'bash') {
    return ['--login'];
  }

  return [];
}

function getTerminalEnv(): NodeJS.ProcessEnv {
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

  return env;
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
}

async function listDirectory(request: DirectoryListRequest): Promise<{
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
}> {
  const directoryPath = request.path.trim();

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
          modifiedAt: entryStat.mtimeMs
        };
      })
  );

  entries.sort((first, second) => {
    if (first.type !== second.type) {
      return first.type === 'directory' ? -1 : 1;
    }

    return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
  });

  return {
    path: directoryPath,
    parentPath: dirname(directoryPath) !== directoryPath ? dirname(directoryPath) : undefined,
    entries
  };
}

app.whenReady().then(() => {
  ipcMain.handle('terminal:get-shell-options', () => getShellOptions());

  ipcMain.handle('filesystem:list-directory', (_event, request: DirectoryListRequest) => listDirectory(request));

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
      env: getTerminalEnv()
    });

    terminals.set(id, terminal);

    terminal.onData((data) => {
      mainWindow?.webContents.send('terminal:data', { id, data });
    });

    terminal.onExit(({ exitCode, signal }) => {
      terminals.delete(id);
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
