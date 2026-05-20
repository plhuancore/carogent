/// <reference types="vite/client" />

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
  modifiedAt?: number;
};

type DirectoryListResult = {
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
};

interface Window {
  terminalApi: {
    getShellOptions: () => Promise<TerminalShellOption[]>;
    listDirectory: (request: { path: string }) => Promise<DirectoryListResult>;
    create: (request?: TerminalCreateRequest) => Promise<TerminalCreated>;
    resize: (request: { id: string; cols: number; rows: number }) => Promise<void>;
    write: (request: { id: string; data: string }) => Promise<void>;
    getPathForFile: (file: File) => string;
    kill: (id: string) => Promise<void>;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  };
}
