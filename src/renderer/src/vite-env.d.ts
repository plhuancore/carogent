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

type TerminalCwdEvent = {
  id: string;
  cwd: string;
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

interface Window {
  terminalApi: {
    getShellOptions: () => Promise<TerminalShellOption[]>;
    listDirectory: (request: { path: string }) => Promise<DirectoryListResult>;
    getImagePreview: (request: { path: string }) => Promise<ImagePreviewResult>;
    create: (request?: TerminalCreateRequest) => Promise<TerminalCreated>;
    resize: (request: { id: string; cols: number; rows: number }) => Promise<void>;
    write: (request: { id: string; data: string }) => Promise<void>;
    readClipboardText: () => string;
    getPathForFile: (file: File) => string;
    kill: (id: string) => Promise<void>;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onCwd: (callback: (event: TerminalCwdEvent) => void) => () => void;
    onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  };
}
