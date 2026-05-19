import { contextBridge, ipcRenderer } from 'electron';

type TerminalCreateRequest = {
  cwd?: string;
  shell?: string;
};

type TerminalCreated = {
  id: string;
  cwd: string;
  shell: string;
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

const terminal = {
  create: (request?: TerminalCreateRequest): Promise<TerminalCreated> =>
    ipcRenderer.invoke('terminal:create', request),
  resize: (request: { id: string; cols: number; rows: number }): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', request),
  write: (request: { id: string; data: string }): Promise<void> =>
    ipcRenderer.invoke('terminal:write', request),
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
