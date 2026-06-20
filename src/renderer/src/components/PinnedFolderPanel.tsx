import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  FormEvent as ReactFormEvent,
  MouseEvent as ReactMouseEvent
} from 'react';
import type { DirectoryEntry, DirectoryListResult } from '../../../shared/ipcTypes';
import { ChevronDownIcon, ChevronUpIcon, FileTreeIcon, OpenFileIcon, ParentFolderIcon, RefreshIcon } from './AppIcons';

function isImageFile(entry: DirectoryEntry): boolean {
  return entry.type === 'file' && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(entry.name);
}

type PinnedFolderPanelProps = {
  pinnedDirectory: string;
  collapsed: boolean;
  onPinnedDirectoryChange: (path: string) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onInsertPath: (path: string) => void;
};

export function PinnedFolderPanel({
  pinnedDirectory,
  collapsed,
  onPinnedDirectoryChange,
  onCollapsedChange,
  onInsertPath
}: PinnedFolderPanelProps): JSX.Element {
  const [draftPath, setDraftPath] = useState(pinnedDirectory);
  const [directory, setDirectory] = useState<DirectoryListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    entry: DirectoryEntry;
    x: number;
    y: number;
    status: 'loading' | 'ready' | 'error';
    dataUrl?: string;
  } | null>(null);
  const previewTimer = useRef<number | null>(null);
  const previewRequestId = useRef(0);
  const previewPosition = useRef<{ x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const clearImagePreview = useCallback((): void => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }

    previewRequestId.current += 1;
    previewPosition.current = null;
    setPreview(null);
  }, []);

  const loadDirectory = useCallback((path: string): void => {
    const nextPath = path.trim();

    clearImagePreview();
    setDraftPath(nextPath);

    if (!nextPath) {
      setDirectory(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    window.terminalApi
      .listDirectory({ path: nextPath })
      .then((result) => {
        setDirectory(result);
        setDraftPath(result.path);
        setError(null);
        onPinnedDirectoryChange(result.path);
      })
      .catch((loadError: unknown) => {
        setDirectory(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => setLoading(false));
  }, [clearImagePreview, onPinnedDirectoryChange]);

  useEffect(() => {
    setDraftPath(pinnedDirectory);
    loadDirectory(pinnedDirectory);
  }, [loadDirectory, pinnedDirectory]);

  const handleSubmit = (event: ReactFormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    loadDirectory(draftPath);
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, path: string): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-carogent-path', path);
    event.dataTransfer.setData('text/plain', path);
  };

  const handleToggleCollapsed = (): void => {
    const nextCollapsed = !collapsed;

    if (nextCollapsed) {
      clearImagePreview();
    }

    onCollapsedChange(nextCollapsed);
  };

  const showImagePreviewAt = (entry: DirectoryEntry, x: number, y: number): void => {
    if (!isImageFile(entry)) {
      clearImagePreview();
      return;
    }

    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
    }

    previewPosition.current = { x, y };
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;

    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      const position = previewPosition.current || { x, y };

      setPreview({
        entry,
        x: position.x,
        y: position.y,
        status: 'loading'
      });

      window.terminalApi
        .getImagePreview({ path: entry.path })
        .then(({ dataUrl }) => {
          if (previewRequestId.current !== requestId) {
            return;
          }

          const nextPosition = previewPosition.current || position;
          setPreview({
            entry,
            x: nextPosition.x,
            y: nextPosition.y,
            status: 'ready',
            dataUrl
          });
        })
        .catch(() => {
          if (previewRequestId.current !== requestId) {
            return;
          }

          const nextPosition = previewPosition.current || position;
          setPreview({
            entry,
            x: nextPosition.x,
            y: nextPosition.y,
            status: 'error'
          });
        });
    }, 500);
  };

  const showImagePreview = (entry: DirectoryEntry, event: ReactMouseEvent<HTMLButtonElement>): void => {
    showImagePreviewAt(entry, event.clientX, event.clientY);
  };

  const moveImagePreview = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    const x = event.clientX;
    const y = event.clientY;
    previewPosition.current = { x, y };

    if (previewRef.current) {
      previewRef.current.style.left = `${x + 14}px`;
      previewRef.current.style.top = `${y + 14}px`;
    }
  };

  useEffect(() => clearImagePreview, [clearImagePreview]);

  return (
    <section className={`pinned-folder ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="pinned-folder-header">
        <div className="pinned-folder-heading">
          <span className="pinned-folder-title">Pinned Folder</span>
        </div>
        <div className="pinned-folder-header-actions">
          {!collapsed && (
            <button
              className="pinned-folder-refresh-button"
              type="button"
              title="Refresh pinned folder"
              aria-label="Refresh pinned folder"
              onClick={() => loadDirectory(draftPath)}
              disabled={!draftPath.trim() || loading}
            >
              <RefreshIcon className={loading ? 'spin' : ''} />
            </button>
          )}
          <button
            className="pinned-folder-toggle-button"
            type="button"
            title={collapsed ? 'Expand pinned folder' : 'Collapse pinned folder'}
            aria-label={collapsed ? 'Expand pinned folder' : 'Collapse pinned folder'}
            aria-expanded={!collapsed}
            onClick={handleToggleCollapsed}
          >
            {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
      <form className="pinned-folder-form" onSubmit={handleSubmit}>
        <input
          value={draftPath}
          placeholder="Folder path"
          aria-label="Pinned folder path"
          onChange={(event) => setDraftPath(event.target.value)}
        />
        <button type="submit" title="Open pinned folder" aria-label="Open pinned folder" disabled={!draftPath.trim() || loading}>
          <OpenFileIcon />
        </button>
      </form>
      {directory && (
        <div className="pinned-folder-current" title={directory.path}>
          {directory.path}
        </div>
      )}
      {error && <div className="pinned-folder-error">{error}</div>}
      <div className="pinned-folder-list">
        {directory?.parentPath && (
          <button
            className="pinned-folder-row"
            type="button"
            onClick={() => loadDirectory(directory.parentPath || '')}
          >
            <span className="pinned-folder-icon">
              <ParentFolderIcon />
            </span>
            <span className="pinned-folder-name">Parent folder</span>
          </button>
        )}
        {directory?.entries.map((entry) => (
          <button
            key={entry.path}
            className={`pinned-folder-row is-${entry.type}`}
            type="button"
            draggable
            onClick={() => {
              if (entry.type === 'directory') {
                loadDirectory(entry.path);
                return;
              }

              onInsertPath(entry.path);
            }}
            onDragStart={(event) => handleDragStart(event, entry.path)}
            onMouseEnter={(event) => showImagePreview(entry, event)}
            onMouseMove={moveImagePreview}
            onMouseLeave={clearImagePreview}
            onFocus={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              showImagePreviewAt(entry, rect.right, rect.top);
            }}
            onBlur={clearImagePreview}
          >
            <span className="pinned-folder-icon">
              <FileTreeIcon type={entry.type} />
            </span>
            <span className="pinned-folder-name">{entry.name}</span>
          </button>
        ))}
        {loading && <div className="pinned-folder-empty">Loading...</div>}
        {!loading && !directory && !error && <div className="pinned-folder-empty">Enter folder path</div>}
        {!loading && directory && directory.entries.length === 0 && (
          <div className="pinned-folder-empty">Empty folder</div>
        )}
      </div>
      {preview && (
        <div
          ref={previewRef}
          className="pinned-image-preview"
          style={{ left: preview.x + 14, top: preview.y + 14 }}
        >
          {preview.status === 'loading' ? (
            <span>Loading preview...</span>
          ) : preview.status === 'error' ? (
            <span>Preview unavailable</span>
          ) : (
            <div
              className="pinned-image-preview-media"
              role="img"
              aria-label={preview.entry.name}
              style={{ backgroundImage: `url("${preview.dataUrl}")` }}
            />
          )}
        </div>
      )}
        </>
      )}
    </section>
  );
}
