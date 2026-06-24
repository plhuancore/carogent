import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AgentBridgeRendererRequest,
  AgentBridgeRendererResponse,
  AgentBridgeSnapshot,
  AgentDoneOverlayItem,
  AgentOpenPaneRequest,
  BrowserBridgeStatusEvent,
  DirectoryListResult,
  FileSystemCreateEntryRequest,
  FileSystemCreateEntryResult,
  FileSystemDeleteEntryRequest,
  FileSystemRenameEntryRequest,
  FileSystemRenameEntryResult,
  ImagePreviewResult,
  RevealInFinderRequest,
  TerminalApi,
  TerminalCreated,
  TerminalCreateRequest,
  TerminalCwdEvent,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalShellOption,
  TextFileReadResult,
  TextFileWriteResult,
  FileSearchRequest,
  FileSearchResult,
  FindFilesRequest,
  FindFilesResult,
  GitImageDiffResult
} from '../shared/ipcTypes';

const terminal: TerminalApi = {
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
  readTextFile: async (request: { path: string }): Promise<TextFileReadResult> => {
    const result = await ipcRenderer.invoke('filesystem:read-text-file', request);
    if (result && result.error) {
      throw new Error(result.message || result.error);
    }
    return result;
  },
  writeTextFile: (request: { path: string; content: string }): Promise<TextFileWriteResult> =>
    ipcRenderer.invoke('filesystem:write-text-file', request),
  createFileSystemEntry: (request: FileSystemCreateEntryRequest): Promise<FileSystemCreateEntryResult> =>
    ipcRenderer.invoke('filesystem:create-entry', request),
  renameFileSystemEntry: (request: FileSystemRenameEntryRequest): Promise<FileSystemRenameEntryResult> =>
    ipcRenderer.invoke('filesystem:rename-entry', request),
  deleteFileSystemEntry: (request: FileSystemDeleteEntryRequest): Promise<void> =>
    ipcRenderer.invoke('filesystem:delete-entry', request),
  searchFiles: (request: FileSearchRequest): Promise<FileSearchResult> =>
    ipcRenderer.invoke('filesystem:search-files', request),
  findFiles: (request: FindFilesRequest): Promise<FindFilesResult> =>
    ipcRenderer.invoke('filesystem:find-files', request),
  openInVSCode: (request: { path?: string }): Promise<void> =>
    ipcRenderer.invoke('workspace:open-vscode', request),
  revealInFinder: (request: RevealInFinderRequest): Promise<void> =>
    ipcRenderer.invoke('workspace:reveal-in-finder', request),
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
  reorderAgentDoneOverlayItems: (paneIds: string[]): Promise<string[]> =>
    ipcRenderer.invoke('agent-overlay:reorder-items', paneIds),
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
  },
  gitStatus: (request: { cwd: string }): Promise<any> =>
    ipcRenderer.invoke('git:status', request),
  gitDiff: (request: { cwd: string; filePath: string; isStaged: boolean }): Promise<{ diff?: string; error?: string }> =>
    ipcRenderer.invoke('git:diff', request),
  gitFileContents: (request: { cwd: string; filePath: string; source: 'workingTree' | 'index' | 'head' | 'commit'; ref?: string }): Promise<{ content?: string; error?: string }> =>
    ipcRenderer.invoke('git:file-contents', request),
  gitImageDiff: (request: { cwd: string; filePath: string; isStaged: boolean; hash?: string }): Promise<GitImageDiffResult> =>
    ipcRenderer.invoke('git:image-diff', request),
  gitFileSnippet: (request: { cwd: string; filePath: string; source: 'workingTree' | 'index' | 'commit'; ref?: string; startLine: number; lineCount: number }): Promise<{ lines?: string[]; error?: string }> =>
    ipcRenderer.invoke('git:file-snippet', request),
  gitStage: (request: { cwd: string; filePath: string }): Promise<void> =>
    ipcRenderer.invoke('git:stage', request),
  gitUnstage: (request: { cwd: string; filePath: string }): Promise<void> =>
    ipcRenderer.invoke('git:unstage', request),
  gitStageAll: (request: { cwd: string }): Promise<void> =>
    ipcRenderer.invoke('git:stage-all', request),
  gitUnstageAll: (request: { cwd: string }): Promise<void> =>
    ipcRenderer.invoke('git:unstage-all', request),
  gitDiscard: (request: { cwd: string; filePath: string; isUntracked: boolean }): Promise<void> =>
    ipcRenderer.invoke('git:discard', request),
  gitCommit: (request: { cwd: string; message: string }): Promise<void> =>
    ipcRenderer.invoke('git:commit', request),
  gitHistory: (request: { cwd: string; limit?: number; skip?: number }): Promise<string> =>
    ipcRenderer.invoke('git:history', request),
  gitInit: (request: { cwd: string }): Promise<void> =>
    ipcRenderer.invoke('git:init', request),
  gitWatch: (request: { cwd: string }): Promise<void> =>
    ipcRenderer.invoke('git:watch', request),
  gitWorktrees: (request: { cwd: string }): Promise<any> =>
    ipcRenderer.invoke('git:worktrees', request),
  gitUndoLastCommit: (request: { cwd: string }): Promise<string> =>
    ipcRenderer.invoke('git:undo-last-commit', request),
  gitDiscardAll: (request: { cwd: string }): Promise<void> =>
    ipcRenderer.invoke('git:discard-all', request),
  gitCommitFiles: (request: { cwd: string; hash: string }): Promise<{ files: { additions: number; deletions: number; path: string }[]; hasMore: boolean }> =>
    ipcRenderer.invoke('git:commit-files', request),
  gitCommitFileDiff: (request: { cwd: string; hash: string; filePath: string }): Promise<any> =>
    ipcRenderer.invoke('git:commit-file-diff', request),
  onGitChange: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on('git:change', listener);
    return () => {
      ipcRenderer.removeListener('git:change', listener);
    };
  }
};

contextBridge.exposeInMainWorld('terminalApi', terminal);
