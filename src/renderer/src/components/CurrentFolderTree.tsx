import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  DragEvent as ReactDragEvent,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent
} from 'react';
import type { DirectoryEntry, DirectoryListResult, FindFilesResultEntry } from '../../../shared/ipcTypes';
import { ChevronDownIcon, CloseIcon, CollapseAllIcon, FileTreeIcon, NewFileIcon, NewFolderIcon, RefreshIcon } from './AppIcons';
import { FileIcon } from '../FileIcon';

type TreeNodeState = {
  directory?: DirectoryListResult;
  expanded: boolean;
  loading: boolean;
  error?: string;
};

type CurrentFolderTreeProps = {
  rootPath: string;
  onClose: () => void;
  onOpenFile: (path: string, lineNumber?: number) => void;
  activeFilePath?: string;
};

type CreateDraft = {
  parentPath: string;
  type: DirectoryEntry['type'];
  name: string;
};

type RenameDraft = {
  path: string;
  parentPath: string;
  type: DirectoryEntry['type'];
  name: string;
  originalName: string;
};

type TreeContextMenu = {
  entry: DirectoryEntry;
  x: number;
  y: number;
};

const DIRECTORY_LOAD_TIMEOUT_MS = 10000;
const TREE_BASE_INDENT_PX = 4;
const TREE_DEPTH_INDENT_PX = 12;
const TREE_STATUS_INDENT_PX = 24;

function getPathKey(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  return /^[A-Za-z]:[\\/]/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function getFolderName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized || 'Current folder';
}

function getParentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const sepIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));

  if (sepIndex === -1) {
    return '';
  }

  if (sepIndex === 0) {
    return normalized.slice(0, 1);
  }

  if (/^[A-Za-z]:[\\/][^\\/]+$/.test(normalized)) {
    return normalized.slice(0, 3);
  }

  return normalized.slice(0, sepIndex);
}

function getPathAncestors(root: string, target: string): string[] {
  const normalizedRoot = root.trim().replace(/[\\/]+$/, '');
  const normalizedTarget = target.trim().replace(/[\\/]+$/, '');

  const stdRoot = normalizedRoot.replace(/\\/g, '/');
  const stdTarget = normalizedTarget.replace(/\\/g, '/');

  if (!stdTarget.toLowerCase().startsWith(stdRoot.toLowerCase() + '/')) {
    return [];
  }

  const isWin = target.includes('\\') || root.includes('\\');
  const sep = isWin ? '\\' : '/';
  const rootWithCorrectSep = normalizedRoot.replace(/[\\/]/g, sep);

  const remaining = stdTarget.slice(stdRoot.length); // e.g. "/src/renderer/src/App.tsx"
  const parts = remaining.split('/');

  const ancestors: string[] = [];
  let currentPath = rootWithCorrectSep;
  for (let i = 1; i < parts.length - 1; i++) {
    currentPath += sep + parts[i];
    ancestors.push(currentPath);
  }

  return ancestors;
}

function getFileExtensionIcon(name: string, type: 'file' | 'directory', isOpen?: boolean): JSX.Element {
  return <FileIcon filename={name} isDirectory={type === 'directory'} isOpen={isOpen} />;
}

export function CurrentFolderTree({
  rootPath,
  onClose,
  onOpenFile,
  activeFilePath
}: CurrentFolderTreeProps): JSX.Element {
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});
  const lastScrolledPathRef = useRef<string | null>(null);
  const directoryRequestIdsRef = useRef<Record<string, number>>({});

  const [filterQuery, setFilterQuery] = useState('');
  const [filterResults, setFilterResults] = useState<FindFilesResultEntry[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | undefined>(undefined);
  const [activeDirectoryPath, setActiveDirectoryPath] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [contextMenu, setContextMenu] = useState<TreeContextMenu | null>(null);
  const createDraftInputRef = useRef<HTMLInputElement | null>(null);
  const renameDraftInputRef = useRef<HTMLInputElement | null>(null);
  const creatingEntryRef = useRef(false);
  const skipCreateDraftBlurRef = useRef(false);
  const renamingEntryRef = useRef(false);
  const skipRenameDraftBlurRef = useRef(false);

  const [isRootPaneExpanded, setIsRootPaneExpanded] = useState(true);
  const [isOutlinePaneExpanded, setIsOutlinePaneExpanded] = useState(false);

  useEffect(() => {
    let query = filterQuery.trim();
    let targetLineNumber: number | undefined = undefined;

    const match = query.match(/^(.*?):(\d+)$/);
    if (match) {
      query = match[1].trim();
      targetLineNumber = parseInt(match[2], 10);
    }

    if (!query || !rootPath.trim()) {
      setFilterResults([]);
      setFilterError(undefined);
      setFilterLoading(false);
      return;
    }

    setFilterLoading(true);
    setFilterError(undefined);

    const timer = window.setTimeout(() => {
      window.terminalApi
        .findFiles({ rootPath, query })
        .then((res) => {
          if (res.error) {
            setFilterError(res.error);
            setFilterResults([]);
          } else {
            setFilterResults(res.results);
          }
        })
        .catch((err) => {
          setFilterError(err instanceof Error ? err.message : String(err));
          setFilterResults([]);
        })
        .finally(() => {
          setFilterLoading(false);
        });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [filterQuery, rootPath]);

  useEffect(() => {
    lastScrolledPathRef.current = null;
  }, [activeFilePath]);

  useEffect(() => {
    if (createDraft) {
      window.requestAnimationFrame(() => {
        createDraftInputRef.current?.focus();
        createDraftInputRef.current?.select();
      });
    }
  }, [createDraft?.parentPath, createDraft?.type]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const closeContextMenu = (): void => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (renameDraft) {
      window.requestAnimationFrame(() => {
        renameDraftInputRef.current?.focus();
        renameDraftInputRef.current?.select();
      });
    }
  }, [renameDraft?.path]);

  const activeRefCallback = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node && activeFilePath && lastScrolledPathRef.current !== activeFilePath) {
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        lastScrolledPathRef.current = activeFilePath;
      }
    },
    [activeFilePath]
  );

  const loadDirectory = useCallback((path: string, expanded = true, revealDuringLoad = true): Promise<void> => {
    const nextPath = path.trim();
    const nodeKey = getPathKey(nextPath);

    if (!nextPath) {
      return Promise.resolve();
    }

    const requestId = (directoryRequestIdsRef.current[nodeKey] || 0) + 1;
    directoryRequestIdsRef.current[nodeKey] = requestId;

    setNodes((current) => ({
      ...current,
      [nodeKey]: {
        ...current[nodeKey],
        expanded: revealDuringLoad ? expanded : Boolean(current[nodeKey]?.expanded && current[nodeKey]?.directory),
        loading: true,
        error: undefined
      }
    }));

    const timeoutPromise = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('Folder load timed out.')), DIRECTORY_LOAD_TIMEOUT_MS)
    );

    return Promise.race([window.terminalApi.listDirectory({ path: nextPath }), timeoutPromise])
      .then((directory) => {
        if (directoryRequestIdsRef.current[nodeKey] !== requestId) {
          return;
        }

        setNodes((current) => ({
          ...current,
          [nodeKey]: {
            directory,
            expanded,
            loading: false
          }
        }));
      })
      .catch((error: unknown) => {
        if (directoryRequestIdsRef.current[nodeKey] !== requestId) {
          return;
        }

        setNodes((current) => ({
          ...current,
          [nodeKey]: {
            ...current[nodeKey],
            expanded,
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }));
      });
  }, []);

  useEffect(() => {
    setNodes({});
    setActiveDirectoryPath(null);
    setRenameDraft(null);

    if (rootPath.trim()) {
      loadDirectory(rootPath, true);
    }
  }, [loadDirectory, rootPath]);

  useEffect(() => {
    if (!activeFilePath || !rootPath.trim()) {
      return;
    }

    const ancestors = getPathAncestors(rootPath, activeFilePath);
    if (ancestors.length === 0) {
      return;
    }

    let cancelled = false;

    const revealActiveFile = async (): Promise<void> => {
      for (const ancestor of ancestors) {
        if (cancelled) {
          return;
        }

        await loadDirectory(ancestor, true, false);
      }
    };

    revealActiveFile().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeFilePath, loadDirectory, rootPath]);

  const toggleDirectory = (path: string): void => {
    const nodeKey = getPathKey(path);
    const node = nodes[nodeKey];

    if (node?.expanded) {
      setNodes((current) => ({
        ...current,
        [nodeKey]: {
          ...current[nodeKey],
          expanded: false
        }
      }));
      return;
    }

    if (node?.directory) {
      setNodes((current) => ({
        ...current,
        [nodeKey]: {
          ...current[nodeKey],
          expanded: true
        }
      }));
      return;
    }

    loadDirectory(path, true);
  };

  const openDirectoryRow = (path: string): void => {
    setActiveDirectoryPath(path);
    toggleDirectory(path);
  };

  const openFileRow = (path: string): void => {
    setActiveDirectoryPath(null);
    onOpenFile(path);
  };

  const collapseAll = (): void => {
    setNodes((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, node]) => [
          key,
          {
            ...node,
            expanded: false
          }
        ])
      )
    );
  };

  const beginCreateEntry = (parentPath: string, type: DirectoryEntry['type']): void => {
    const nextParentPath = parentPath.trim();
    if (!nextParentPath) {
      return;
    }

    setFilterQuery('');
    setCreateError(undefined);
    setRenameDraft(null);
    setCreateDraft({ parentPath: nextParentPath, type, name: '' });
    creatingEntryRef.current = false;
    skipCreateDraftBlurRef.current = false;

    const parentKey = getPathKey(nextParentPath);
    if (nodes[parentKey]?.directory) {
      setNodes((current) => ({
        ...current,
        [parentKey]: {
          ...current[parentKey],
          expanded: true
        }
      }));
    } else {
      loadDirectory(nextParentPath, true);
    }
  };

  const beginCreateEntryInRoot = (type: DirectoryEntry['type'], event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    beginCreateEntry(rootPath, type);
  };

  const submitCreateDraft = (): void => {
    const draft = createDraft;
    if (!draft || creatingEntryRef.current) {
      return;
    }

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setCreateDraft(null);
      setCreateError(undefined);
      return;
    }

    setCreateError(undefined);
    creatingEntryRef.current = true;

    window.terminalApi
      .createFileSystemEntry({ parentPath: draft.parentPath, name: trimmedName, type: draft.type })
      .then((entry) => {
        creatingEntryRef.current = false;
        setCreateDraft(null);
        setFilterQuery('');
        return loadDirectory(draft.parentPath, true).then(() => {
          if (entry.type === 'file') {
            onOpenFile(entry.path);
          }
        });
      })
      .catch((error: unknown) => {
        creatingEntryRef.current = false;
        setCreateError(error instanceof Error ? error.message : String(error));
        window.requestAnimationFrame(() => {
          createDraftInputRef.current?.focus();
          createDraftInputRef.current?.select();
        });
      });
  };

  const handleCreateDraftKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitCreateDraft();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      skipCreateDraftBlurRef.current = true;
      setCreateDraft(null);
      setCreateError(undefined);
      creatingEntryRef.current = false;
    }
  };

  const handleCreateDraftBlur = (): void => {
    if (skipCreateDraftBlurRef.current) {
      skipCreateDraftBlurRef.current = false;
      return;
    }

    submitCreateDraft();
  };

  const beginRenameEntry = (entry: DirectoryEntry, depth: number): void => {
    const parentPath = getParentPath(entry.path);

    if (!parentPath || getPathKey(entry.path) === getPathKey(rootPath)) {
      return;
    }

    setFilterQuery('');
    setCreateError(undefined);
    setCreateDraft(null);
    setRenameDraft({
      path: entry.path,
      parentPath,
      type: entry.type,
      name: entry.name,
      originalName: entry.name
    });
    renamingEntryRef.current = false;
    skipRenameDraftBlurRef.current = false;
  };

  const submitRenameDraft = (nextName?: string): void => {
    const draft = renameDraft;
    if (!draft || renamingEntryRef.current) {
      return;
    }

    const trimmedName = (nextName ?? draft.name).trim();
    if (!trimmedName || trimmedName === draft.originalName) {
      setRenameDraft(null);
      setCreateError(undefined);
      return;
    }

    setCreateError(undefined);
    renamingEntryRef.current = true;

    window.terminalApi
      .renameFileSystemEntry({ path: draft.path, name: trimmedName })
      .then((entry) => {
        renamingEntryRef.current = false;
        setRenameDraft(null);
        setNodes((current) => {
          const next = { ...current };
          delete next[getPathKey(draft.path)];
          return next;
        });

        if (entry.type === 'directory') {
          setActiveDirectoryPath(entry.path);
        } else {
          setActiveDirectoryPath(null);
          onOpenFile(entry.path);
        }

        return loadDirectory(draft.parentPath, true);
      })
      .catch((error: unknown) => {
        renamingEntryRef.current = false;
        setCreateError(error instanceof Error ? error.message : String(error));
        window.requestAnimationFrame(() => {
          renameDraftInputRef.current?.focus();
          renameDraftInputRef.current?.select();
        });
      });
  };

  const handleRenameDraftKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      submitRenameDraft(event.currentTarget.value);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.currentTarget.setSelectionRange(0, 0);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const end = event.currentTarget.value.length;
      event.currentTarget.setSelectionRange(end, end);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      skipRenameDraftBlurRef.current = true;
      setRenameDraft(null);
      setCreateError(undefined);
      renamingEntryRef.current = false;
    }
  };

  const handleRenameDraftBlur = (event: ReactFocusEvent<HTMLInputElement>): void => {
    if (skipRenameDraftBlurRef.current) {
      skipRenameDraftBlurRef.current = false;
      return;
    }

    submitRenameDraft(event.currentTarget.value);
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, path: string): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-carogent-path', path);
    event.dataTransfer.setData('text/plain', path);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>, entry: DirectoryEntry): void => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ entry, x: event.clientX, y: event.clientY });

    if (entry.type === 'directory') {
      setActiveDirectoryPath(entry.path);
    } else {
      setActiveDirectoryPath(null);
    }
  };

  const renderIndentGuides = (depth: number) => {
    const guides: JSX.Element[] = [];
    for (let i = 0; i < depth; i++) {
      guides.push(
        <span
          key={i}
          className="folder-tree-indent-guide"
          style={{
            left: `${TREE_BASE_INDENT_PX + i * TREE_DEPTH_INDENT_PX + 7}px`
          }}
        />
      );
    }
    return guides;
  };

  const renderCreateDraft = (parentPath: string, depth: number): JSX.Element | null => {
    if (!createDraft || getPathKey(createDraft.parentPath) !== getPathKey(parentPath)) {
      return null;
    }

    return (
      <div
        className={`folder-tree-create-row is-${createDraft.type}`}
        style={{ paddingLeft: TREE_BASE_INDENT_PX + depth * TREE_DEPTH_INDENT_PX }}
      >
        {renderIndentGuides(depth)}
        <span className="folder-tree-disclosure" />
        <span className="folder-tree-icon">
          {getFileExtensionIcon(createDraft.name, createDraft.type)}
        </span>
        <input
          ref={createDraftInputRef}
          className="folder-tree-create-input"
          value={createDraft.name}
          placeholder={createDraft.type === 'directory' ? 'New folder name' : 'New file name'}
          onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })}
          onKeyDown={handleCreateDraftKeyDown}
          onBlur={handleCreateDraftBlur}
          onMouseDown={(event) => event.stopPropagation()}
          spellCheck={false}
        />
      </div>
    );
  };

  const getContextMenuCreateParent = (entry: DirectoryEntry): string => (
    entry.type === 'directory' ? entry.path : getParentPath(entry.path)
  );

  const deleteEntry = (entry: DirectoryEntry): void => {
    if (getPathKey(entry.path) === getPathKey(rootPath)) {
      return;
    }

    const confirmed = window.confirm(`Delete ${entry.name}?`);
    if (!confirmed) {
      return;
    }

    const parentPath = getParentPath(entry.path);
    setContextMenu(null);
    setCreateError(undefined);

    window.terminalApi
      .deleteFileSystemEntry({ path: entry.path })
      .then(() => {
        setNodes((current) => {
          const next = { ...current };
          delete next[getPathKey(entry.path)];
          return next;
        });

        if (getPathKey(activeDirectoryPath || '') === getPathKey(entry.path)) {
          setActiveDirectoryPath(null);
        }

        if (parentPath) {
          return loadDirectory(parentPath, true);
        }

        return undefined;
      })
      .catch((error: unknown) => {
        setCreateError(error instanceof Error ? error.message : String(error));
      });
  };

  const renderEntry = (entry: DirectoryEntry, depth: number): JSX.Element => {
    const isDirectory = entry.type === 'directory';
    const node = nodes[getPathKey(entry.path)];
    const expanded = Boolean(node?.expanded);
    const isActive = isDirectory ? entry.path === activeDirectoryPath : entry.path === activeFilePath;

    if (renameDraft?.path === entry.path) {
      return (
        <div className="folder-tree-node" key={entry.path}>
          <div
            className={`folder-tree-create-row folder-tree-rename-row is-${entry.type}`}
            style={{ paddingLeft: TREE_BASE_INDENT_PX + depth * TREE_DEPTH_INDENT_PX }}
          >
            {renderIndentGuides(depth)}
            <span className={`folder-tree-disclosure${expanded ? ' is-expanded' : ''}`}>
              {isDirectory ? <ChevronDownIcon /> : null}
            </span>
            <span className="folder-tree-icon">
              {getFileExtensionIcon(renameDraft.name, entry.type, expanded)}
            </span>
            <input
              ref={renameDraftInputRef}
              className="folder-tree-create-input"
              value={renameDraft.name}
              onChange={(event) => setRenameDraft({ ...renameDraft, name: event.target.value })}
              onKeyDown={handleRenameDraftKeyDown}
              onBlur={handleRenameDraftBlur}
              onMouseDown={(event) => event.stopPropagation()}
              spellCheck={false}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="folder-tree-node" key={entry.path}>
        <button
          ref={isActive ? activeRefCallback : undefined}
          className={`folder-tree-row${isDirectory ? ' is-directory' : ''}${entry.ignored ? ' is-ignored' : ''}${isActive ? ' is-active' : ''}`}
          type="button"
          draggable
          title={entry.path}
          style={{ paddingLeft: TREE_BASE_INDENT_PX + depth * TREE_DEPTH_INDENT_PX }}
          onClick={() => (isDirectory ? openDirectoryRow(entry.path) : openFileRow(entry.path))}
          onKeyDown={(event) => {
            if (isActive && event.key === 'Enter') {
              event.preventDefault();
              beginRenameEntry(entry, depth);
            }
          }}
          onContextMenu={(event) => handleContextMenu(event, entry)}
          onDragStart={(event) => handleDragStart(event, entry.path)}
        >
          {renderIndentGuides(depth)}
          <span className={`folder-tree-disclosure${expanded ? ' is-expanded' : ''}`}>
            {isDirectory ? <ChevronDownIcon /> : null}
          </span>
          <span className="folder-tree-icon">
            {getFileExtensionIcon(entry.name, entry.type, expanded)}
          </span>
          <span className="folder-tree-name">{entry.name}</span>
        </button>
        {isDirectory && expanded && (
          <div className="folder-tree-children">
            {node?.loading && !node.directory && (
              <div
                className="folder-tree-skeleton-row"
                style={{ paddingLeft: TREE_BASE_INDENT_PX + (depth + 1) * TREE_DEPTH_INDENT_PX }}
              >
                {renderIndentGuides(depth + 1)}
                <span className="folder-tree-skeleton-icon" />
                <span className="folder-tree-skeleton-label" style={{ width: '70%' }} />
              </div>
            )}
            {node?.error && <div className="folder-tree-status is-error" style={{ paddingLeft: TREE_STATUS_INDENT_PX + depth * TREE_DEPTH_INDENT_PX }}>{node.error}</div>}
            {renderCreateDraft(entry.path, depth + 1)}
            {node?.directory?.entries.map((child) => renderEntry(child, depth + 1))}
            {node?.directory && node.directory.entries.length === 0 && (
              <div className="folder-tree-status" style={{ paddingLeft: TREE_STATUS_INDENT_PX + depth * TREE_DEPTH_INDENT_PX }}>Empty</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const rootNode = rootPath.trim() ? nodes[getPathKey(rootPath)] : undefined;
  const rootEntry: DirectoryEntry | undefined = rootNode?.directory
    ? {
        name: getFolderName(rootNode.directory.path),
        path: rootNode.directory.path,
        type: 'directory'
      }
    : undefined;
  const hasExpandedNode = Object.values(nodes).some((node) => node.expanded);

  return (
    <section className="folder-tree-panel">
      <div className="explorer-viewlet-header">
        <span className="explorer-viewlet-title">Explorer</span>
      </div>

      <div className="folder-tree-search-bar">
        <input
          type="text"
          className="folder-tree-search-input"
          placeholder="Filter files by name..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          spellCheck={false}
        />
        {filterQuery && (
          <button
            type="button"
            className="folder-tree-search-clear"
            onClick={() => setFilterQuery('')}
            title="Clear filter"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="explorer-panes-container">
        {filterQuery.trim() ? (
          <div className="folder-tree-list search-results-active">
            {createError && <div className="folder-tree-status is-error">{createError}</div>}
            {filterLoading && <div className="folder-tree-status">Filtering...</div>}
            {filterError && <div className="folder-tree-status is-error">{filterError}</div>}
            {!filterLoading && !filterError && filterResults.length === 0 && (
              <div className="folder-tree-status">No matching files found.</div>
            )}
            {!filterLoading && !filterError && filterResults.map((entry) => {
              const isDir = entry.type === 'directory';
              return (
                <button
                  key={entry.path}
                  className={`folder-tree-row is-search-result${activeFilePath === entry.path ? ' is-active' : ''}`}
                  type="button"
                  title={entry.path}
                  style={{ paddingLeft: 8 }}
                  onClick={() => {
                    if (isDir) {
                      setFilterQuery('');
                      setActiveDirectoryPath(entry.path);
                      loadDirectory(entry.path, true);
                    } else {
                      setActiveDirectoryPath(null);
                      let line: number | undefined = undefined;
                      const match = filterQuery.trim().match(/^(.*?):(\d+)$/);
                      if (match) {
                        line = parseInt(match[2], 10);
                      }
                      onOpenFile(entry.path, line);
                    }
                  }}
                >
                  <span className="folder-tree-disclosure" />
                  <span className="folder-tree-icon">
                    {getFileExtensionIcon(entry.name, entry.type)}
                  </span>
                  <span className="folder-tree-name">{entry.name}</span>
                  <span className="folder-tree-search-path" title={entry.relativeFilePath}>
                    {entry.relativeFilePath.split(/[\\/]/).slice(0, -1).join('/') || '.'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {/* PANE 1: Folder Tree Pane */}
            <div className={`monaco-pane ${isRootPaneExpanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div
                className="monaco-pane-header"
                role="button"
                tabIndex={0}
                onClick={() => setIsRootPaneExpanded(!isRootPaneExpanded)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setIsRootPaneExpanded(!isRootPaneExpanded);
                  }
                }}
              >
                <span className={`monaco-pane-header-arrow ${isRootPaneExpanded ? 'is-expanded' : ''}`}>
                  <ChevronDownIcon />
                </span>
                <span className="monaco-pane-header-title">
                  {rootPath ? getFolderName(rootPath).toUpperCase() : 'NO ACTIVE FOLDER'}
                </span>
                {rootPath.trim() && (
                  <div className="monaco-pane-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      title="New File..."
                      onClick={(e) => {
                        e.stopPropagation();
                        beginCreateEntry(rootPath, 'file');
                      }}
                    >
                      <NewFileIcon />
                    </button>
                    <button
                      type="button"
                      title="New Folder..."
                      onClick={(e) => {
                        e.stopPropagation();
                        beginCreateEntry(rootPath, 'directory');
                      }}
                    >
                      <NewFolderIcon />
                    </button>
                    <button
                      type="button"
                      title="Refresh Explorer"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadDirectory(rootPath, true);
                      }}
                      disabled={rootNode?.loading}
                    >
                      <RefreshIcon className={rootNode?.loading ? 'spin' : ''} />
                    </button>
                    <button
                      type="button"
                      title="Collapse Folders"
                      onClick={(e) => {
                        e.stopPropagation();
                        collapseAll();
                      }}
                      disabled={!hasExpandedNode}
                    >
                      <CollapseAllIcon />
                    </button>
                  </div>
                )}
              </div>

              {isRootPaneExpanded && (
                <div className="monaco-pane-body folder-tree-list">
                  {createError && <div className="folder-tree-status is-error">{createError}</div>}
                  {!rootPath.trim() && <div className="folder-tree-status">Starting shell...</div>}
                  {rootNode?.loading && !rootNode.directory && <div className="folder-tree-status">Loading...</div>}
                  {rootNode?.error && <div className="folder-tree-status is-error">{rootNode.error}</div>}

                  {rootNode?.directory && (
                    <div className="folder-tree-children root-children">
                      {renderCreateDraft(rootPath, 1)}
                      {rootNode.directory.entries.map((child) => renderEntry(child, 1))}
                      {rootNode.directory.entries.length === 0 && (
                        <div className="folder-tree-status" style={{ paddingLeft: 12 }}>Empty</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PANE 2: Outline Pane */}
            <div className={`monaco-pane outline-pane ${isOutlinePaneExpanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div
                className="monaco-pane-header"
                role="button"
                tabIndex={0}
                onClick={() => setIsOutlinePaneExpanded(!isOutlinePaneExpanded)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setIsOutlinePaneExpanded(!isOutlinePaneExpanded);
                  }
                }}
              >
                <span className={`monaco-pane-header-arrow ${isOutlinePaneExpanded ? 'is-expanded' : ''}`}>
                  <ChevronDownIcon />
                </span>
                <span className="monaco-pane-header-title">OUTLINE</span>
              </div>
              {isOutlinePaneExpanded && (
                <div className="monaco-pane-body outline-body">
                  <div className="folder-tree-status">No outline information available</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {contextMenu && createPortal(
        <div
          className="folder-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              const parentPath = getContextMenuCreateParent(contextMenu.entry);
              setContextMenu(null);
              beginCreateEntry(parentPath, 'file');
            }}
          >
            New File
          </button>
          <button
            type="button"
            onClick={() => {
              const parentPath = getContextMenuCreateParent(contextMenu.entry);
              setContextMenu(null);
              beginCreateEntry(parentPath, 'directory');
            }}
          >
            New Folder
          </button>
          <div className="folder-tree-context-separator" />
          <button
            type="button"
            onClick={() => {
              window.terminalApi.revealInFinder({ path: contextMenu.entry.path }).catch((error: unknown) => {
                setCreateError(error instanceof Error ? error.message : String(error));
              });
              setContextMenu(null);
            }}
          >
            Reveal in Finder
          </button>
          <button
            type="button"
            onClick={() => {
              window.terminalApi.writeClipboardText(contextMenu.entry.path);
              setContextMenu(null);
            }}
          >
            Copy Path
          </button>
          {getPathKey(contextMenu.entry.path) !== getPathKey(rootPath) && (
            <>
              <div className="folder-tree-context-separator" />
              <button
                type="button"
                className="is-danger"
                onClick={() => deleteEntry(contextMenu.entry)}
              >
                Delete
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </section>
  );
}
