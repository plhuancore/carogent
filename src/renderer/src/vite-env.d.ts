/// <reference types="vite/client" />

import type { TerminalApi } from '../../shared/ipcTypes';

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}

export {};
