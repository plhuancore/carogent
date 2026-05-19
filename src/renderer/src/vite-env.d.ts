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

type TerminalDataEvent = {
  id: string;
  data: string;
};

type TerminalExitEvent = {
  id: string;
  exitCode: number;
  signal?: number;
};

interface Window {
  terminalApi: {
    create: (request?: TerminalCreateRequest) => Promise<TerminalCreated>;
    resize: (request: { id: string; cols: number; rows: number }) => Promise<void>;
    write: (request: { id: string; data: string }) => Promise<void>;
    kill: (id: string) => Promise<void>;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  };
}
