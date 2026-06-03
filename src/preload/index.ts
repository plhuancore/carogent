import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';

type TerminalCreateRequest = {
  cwd?: string;
  shell?: string;
  paneId?: string;
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
};

type AgentOpenPaneRequest = {
  paneId: string;
  workspaceId: string;
};

type AgentBridgePane = {
  paneId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  cwd?: string;
  shell?: string;
  browserUrl?: string;
  active: boolean;
  pinned: boolean;
  running: boolean;
};

type AgentBridgeWorkspace = {
  id: string;
  name: string;
  active: boolean;
};

type AgentBridgeSnapshot = {
  activeWorkspaceId: string;
  activePaneId: string;
  workspaces: AgentBridgeWorkspace[];
  panes: AgentBridgePane[];
};

type AgentBridgeRendererRequest = {
  id: string;
  action: 'notifyDone' | 'focusPane';
  paneId: string;
  workspaceId?: string;
};

type AgentBridgeRendererResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

const terminal = {
  getAgentBridgeSettings: (): Promise<{ enabled: boolean; port: number }> =>
    ipcRenderer.invoke('agent-bridge:get-settings'),
  setAgentBridgeSettings: (settings: { enabled: boolean; port: number }): Promise<{ enabled: boolean; port: number }> =>
    ipcRenderer.invoke('agent-bridge:set-settings', settings),
  getAgentBridgeScriptPath: (): Promise<string> =>
    ipcRenderer.invoke('agent-bridge:get-script-path'),
  getShellOptions: (): Promise<TerminalShellOption[]> =>
    ipcRenderer.invoke('terminal:get-shell-options'),
  listDirectory: (request: { path: string }): Promise<DirectoryListResult> =>
    ipcRenderer.invoke('filesystem:list-directory', request),
  getImagePreview: (request: { path: string }): Promise<ImagePreviewResult> =>
    ipcRenderer.invoke('filesystem:get-image-preview', request),
  openInVSCode: (request: { path?: string }): Promise<void> =>
    ipcRenderer.invoke('workspace:open-vscode', request),
  openOrFocusBrowser: (request: { url?: string }): Promise<void> =>
    ipcRenderer.invoke('browser:open-or-focus', request),
  getBrowserBridgeStatus: (): Promise<BrowserBridgeStatusEvent> =>
    ipcRenderer.invoke('browser:get-bridge-status'),
  getAgentDoneOverlayItems: (): Promise<AgentDoneOverlayItem[]> =>
    ipcRenderer.invoke('agent-overlay:get-items'),
  getAgentDoneOverlayVisible: (): Promise<boolean> =>
    ipcRenderer.invoke('agent-overlay:get-visible'),
  showAgentDoneOverlay: (item: AgentDoneOverlayItem): Promise<string[]> =>
    ipcRenderer.invoke('agent-overlay:show-done', item),
  unpinAgentDonePane: (paneId: string): Promise<string[]> =>
    ipcRenderer.invoke('agent-overlay:unpin-pane', paneId),
  openAgentDonePane: (request: AgentOpenPaneRequest): Promise<void> =>
    ipcRenderer.invoke('agent-overlay:open-pane', request),
  closeAgentDoneOverlay: (): Promise<void> =>
    ipcRenderer.invoke('agent-overlay:close'),
  setAgentDoneOverlayExpanded: (expanded: boolean): Promise<void> =>
    ipcRenderer.invoke('agent-overlay:set-expanded', expanded),
  setAgentDoneOverlayVisible: (visible: boolean): Promise<boolean> =>
    ipcRenderer.invoke('agent-overlay:set-visible', visible),
  focusCarogentApp: (): Promise<void> =>
    ipcRenderer.invoke('agent-overlay:focus-app'),
  updateAgentBridgeSnapshot: (snapshot: AgentBridgeSnapshot): Promise<void> =>
    ipcRenderer.invoke('agent-bridge:update-snapshot', snapshot),
  completeAgentBridgeRequest: (response: AgentBridgeRendererResponse): Promise<void> =>
    ipcRenderer.invoke('agent-bridge:complete-request', response),
  create: (request?: TerminalCreateRequest): Promise<TerminalCreated> =>
    ipcRenderer.invoke('terminal:create', request),
  resize: (request: { id: string; cols: number; rows: number }): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', request),
  write: (request: { id: string; data: string }): Promise<void> =>
    ipcRenderer.invoke('terminal:write', request),
  readClipboardText: (): string => clipboard.readText(),
  writeClipboardText: (text: string): void => clipboard.writeText(text),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  kill: (id: string): Promise<void> => ipcRenderer.invoke('terminal:kill', id),
  onData: (callback: (event: TerminalDataEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void => {
      callback(payload);
    };

    ipcRenderer.on('terminal:data', listener);

    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onCwd: (callback: (event: TerminalCwdEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalCwdEvent): void => {
      callback(payload);
    };

    ipcRenderer.on('terminal:cwd', listener);

    return () => ipcRenderer.removeListener('terminal:cwd', listener);
  },
  onBrowserBridgeStatus: (callback: (event: BrowserBridgeStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BrowserBridgeStatusEvent): void => {
      callback(payload);
    };

    ipcRenderer.on('browser:bridge-status', listener);

    return () => ipcRenderer.removeListener('browser:bridge-status', listener);
  },
  onAgentDoneOverlayItems: (callback: (items: AgentDoneOverlayItem[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentDoneOverlayItem[]): void => {
      callback(payload);
    };

    ipcRenderer.on('agent-overlay:items', listener);

    return () => ipcRenderer.removeListener('agent-overlay:items', listener);
  },
  onAgentDoneOverlayVisible: (callback: (visible: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: boolean): void => {
      callback(payload);
    };

    ipcRenderer.on('agent-overlay:visible', listener);

    return () => ipcRenderer.removeListener('agent-overlay:visible', listener);
  },
  onAgentDoneOverlayPinnedPaneIds: (callback: (paneIds: string[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: string[]): void => {
      callback(payload);
    };

    ipcRenderer.on('agent-overlay:pinned-pane-ids', listener);

    return () => ipcRenderer.removeListener('agent-overlay:pinned-pane-ids', listener);
  },
  onOpenAgentPane: (callback: (request: AgentOpenPaneRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentOpenPaneRequest): void => {
      callback(payload);
    };

    ipcRenderer.on('agent:open-pane', listener);

    return () => ipcRenderer.removeListener('agent:open-pane', listener);
  },
  onAgentBridgeRequest: (callback: (request: AgentBridgeRendererRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentBridgeRendererRequest): void => {
      callback(payload);
    };

    ipcRenderer.on('agent-bridge:request', listener);

    return () => ipcRenderer.removeListener('agent-bridge:request', listener);
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
