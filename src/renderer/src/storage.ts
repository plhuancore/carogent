import { createInitialLayout, getFirstPaneId, isLayoutNode, LayoutNode } from './layout';

const WORKSPACES_STORAGE_KEY = 'carogent-terminal-workspaces';
const LEGACY_LAYOUT_STORAGE_KEY = 'carogent-terminal-layout';

export type WorkspaceState = {
  id: string;
  name: string;
  layout: LayoutNode;
  activePaneId: string;
  color?: string;
};

export type WorkspaceStore = {
  activeWorkspaceId: string;
  workspaces: WorkspaceState[];
};

function createWorkspace(name = 'Workspace'): WorkspaceState {
  const layout = createInitialLayout();

  return {
    id: crypto.randomUUID(),
    name,
    layout,
    activePaneId: getFirstPaneId(layout)
  };
}

function createInitialStore(): WorkspaceStore {
  const workspace = createWorkspace();

  return {
    activeWorkspaceId: workspace.id,
    workspaces: [workspace]
  };
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const workspace = value as WorkspaceState;

  return (
    typeof workspace.id === 'string' &&
    typeof workspace.name === 'string' &&
    typeof workspace.activePaneId === 'string' &&
    (workspace.color === undefined || typeof workspace.color === 'string') &&
    isLayoutNode(workspace.layout)
  );
}

function isWorkspaceStore(value: unknown): value is WorkspaceStore {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const store = value as WorkspaceStore;

  return (
    typeof store.activeWorkspaceId === 'string' &&
    Array.isArray(store.workspaces) &&
    store.workspaces.length > 0 &&
    store.workspaces.every(isWorkspaceState)
  );
}

function loadLegacyStore(): WorkspaceStore | null {
  const raw = localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isLayoutNode(parsed)) {
      return null;
    }

    const workspace: WorkspaceState = {
      id: crypto.randomUUID(),
      name: 'Workspace',
      layout: parsed,
      activePaneId: getFirstPaneId(parsed)
    };

    return {
      activeWorkspaceId: workspace.id,
      workspaces: [workspace]
    };
  } catch {
    return null;
  }
}

export function loadWorkspaceStore(): WorkspaceStore {
  const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;

      if (isWorkspaceStore(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to legacy migration or a clean store.
    }
  }

  return loadLegacyStore() || createInitialStore();
}

export function saveWorkspaceStore(store: WorkspaceStore): void {
  localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(store));
}

export function createEmptyWorkspace(name: string): WorkspaceState {
  return createWorkspace(name);
}
