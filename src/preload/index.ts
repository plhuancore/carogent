import { contextBridge, ipcRenderer, webUtils } from 'electron';

type TerminalCreateRequest = {
  cwd?: string;
  shell?: string;
};

type TerminalCreated = {
  id: string;
  cwd: string;
  shell: string;
};

type TerminalShellOption = {
  shell: string;
  label: string;
  title: string;
  icon: string;
  shortcut?: string;
  isDefault?: boolean;
};

type TerminalDataEvent = {
  id: string;
  data: string;
};

type TerminalExitEvent = {
  id: string;
  exitCode: number;
  signal?: number;
};

type DirectoryEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  createdAt?: number;
  modifiedAt?: number;
};

type DirectoryListResult = {
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
};

type ImagePreviewResult = {
  dataUrl: string;
};

const terminal = {
  getShellOptions: (): Promise<TerminalShellOption[]> =>
    ipcRenderer.invoke('terminal:get-shell-options'),
  listDirectory: (request: { path: string }): Promise<DirectoryListResult> =>
    ipcRenderer.invoke('filesystem:list-directory', request),
  getImagePreview: (request: { path: string }): Promise<ImagePreviewResult> =>
    ipcRenderer.invoke('filesystem:get-image-preview', request),
  create: (request?: TerminalCreateRequest): Promise<TerminalCreated> =>
    ipcRenderer.invoke('terminal:create', request),
  resize: (request: { id: string; cols: number; rows: number }): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', request),
  write: (request: { id: string; data: string }): Promise<void> =>
    ipcRenderer.invoke('terminal:write', request),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  kill: (id: string): Promise<void> => ipcRenderer.invoke('terminal:kill', id),
  onData: (callback: (event: TerminalDataEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void => {
      callback(payload);
    };

    ipcRenderer.on('terminal:data', listener);

    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onExit: (callback: (event: TerminalExitEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void => {
      callback(payload);
    };

    ipcRenderer.on('terminal:exit', listener);

    return () => ipcRenderer.removeListener('terminal:exit', listener);
  }
};

contextBridge.exposeInMainWorld('terminalApi', terminal);
