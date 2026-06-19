import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { DirectoryEntry, DirectoryListResult, FindFilesResultEntry } from '../../../shared/ipcTypes';
import { ChevronDownIcon, CloseIcon, FileTreeIcon, RefreshIcon } from './AppIcons';

type TreeNodeState = {
  directory?: DirectoryListResult;
  expanded: boolean;
  loading: boolean;
  error?: string;
};

type CurrentFolderTreeProps = {
  rootPath: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  activeFilePath?: string;
};

function getFolderName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized || 'Current folder';
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

export function CurrentFolderTree({
  rootPath,
  onClose,
  onOpenFile,
  activeFilePath
}: CurrentFolderTreeProps): JSX.Element {
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});
  const lastScrolledPathRef = useRef<string | null>(null);

  const [filterQuery, setFilterQuery] = useState('');
  const [filterResults, setFilterResults] = useState<FindFilesResultEntry[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const query = filterQuery.trim();
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

  const activeRefCallback = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node && activeFilePath && lastScrolledPathRef.current !== activeFilePath) {
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        lastScrolledPathRef.current = activeFilePath;
      }
    },
    [activeFilePath]
  );

  const loadDirectory = useCallback((path: string, expanded = true): void => {
    const nextPath = path.trim();

    if (!nextPath) {
      return;
    }

    setNodes((current) => ({
      ...current,
      [nextPath]: {
        ...current[nextPath],
        expanded,
        loading: true,
        error: undefined
      }
    }));

    window.terminalApi
      .listDirectory({ path: nextPath })
      .then((directory) => {
        setNodes((current) => ({
          ...current,
          [nextPath]: {
            directory,
            expanded,
            loading: false
          }
        }));
      })
      .catch((error: unknown) => {
        setNodes((current) => ({
          ...current,
          [nextPath]: {
            ...current[nextPath],
            expanded,
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }));
      });
  }, []);

  useEffect(() => {
    setNodes({});

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

    const pathsToLoad: string[] = [];

    setNodes((current) => {
      let changed = false;
      const nextNodes = { ...current };

      for (const ancestor of ancestors) {
        const node = nextNodes[ancestor];
        if (!node || !node.directory || !node.expanded) {
          if (!node || (!node.directory && !node.loading)) {
            pathsToLoad.push(ancestor);
            nextNodes[ancestor] = {
              ...node,
              expanded: true,
              loading: true,
              error: undefined
            };
            changed = true;
          } else if (!node.expanded) {
            nextNodes[ancestor] = {
              ...node,
              expanded: true
            };
            changed = true;
          }
        }
      }

      return changed ? nextNodes : current;
    });

    for (const path of pathsToLoad) {
      window.terminalApi
        .listDirectory({ path })
        .then((directory) => {
          setNodes((current) => ({
            ...current,
            [path]: {
              directory,
              expanded: true,
              loading: false
            }
          }));
        })
        .catch((error: unknown) => {
          setNodes((current) => ({
            ...current,
            [path]: {
              ...current[path],
              expanded: true,
              loading: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }));
        });
    }
  }, [activeFilePath, rootPath]);

  const toggleDirectory = (path: string): void => {
    const node = nodes[path];

    if (node?.expanded) {
      setNodes((current) => ({
        ...current,
        [path]: {
          ...current[path],
          expanded: false
        }
      }));
      return;
    }

    if (node?.directory) {
      setNodes((current) => ({
        ...current,
        [path]: {
          ...current[path],
          expanded: true
        }
      }));
      return;
    }

    loadDirectory(path, true);
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, path: string): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-carogent-path', path);
    event.dataTransfer.setData('text/plain', path);
  };

  const renderEntry = (entry: DirectoryEntry, depth: number): JSX.Element => {
    const isDirectory = entry.type === 'directory';
    const node = nodes[entry.path];
    const expanded = Boolean(node?.expanded);
    const isActive = entry.path === activeFilePath;

    return (
      <div className="folder-tree-node" key={entry.path}>
        <button
          ref={isActive ? activeRefCallback : undefined}
          className={`folder-tree-row${isDirectory ? ' is-directory' : ''}${isActive ? ' is-active' : ''}`}
          type="button"
          draggable
          title={entry.path}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (isDirectory ? toggleDirectory(entry.path) : onOpenFile(entry.path))}
          onDragStart={(event) => handleDragStart(event, entry.path)}
        >
          <span className={`folder-tree-disclosure${expanded ? ' is-expanded' : ''}`}>
            {isDirectory ? <ChevronDownIcon /> : null}
          </span>
          <span className="folder-tree-icon">
            <FileTreeIcon type={entry.type} />
          </span>
          <span className="folder-tree-name">{entry.name}</span>
        </button>
        {isDirectory && expanded && (
          <div className="folder-tree-children">
            {node?.loading && <div className="folder-tree-status" style={{ paddingLeft: 30 + depth * 14 }}>Loading...</div>}
            {node?.error && <div className="folder-tree-status is-error" style={{ paddingLeft: 30 + depth * 14 }}>{node.error}</div>}
            {node?.directory?.entries.map((child) => renderEntry(child, depth + 1))}
            {node?.directory && node.directory.entries.length === 0 && (
              <div className="folder-tree-status" style={{ paddingLeft: 30 + depth * 14 }}>Empty</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const rootNode = rootPath.trim() ? nodes[rootPath.trim()] : undefined;

  return (
    <section className="folder-tree-panel">
      <div className="folder-tree-header">
        <div className="folder-tree-heading">
          <span className="folder-tree-title">Explorer</span>
          <span className="folder-tree-root" title={rootPath}>{rootPath ? getFolderName(rootPath) : 'No active folder'}</span>
        </div>
        <div className="folder-tree-actions">
          <button
            type="button"
            title="Refresh explorer"
            aria-label="Refresh explorer"
            onClick={() => loadDirectory(rootPath, true)}
            disabled={!rootPath.trim() || rootNode?.loading}
          >
            <RefreshIcon className={rootNode?.loading ? 'spin' : ''} />
          </button>
        </div>
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

      {filterQuery.trim() ? (
        <div className="folder-tree-list">
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
                    loadDirectory(entry.path, true);
                  } else {
                    onOpenFile(entry.path);
                  }
                }}
              >
                <span className="folder-tree-disclosure" />
                <span className="folder-tree-icon">
                  <FileTreeIcon type={entry.type} />
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
        <div className="folder-tree-list">
          {!rootPath.trim() && <div className="folder-tree-status">Starting shell...</div>}
          {rootNode?.loading && !rootNode.directory && <div className="folder-tree-status">Loading...</div>}
          {rootNode?.error && <div className="folder-tree-status is-error">{rootNode.error}</div>}
          {rootNode?.directory?.entries.map((entry) => renderEntry(entry, 0))}
          {rootNode?.directory && rootNode.directory.entries.length === 0 && <div className="folder-tree-status">Empty folder</div>}
        </div>
      )}
    </section>
  );
}
