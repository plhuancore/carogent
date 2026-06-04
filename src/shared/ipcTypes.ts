export type TerminalCreateRequest = {
  cwd?: string;
  shell?: string;
  paneId?: string;
};

export type TerminalCreated = {
  id: string;
  cwd: string;
  shell: string;
};

export type TerminalShellOption = {
  shell: string;
  label: string;
  title: string;
  icon: string;
  shortcut?: string;
  isDefault?: boolean;
};

export type TerminalResizeRequest = {
  id: string;
  cols: number;
  rows: number;
};

export type TerminalWriteRequest = {
  id: string;
  data: string;
};

export type TerminalDataEvent = {
  id: string;
  data: string;
};

export type TerminalCwdEvent = {
  id: string;
  cwd: string;
};

export type TerminalExitEvent = {
  id: string;
  exitCode: number;
  signal?: number;
};

export type DirectoryListRequest = {
  path: string;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  createdAt?: number;
  modifiedAt?: number;
};

export type DirectoryListResult = {
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
};

export type ImagePreviewRequest = {
  path: string;
};

export type ImagePreviewResult = {
  dataUrl: string;
};

export type OpenVSCodeRequest = {
  path?: string;
};

export type OpenBrowserRequest = {
  url?: string;
};

export type BrowserBridgeStatusEvent = {
  connected: boolean;
  clientCount: number;
  enabled: boolean;
  lastError?: string;
};

export type AgentDoneOverlayItem = {
  paneId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  cwd?: string;
  lines?: string[];
};

export type AgentOpenPaneRequest = {
  paneId: string;
  workspaceId: string;
};

export type AgentBridgePane = {
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

export type AgentBridgeWorkspace = {
  id: string;
  name: string;
  active: boolean;
};

export type AgentBridgeSnapshot = {
  activeWorkspaceId: string;
  activePaneId: string;
  workspaces: AgentBridgeWorkspace[];
  panes: AgentBridgePane[];
};

export type AgentBridgeRequest = {
  action?: string;
  paneId?: string;
  workspaceId?: string;
  text?: string;
  url?: string;
  direction?: 'row' | 'column';
  title?: string;
};

export type AgentBridgeRendererRequest = {
  id: string;
  action: 'notifyDone' | 'focusPane' | 'splitPane';
  paneId: string;
  workspaceId?: string;
  direction?: 'row' | 'column';
  title?: string;
};

export type AgentBridgeRendererResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

export type GitFile = {
  path: string;
  status: string;
  dir: string;
  name: string;
  kind?: 'file' | 'directory';
};

export type GitStatus = {
  isRepo: boolean;
  branch?: string;
  repoName?: string;
  staged?: GitFile[];
  unstaged?: GitFile[];
  error?: string;
};

export type GitWorktree = {
  path: string;
  name: string;
  commit: string;
  branch: string;
  isCurrent: boolean;
};

export type GitDiffResult = {
  diff?: string;
  error?: string;
};

export type TerminalApi = {
  getAgentBridgeSettings: () => Promise<{ enabled: boolean; port: number }>;
  setAgentBridgeSettings: (settings: { enabled: boolean; port: number }) => Promise<{ enabled: boolean; port: number }>;
  getAgentBridgeScriptPath: () => Promise<string>;
  getShellOptions: () => Promise<TerminalShellOption[]>;
  listDirectory: (request: DirectoryListRequest) => Promise<DirectoryListResult>;
  getImagePreview: (request: ImagePreviewRequest) => Promise<ImagePreviewResult>;
  openInVSCode: (request: OpenVSCodeRequest) => Promise<void>;
  openOrFocusBrowser: (request: OpenBrowserRequest) => Promise<void>;
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
  updateAgentBridgeSnapshot: (snapshot: AgentBridgeSnapshot) => Promise<void>;
  completeAgentBridgeRequest: (response: AgentBridgeRendererResponse) => Promise<void>;
  create: (request?: TerminalCreateRequest) => Promise<TerminalCreated>;
  resize: (request: TerminalResizeRequest) => Promise<void>;
  write: (request: TerminalWriteRequest) => Promise<void>;
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
  onAgentBridgeRequest: (callback: (request: AgentBridgeRendererRequest) => void) => () => void;
  onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  gitStatus: (request: { cwd: string }) => Promise<GitStatus>;
  gitDiff: (request: { cwd: string; filePath: string; isStaged: boolean }) => Promise<GitDiffResult>;
  gitStage: (request: { cwd: string; filePath: string }) => Promise<void>;
  gitUnstage: (request: { cwd: string; filePath: string }) => Promise<void>;
  gitStageAll: (request: { cwd: string }) => Promise<void>;
  gitUnstageAll: (request: { cwd: string }) => Promise<void>;
  gitDiscard: (request: { cwd: string; filePath: string; isUntracked: boolean }) => Promise<void>;
  gitCommit: (request: { cwd: string; message: string }) => Promise<void>;
  gitHistory: (request: { cwd: string }) => Promise<string>;
  gitInit: (request: { cwd: string }) => Promise<void>;
  gitWatch: (request: { cwd: string }) => Promise<void>;
  gitWorktrees: (request: { cwd: string }) => Promise<GitWorktree[]>;
  gitUndoLastCommit: (request: { cwd: string }) => Promise<string>;
  gitDiscardAll: (request: { cwd: string }) => Promise<void>;
  gitCommitFiles: (request: { cwd: string; hash: string }) => Promise<{ files: { additions: number; deletions: number; path: string }[]; hasMore: boolean }>;
  gitCommitFileDiff: (request: { cwd: string; hash: string; filePath: string }) => Promise<GitDiffResult>;
  onGitChange: (callback: () => void) => () => void;
};
