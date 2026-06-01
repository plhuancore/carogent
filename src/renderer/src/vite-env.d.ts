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

type BrowserBridgeStatusEvent = {
  connected: boolean;
  clientCount: number;
  enabled: boolean;
  lastError?: string;
};

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

interface Window {
  terminalApi: {
    getShellOptions: () => Promise<TerminalShellOption[]>;
    listDirectory: (request: { path: string }) => Promise<DirectoryListResult>;
    getImagePreview: (request: { path: string }) => Promise<ImagePreviewResult>;
    openInVSCode: (request: { path?: string }) => Promise<void>;
    openOrFocusBrowser: (request: { url?: string }) => Promise<void>;
    getBrowserBridgeStatus: () => Promise<BrowserBridgeStatusEvent>;
    getAgentDoneOverlayItems: () => Promise<AgentDoneOverlayItem[]>;
    getAgentDoneOverlayVisible: () => Promise<boolean>;
    showAgentDoneOverlay: (item: AgentDoneOverlayItem) => Promise<string[]>;
    unpinAgentDonePane: (paneId: string) => Promise<string[]>;
    openAgentDonePane: (request: AgentOpenPaneRequest) => Promise<void>;
    closeAgentDoneOverlay: () => Promise<void>;
    setAgentDoneOverlayExpanded: (expanded: boolean) => Promise<void>;
    setAgentDoneOverlayVisible: (visible: boolean) => Promise<boolean>;
    focusCarogentApp: () => Promise<void>;
    create: (request?: TerminalCreateRequest) => Promise<TerminalCreated>;
    resize: (request: { id: string; cols: number; rows: number }) => Promise<void>;
    write: (request: { id: string; data: string }) => Promise<void>;
    readClipboardText: () => string;
    writeClipboardText: (text: string) => void;
    getPathForFile: (file: File) => string;
    kill: (id: string) => Promise<void>;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onCwd: (callback: (event: TerminalCwdEvent) => void) => () => void;
    onBrowserBridgeStatus: (callback: (event: BrowserBridgeStatusEvent) => void) => () => void;
    onAgentDoneOverlayItems: (callback: (items: AgentDoneOverlayItem[]) => void) => () => void;
    onAgentDoneOverlayVisible: (callback: (visible: boolean) => void) => () => void;
    onAgentDoneOverlayPinnedPaneIds: (callback: (paneIds: string[]) => void) => () => void;
    onOpenAgentPane: (callback: (request: AgentOpenPaneRequest) => void) => () => void;
    onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  };
}
