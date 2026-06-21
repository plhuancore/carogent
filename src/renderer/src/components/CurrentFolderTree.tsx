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
  onOpenFile: (path: string, lineNumber?: number) => void;
  activeFilePath?: string;
};

const DIRECTORY_LOAD_TIMEOUT_MS = 10000;

function getPathKey(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  return /^[A-Za-z]:[\\/]/.test(normalized) ? normalized.toLowerCase() : normalized;
}

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
  const directoryRequestIdsRef = useRef<Record<string, number>>({});

  const [filterQuery, setFilterQuery] = useState('');
  const [filterResults, setFilterResults] = useState<FindFilesResultEntry[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | undefined>(undefined);

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

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, path: string): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-carogent-path', path);
    event.dataTransfer.setData('text/plain', path);
  };

  const renderEntry = (entry: DirectoryEntry, depth: number): JSX.Element => {
    const isDirectory = entry.type === 'directory';
    const node = nodes[getPathKey(entry.path)];
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
            {node?.loading && !node.directory && (
              <>
                {[0.7, 0.5, 0.85].map((w, i) => (
                  <div
                    key={i}
                    className="folder-tree-skeleton-row"
                    style={{ paddingLeft: 8 + (depth + 1) * 14 }}
                  >
                    <span className="folder-tree-skeleton-icon" />
                    <span className="folder-tree-skeleton-label" style={{ width: `${w * 100}%` }} />
                  </div>
                ))}
              </>
            )}
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

  const rootNode = rootPath.trim() ? nodes[getPathKey(rootPath)] : undefined;

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
