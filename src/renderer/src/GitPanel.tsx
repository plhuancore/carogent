import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { GitStatus, GitWorktree, GitImageDiffResult } from '../../shared/ipcTypes';
import 'prism-themes/themes/prism-vsc-dark-plus.css';
import { FileIcon } from './FileIcon';
import { parseDiffLines, type HighlightedDiffLine } from './git/diffParser';
import { computeGraphData, GraphCell, renderRefBadges, getColorForCol } from './git/historyGraph';
import { highlightCodeLine } from './git/syntaxHighlight';
import type { CommitHistoryItem } from './git/types';
import { MaximizeIcon, MinimizeIcon } from './components/AppIcons';

const MAX_RENDERED_DIFF_LINES = 5000;
const MAX_MAXIMIZED_RENDERED_DIFF_LINES = 10000;
const MAX_DISPLAYED_CHANGES = 150;
const HISTORY_PAGE_SIZE = 100;
const MAX_HISTORY_ITEMS = 5000;
const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

type MaximizedDiffRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type HiddenDiffLinesBlock = {
  type: 'hidden-lines';
  key: string;
  count: number;
  oldStartLine: number;
  newStartLine: number;
};

type RenderableDiffLine = HighlightedDiffLine | HiddenDiffLinesBlock;

type HiddenDiffSnippetState = {
  loading?: boolean;
  error?: string;
  lines?: string[];
  fullyExpanded?: boolean;
};

type DiffScrollMarker = {
  key: string;
  type: 'addition' | 'deletion' | 'hunk' | 'hidden';
  targetTop: number;
  topPercent: number;
  heightPercent: number;
};

interface GitPanelProps {
  cwd: string;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  activePaneId?: string;
  terminalId?: string;
  refreshTrigger?: number;
}

function groupFilesByDirectory(files: { additions: number; deletions: number; path: string }[]) {
  const groups: { [dir: string]: { additions: number; deletions: number; path: string; name: string }[] } = {};
  for (const f of files) {
    const lastSlash = f.path.lastIndexOf('/');
    const dir = lastSlash !== -1 ? f.path.substring(0, lastSlash) : '';
    const name = lastSlash !== -1 ? f.path.substring(lastSlash + 1) : f.path;
    if (!groups[dir]) {
      groups[dir] = [];
    }
    groups[dir].push({ ...f, name });
  }
  return groups;
}

const isImageFile = (path: string): boolean => {
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff)$/i.test(path);
};

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return 'unknown size';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface ImageDiffViewerProps {
  diff: GitImageDiffResult;
}

const ImageDiffViewer: React.FC<ImageDiffViewerProps> = React.memo(({ diff }) => {
  const [mode, setMode] = useState<'2-up' | 'swipe' | 'onion'>('2-up');
  const [swipePercent, setSwipePercent] = useState<number>(50);
  const [onionOpacity, setOnionOpacity] = useState<number>(0.5);

  const [oldDims, setOldDims] = useState<{ width: number; height: number } | null>(null);
  const [newDims, setNewDims] = useState<{ width: number; height: number } | null>(null);

  const [oldError, setOldError] = useState<boolean>(false);
  const [newError, setNewError] = useState<boolean>(false);

  const swipeContainerRef = useRef<HTMLDivElement>(null);

  const moveListenerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const upListenerRef = useRef<(() => void) | null>(null);
  const touchMoveListenerRef = useRef<((e: TouchEvent) => void) | null>(null);
  const touchEndListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setOldDims(null);
    setNewDims(null);
    setOldError(false);
    setNewError(false);
  }, [diff]);

  useEffect(() => {
    return () => {
      if (moveListenerRef.current) {
        window.removeEventListener('mousemove', moveListenerRef.current);
      }
      if (upListenerRef.current) {
        window.removeEventListener('mouseup', upListenerRef.current);
      }
      if (touchMoveListenerRef.current) {
        window.removeEventListener('touchmove', touchMoveListenerRef.current);
      }
      if (touchEndListenerRef.current) {
        window.removeEventListener('touchend', touchEndListenerRef.current);
      }
    };
  }, []);

  const handleSwipeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!swipeContainerRef.current) return;
    const rect = swipeContainerRef.current.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const x = moveEvent.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSwipePercent(percentage);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      moveListenerRef.current = null;
      upListenerRef.current = null;
    };

    moveListenerRef.current = handleMouseMove;
    upListenerRef.current = handleMouseUp;

    const initialX = e.clientX - rect.left;
    setSwipePercent(Math.max(0, Math.min(100, (initialX / rect.width) * 100)));

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSwipeTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeContainerRef.current) return;
    const rect = swipeContainerRef.current.getBoundingClientRect();

    const handleTouchMove = (moveEvent: TouchEvent) => {
      const x = moveEvent.touches[0].clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSwipePercent(percentage);
    };

    const handleTouchEnd = () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      touchMoveListenerRef.current = null;
      touchEndListenerRef.current = null;
    };

    touchMoveListenerRef.current = handleTouchMove;
    touchEndListenerRef.current = handleTouchEnd;

    const initialX = e.touches[0].clientX - rect.left;
    setSwipePercent(Math.max(0, Math.min(100, (initialX / rect.width) * 100)));

    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);
  };

  const hasOld = !!diff.oldImage?.dataUrl;
  const hasNew = !!diff.newImage?.dataUrl;

  const oldSizeStr = hasOld ? formatBytes(diff.oldImage?.size) : '';
  const newSizeStr = hasNew ? formatBytes(diff.newImage?.size) : '';

  return (
    <div className="image-diff-viewer">
      <div className="image-diff-toolbar">
        <div className="image-diff-mode-selectors">
          <button
            type="button"
            className={`image-diff-mode-btn ${mode === '2-up' ? 'active' : ''}`}
            onClick={() => setMode('2-up')}
          >
            2-Up (Side-by-Side)
          </button>
          <button
            type="button"
            className={`image-diff-mode-btn ${mode === 'swipe' ? 'active' : ''}`}
            onClick={() => setMode('swipe')}
            disabled={!hasOld || !hasNew || oldError || newError}
          >
            Swipe
          </button>
          <button
            type="button"
            className={`image-diff-mode-btn ${mode === 'onion' ? 'active' : ''}`}
            onClick={() => setMode('onion')}
            disabled={!hasOld || !hasNew || oldError || newError}
          >
            Onion Skin
          </button>
        </div>
        
        {mode === 'onion' && hasOld && hasNew && !oldError && !newError && (
          <div className="image-diff-control-slider">
            <span className="slider-label">Opacity: {Math.round(onionOpacity * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={onionOpacity}
              onChange={(e) => setOnionOpacity(parseFloat(e.target.value))}
            />
          </div>
        )}
      </div>

      <div className="image-diff-display-area">
        {mode === '2-up' && (
          <div className="image-diff-2up">
            <div className="image-diff-pane old-pane">
              <div className="pane-header">
                <span className="pane-title label-deleted">OLD</span>
                <span className="pane-meta">
                  {oldError ? '' : oldSizeStr} {oldDims && !oldError ? `(${oldDims.width}x${oldDims.height})` : ''}
                </span>
              </div>
              <div className="image-canvas-wrapper">
                {oldError ? (
                  <span className="image-error-state">Failed to load image preview</span>
                ) : hasOld ? (
                  <img
                    src={diff.oldImage!.dataUrl}
                    alt="Old version"
                    className="image-diff-img"
                    onError={() => setOldError(true)}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setOldDims({ width: img.naturalWidth, height: img.naturalHeight });
                    }}
                  />
                ) : (
                  <span className="image-empty-state">File Added</span>
                )}
              </div>
            </div>
            
            <div className="image-diff-pane new-pane">
              <div className="pane-header">
                <span className="pane-title label-added">NEW</span>
                <span className="pane-meta">
                  {newError ? '' : newSizeStr} {newDims && !newError ? `(${newDims.width}x${newDims.height})` : ''}
                </span>
              </div>
              <div className="image-canvas-wrapper">
                {newError ? (
                  <span className="image-error-state">Failed to load image preview</span>
                ) : hasNew ? (
                  <img
                    src={diff.newImage!.dataUrl}
                    alt="New version"
                    className="image-diff-img"
                    onError={() => setNewError(true)}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setNewDims({ width: img.naturalWidth, height: img.naturalHeight });
                    }}
                  />
                ) : (
                  <span className="image-empty-state">File Deleted</span>
                )}
              </div>
            </div>
          </div>
        )}

        {mode === 'swipe' && hasOld && hasNew && (
          oldError || newError ? (
            <span className="image-error-state">Failed to load image preview</span>
          ) : (
            <div
              className="image-diff-swipe-container"
              ref={swipeContainerRef}
              onMouseDown={handleSwipeMouseDown}
              onTouchStart={handleSwipeTouchStart}
            >
              {/* Old Image (Base Layer) */}
              <div className="swipe-layer old-layer">
                <img
                  src={diff.oldImage!.dataUrl}
                  alt="Old version"
                  className="swipe-img"
                  draggable={false}
                  onError={() => setOldError(true)}
                />
                <div className="swipe-info-tag tag-old">
                  OLD: {oldDims ? `${oldDims.width}x${oldDims.height}` : ''} ({oldSizeStr})
                </div>
              </div>

              {/* New Image (Overlay Layer, Clipped) */}
              <div
                className="swipe-layer new-layer"
                style={{ clipPath: `inset(0 ${100 - swipePercent}% 0 0)` }}
              >
                <img
                  src={diff.newImage!.dataUrl}
                  alt="New version"
                  className="swipe-img"
                  draggable={false}
                  onError={() => setNewError(true)}
                />
                <div className="swipe-info-tag tag-new">
                  NEW: {newDims ? `${newDims.width}x${newDims.height}` : ''} ({newSizeStr})
                </div>
              </div>

              {/* Swipe Handle Wrapper for GPU acceleration */}
              <div
                className="swipe-handle-wrapper"
                style={{ transform: `translate3d(${swipePercent}%, 0, 0)` }}
              >
                <div className="swipe-handle">
                  <div className="swipe-handle-bar"></div>
                  <div className="swipe-handle-circle">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M8.5 6L3.5 12L8.5 18V6M15.5 6L20.5 12L15.5 18V6Z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {mode === 'onion' && hasOld && hasNew && (
          oldError || newError ? (
            <span className="image-error-state">Failed to load image preview</span>
          ) : (
            <div className="image-diff-onion-container">
              {/* Background Old Image */}
              <div className="onion-layer old-layer">
                <img
                  src={diff.oldImage!.dataUrl}
                  alt="Old version"
                  className="onion-img"
                  draggable={false}
                  onError={() => setOldError(true)}
                />
                <div className="onion-info-tag tag-old">
                  OLD: {oldDims ? `${oldDims.width}x${oldDims.height}` : ''} ({oldSizeStr})
                </div>
              </div>

              {/* Foreground New Image with Opacity */}
              <div
                className="onion-layer new-layer"
                style={{ opacity: onionOpacity }}
              >
                <img
                  src={diff.newImage!.dataUrl}
                  alt="New version"
                  className="onion-img"
                  draggable={false}
                  onError={() => setNewError(true)}
                />
                <div className="onion-info-tag tag-new">
                  NEW: {newDims ? `${newDims.width}x${newDims.height}` : ''} ({newSizeStr})
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
});

ImageDiffViewer.displayName = 'ImageDiffViewer';

export const GitPanel: React.FC<GitPanelProps> = ({ cwd, onClose, width, onResize, activePaneId, terminalId, refreshTrigger = 0 }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<CommitHistoryItem | null>(null);
  const [commitFiles, setCommitFiles] = useState<{ additions: number; deletions: number; path: string }[]>([]);
  const [commitFilesHasMore, setCommitFilesHasMore] = useState(false);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [selectedCommitFile, setSelectedCommitFile] = useState<{ path: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes');
  const [selectedFile, setSelectedFile] = useState<{ path: string; isStaged: boolean } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [imageDiff, setImageDiff] = useState<GitImageDiffResult | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitLoading, setCommitLoading] = useState(false);
  const [history, setHistory] = useState<CommitHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isStagedCollapsed, setIsStagedCollapsed] = useState(true);
  const [isUnstagedCollapsed, setIsUnstagedCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isDiffMaximized, setIsDiffMaximized] = useState(false);
  const [maximizedDiffRect, setMaximizedDiffRect] = useState<MaximizedDiffRect | null>(null);
  const [hiddenDiffSnippets, setHiddenDiffSnippets] = useState<Record<string, HiddenDiffSnippetState>>({});
  const [diffScrollMarkers, setDiffScrollMarkers] = useState<DiffScrollMarker[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [stagedLimit, setStagedLimit] = useState(MAX_DISPLAYED_CHANGES);
  const [unstagedLimit, setUnstagedLimit] = useState(MAX_DISPLAYED_CHANGES);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySearchCaseSensitive, setHistorySearchCaseSensitive] = useState(false);
  const [activeHistoryMatchIndex, setActiveHistoryMatchIndex] = useState(-1);
  const loadedHistoryRawCountRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const historyLoadingRef = useRef(false);

  useEffect(() => {
    historyRequestIdRef.current += 1;
    loadedHistoryRawCountRef.current = 0;
    historyLoadingRef.current = false;
    setHistoryLoading(false);
    setHasMoreHistory(true);
    setHistory([]);
    setSelectedCommit(null);
    setCommitFiles([]);
    setCommitFilesHasMore(false);
    setSelectedCommitFile(null);
    setDiff(null);
    setDiffError(null);
    setHiddenDiffSnippets({});
    setHistorySearchQuery('');
    setActiveHistoryMatchIndex(-1);
    setStagedLimit(MAX_DISPLAYED_CHANGES);
    setUnstagedLimit(MAX_DISPLAYED_CHANGES);
    statusInFlightRef.current = false;
    pendingStatusRef.current = false;
    statusPromiseRef.current = null;
  }, [cwd]);

  const selectedFileRef = useRef<{ path: string; isStaged: boolean } | null>(null);
  const cwdRef = useRef(cwd);
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);
  const statusInFlightRef = useRef(false);
  const pendingStatusRef = useRef(false);
  const statusPromiseRef = useRef<Promise<void> | null>(null);
  const diffRequestIdRef = useRef(0);
  const commitFilesRequestIdRef = useRef(0);
  const commitDiffRequestIdRef = useRef(0);
  const diffBodyRef = useRef<HTMLDivElement | null>(null);
  const loaderRef = useRef<HTMLTableRowElement | null>(null);
  const historyContainerRef = useRef<HTMLDivElement | null>(null);
  const historyRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const { historyForGraph, graphRows, hashToIndexMap } = useMemo(() => {
    const stagedCount = status?.staged?.length || 0;
    const unstagedCount = status?.unstaged?.length || 0;
    const changeCount = stagedCount + unstagedCount;
    const actualHeadCommit = history.find((item) => item.isHEAD);
    const headHash = actualHeadCommit ? actualHeadCommit.hash : (history[0]?.hash || 'HEAD');
    const historyForGraph = changeCount > 0
      ? [
          {
            hash: 'uncommitted',
            parents: [headHash],
            decorations: '',
            subject: `Uncommitted Changes (${changeCount})`,
            author: '',
            date: '',
            timestamp: Date.now() / 1000,
            isUncommitted: true
          },
          ...history
        ]
      : [...history];
    const graphRows = computeGraphData(historyForGraph);

    const hashToIndexMap = new Map<string, { index: number; isHEAD: boolean }>();
    historyForGraph.forEach((item, index) => {
      hashToIndexMap.set(item.hash, { index, isHEAD: !!item.isHEAD });
    });

    return {
      historyForGraph,
      graphRows,
      hashToIndexMap
    };
  }, [history, status?.staged, status?.unstaged]);

  const { parsedLines, hiddenDiffLineCount, foldedDiffLineCount } = useMemo(() => {
    if (!diff) return { parsedLines: [], hiddenDiffLineCount: 0, foldedDiffLineCount: 0 };
    const lines = diff.split('\n');
    const renderLimit = isDiffMaximized
      ? Math.min(lines.length, MAX_MAXIMIZED_RENDERED_DIFF_LINES)
      : MAX_RENDERED_DIFF_LINES;
    const visibleLines = lines.slice(0, renderLimit);
    const hiddenCount = Math.max(0, lines.length - renderLimit);
    const parsed = parseDiffLines(visibleLines);

    const activePath = selectedFile?.path || selectedCommitFile?.path || '';
    const ext = activePath.split('.').pop()?.toLowerCase() || '';
    let dataLang = 'text';
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
      dataLang = ext.includes('ts') ? 'typescript' : 'javascript';
    } else if (ext === 'css') {
      dataLang = 'css';
    } else if (ext === 'json') {
      dataLang = 'json';
    } else if (['html', 'htm', 'xml'].includes(ext)) {
      dataLang = 'html';
    }

    let highlightedCodeCount = 0;
    const highlighted: HighlightedDiffLine[] = parsed.map((lineInfo) => {
      const { className, prefix, content, oldLineNumber, newLineNumber, raw } = lineInfo;
      const isCodeLine = className === 'diff-line-addition' || className === 'diff-line-deletion' || className === 'diff-line-normal';

      let highlightedCode: React.ReactNode = null;
      if (isCodeLine) {
        if (highlightedCodeCount < 3000) {
          highlightedCode = highlightCodeLine(content, activePath);
          highlightedCodeCount += 1;
        } else {
          highlightedCode = content;
        }
      } else {
        highlightedCode = raw;
      }

      return {
        oldLineNumber,
        newLineNumber,
        prefix,
        className,
        isCodeLine,
        raw,
        dataLang,
        highlightedCode
      };
    });

    const renderLines: RenderableDiffLine[] = [];
    let foldedCount = 0;
    let hasSeenHunk = false;
    let previousOldEnd = 0;
    let previousNewEnd = 0;

    for (let index = 0; index < highlighted.length; index += 1) {
      const lineInfo = highlighted[index];
      if (isDiffMaximized && lineInfo.className === 'diff-line-hunk') {
        const match = lineInfo.raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          const oldStart = parseInt(match[1], 10);
          const oldCount = match[2] === undefined ? 1 : parseInt(match[2], 10);
          const newStart = parseInt(match[3], 10);
          const newCount = match[4] === undefined ? 1 : parseInt(match[4], 10);
          const hiddenLines = hasSeenHunk
            ? Math.max(0, oldStart - previousOldEnd, newStart - previousNewEnd)
            : Math.max(0, oldStart - 1, newStart - 1);

          if (hiddenLines > 0) {
            renderLines.push({
              type: 'hidden-lines',
              key: `hidden-${index}-${oldStart}-${newStart}`,
              count: hiddenLines,
              oldStartLine: hasSeenHunk ? previousOldEnd : 1,
              newStartLine: hasSeenHunk ? previousNewEnd : 1
            });
            foldedCount += hiddenLines;
          }

          previousOldEnd = oldStart + oldCount;
          previousNewEnd = newStart + newCount;
          hasSeenHunk = true;
        }
      }
      renderLines.push(lineInfo);
    }

    return {
      parsedLines: renderLines,
      hiddenDiffLineCount: hiddenCount,
      foldedDiffLineCount: foldedCount
    };
  }, [diff, isDiffMaximized, selectedFile?.path, selectedCommitFile?.path]);

  const { visibleCommitFiles, hiddenCommitFilesCount } = useMemo(() => {
    const limit = 400;
    if (commitFiles.length <= limit) {
      return {
        visibleCommitFiles: commitFiles,
        hiddenCommitFilesCount: 0
      };
    }
    return {
      visibleCommitFiles: commitFiles.slice(0, limit),
      hiddenCommitFilesCount: commitFiles.length - limit
    };
  }, [commitFiles]);

  const groupedCommitFiles = useMemo(() => {
    return groupFilesByDirectory(visibleCommitFiles);
  }, [visibleCommitFiles]);

  const normalizeHistorySearchText = useCallback((value: string) => {
    return historySearchCaseSensitive ? value : value.toLowerCase();
  }, [historySearchCaseSensitive]);

  const historyFindQuery = historySearchQuery.trim();
  const normalizedHistoryFindQuery = normalizeHistorySearchText(historyFindQuery);

  const getHistorySearchFields = useCallback((commit: CommitHistoryItem) => {
    const shortHash = commit.hash.substring(0, 8);
    return [
      commit.subject,
      commit.author,
      commit.date,
      commit.decorations,
      commit.hash,
      shortHash,
      String(commit.timestamp || '')
    ];
  }, []);

  const historyMatchHashes = useMemo(() => {
    if (!normalizedHistoryFindQuery) return [];

    return historyForGraph
      .filter((commit) => {
        if (commit.isUncommitted) return false;
        return getHistorySearchFields(commit).some((field) => (
          normalizeHistorySearchText(field || '').includes(normalizedHistoryFindQuery)
        ));
      })
      .map((commit) => commit.hash);
  }, [getHistorySearchFields, historyForGraph, normalizeHistorySearchText, normalizedHistoryFindQuery]);

  const historyMatchHashSet = useMemo(() => new Set(historyMatchHashes), [historyMatchHashes]);

  const activeHistoryMatchHash = activeHistoryMatchIndex >= 0
    ? historyMatchHashes[activeHistoryMatchIndex]
    : undefined;

  const renderHistorySearchHighlight = useCallback((text: string) => {
    if (!normalizedHistoryFindQuery || !text) return text;

    const normalizedText = normalizeHistorySearchText(text);
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let matchIndex = normalizedText.indexOf(normalizedHistoryFindQuery);
    let key = 0;

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        parts.push(text.slice(cursor, matchIndex));
      }
      const end = matchIndex + normalizedHistoryFindQuery.length;
      parts.push(
        <mark className="git-history-search-highlight" key={`match-${key}`}>
          {text.slice(matchIndex, end)}
        </mark>
      );
      cursor = end;
      key += 1;
      matchIndex = normalizedText.indexOf(normalizedHistoryFindQuery, cursor);
    }

    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }

    return parts.length > 0 ? parts : text;
  }, [normalizeHistorySearchText, normalizedHistoryFindQuery]);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  useEffect(() => {
    setActiveHistoryMatchIndex(-1);
  }, [historyFindQuery, historySearchCaseSensitive]);

  useEffect(() => {
    const handleUndone = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.message) {
        setCommitMessage(customEvent.detail.message);
      }
    };
    window.addEventListener('git-undone-commit', handleUndone);
    return () => {
      window.removeEventListener('git-undone-commit', handleUndone);
    };
  }, []);

  useEffect(() => {
    if (isDropdownOpen) {
      window.terminalApi.gitWorktrees({ cwd }).then(setWorktrees).catch(console.error);
    }
  }, [cwd, isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.git-repo-dropdown')) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isDropdownOpen]);

  const handleSelectWorktree = async (wt: GitWorktree) => {
    setIsDropdownOpen(false);
    if (wt.isCurrent) return;
    if (terminalId) {
      await window.terminalApi.write({
        id: terminalId,
        data: `cd ${JSON.stringify(wt.path)}`
      });
    }
  };

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const newWidth = window.innerWidth - moveEvent.clientX;
      const constrainedWidth = Math.max(280, Math.min(800, newWidth));
      onResize(constrainedWidth);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const [columnWidths, setColumnWidths] = useState({
    graph: 140,
    desc: 480,
    date: 110,
    author: 150,
    commit: 100
  });

  const handleColResizeStart = (e: React.PointerEvent, colName: keyof typeof columnWidths) => {
    e.preventDefault();
    e.stopPropagation();

    e.currentTarget.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startWidth = columnWidths[colName];

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(55, startWidth + deltaX);
      setColumnWidths(prev => ({
        ...prev,
        [colName]: newWidth
      }));
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const [fileListHeight, setFileListHeight] = useState<number | string>('50%');

  const handleVerticalResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const resizer = e.currentTarget;
    const scrollArea = resizer.previousElementSibling as HTMLElement;
    const startHeight = scrollArea ? scrollArea.offsetHeight : 250;

    const startY = e.clientY;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(80, startHeight + deltaY);
      setFileListHeight(newHeight);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Load Status
  const loadStatus = useCallback((showLoading = false): Promise<void> => {
    if (!cwd) return Promise.resolve();
    if (statusInFlightRef.current) {
      pendingStatusRef.current = true;
      return statusPromiseRef.current || Promise.resolve();
    }

    statusInFlightRef.current = true;
    const statusPromise = (async () => {
      if (showLoading) setIsRefreshing(true);

      try {
        do {
          pendingStatusRef.current = false;
          const gitStatus: GitStatus = await window.terminalApi.gitStatus({ cwd });

          if (cwdRef.current !== cwd) return;

          setStatus(gitStatus);

          setStagedLimit(prev => Math.max(MAX_DISPLAYED_CHANGES, Math.min(prev, gitStatus.staged?.length || 0)));
          setUnstagedLimit(prev => Math.max(MAX_DISPLAYED_CHANGES, Math.min(prev, gitStatus.unstaged?.length || 0)));

          const currentSelection = selectedFileRef.current;
          if (currentSelection) {
            const fileExists =
              (gitStatus.staged?.some(f => f.path === currentSelection.path) || false) ||
              (gitStatus.unstaged?.some(f => f.path === currentSelection.path) || false);
            if (!fileExists) {
              selectedFileRef.current = null;
              setSelectedFile(null);
              setDiff(null);
              setHiddenDiffSnippets({});
            }
          }
        } while (pendingStatusRef.current);
      } catch (err) {
        console.error('Failed to load git status:', err);
      } finally {
        if (cwdRef.current === cwd) {
          statusInFlightRef.current = false;
          statusPromiseRef.current = null;
          if (showLoading) setIsRefreshing(false);
        }
      }
    })();

    statusPromiseRef.current = statusPromise;
    return statusPromise;
  }, [cwd]);

  // Load Diff
  const loadDiff = useCallback(async (file: { path: string; isStaged: boolean }) => {
    if (!cwd) return;
    const requestId = diffRequestIdRef.current + 1;
    diffRequestIdRef.current = requestId;
    setDiff(null);
    setImageDiff(null);
    setDiffError(null);
    setHiddenDiffSnippets({});

    if (isImageFile(file.path)) {
      try {
        const result = await window.terminalApi.gitImageDiff({
          cwd,
          filePath: file.path,
          isStaged: file.isStaged
        });
        if (diffRequestIdRef.current !== requestId) return;
        if (result.error) {
          setDiffError(result.error);
        } else {
          setImageDiff(result);
        }
      } catch (err: any) {
        if (diffRequestIdRef.current !== requestId) return;
        setDiffError(err.message || 'Failed to load image diff');
      }
      return;
    }

    try {
      const result = await window.terminalApi.gitDiff({
        cwd,
        filePath: file.path,
        isStaged: file.isStaged
      });
      if (diffRequestIdRef.current !== requestId) return;
      if (result.error) {
        setDiffError(result.error);
      } else {
        setDiff(result.diff || 'No differences found.');
      }
    } catch (err: any) {
      if (diffRequestIdRef.current !== requestId) return;
      setDiffError(err.message || 'Failed to load diff');
    }
  }, [cwd]);

  const loadHistory = useCallback(async (reset = false) => {
    if (!cwd) return;
    if (historyLoadingRef.current && !reset) return;
    const requestId = ++historyRequestIdRef.current;
    const skip = reset ? 0 : loadedHistoryRawCountRef.current;
    if (skip >= MAX_HISTORY_ITEMS) {
      setHasMoreHistory(false);
      return;
    }
    const limit = Math.min(HISTORY_PAGE_SIZE, MAX_HISTORY_ITEMS - skip);
    const requestLimit = skip + limit < MAX_HISTORY_ITEMS ? limit + 1 : limit;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    try {
      const logText = await window.terminalApi.gitHistory({
        cwd,
        limit: requestLimit,
        skip
      });
      if (historyRequestIdRef.current !== requestId) return;
      const rawLines = logText.split('\n').map(line => line.trim()).filter(Boolean);
      const pageLines = rawLines.slice(0, limit);
      loadedHistoryRawCountRef.current = skip + pageLines.length;
      setHasMoreHistory(rawLines.length > limit && loadedHistoryRawCountRef.current < MAX_HISTORY_ITEMS);
      const items: CommitHistoryItem[] = rawLines
        .slice(0, limit)
        .map((line) => {
          const parts = line.split('|');
          const hash = parts[0] || '';
          const parents = parts[1] ? parts[1].trim().split(' ').filter(Boolean) : [];
          const decorations = parts[2] || '';
          const subject = parts[3] || '';
          const author = parts[4] || '';
          const date = parts[5] || '';
          const timestamp = parts[6] ? parseInt(parts[6], 10) : 0;

          let isHEAD = false;
          if (decorations) {
            let cleanDec = decorations.trim();
            if (cleanDec.startsWith('(') && cleanDec.endsWith(')')) {
              cleanDec = cleanDec.slice(1, -1);
            }
            const decParts = cleanDec.split(', ');
            for (const p of decParts) {
              const trimmed = p.trim();
              if (trimmed === 'HEAD' || trimmed.startsWith('HEAD -> ')) {
                isHEAD = true;
                break;
              }
            }
          }

          return {
            hash,
            parents,
            decorations,
            subject,
            author,
            date,
            timestamp,
            isHEAD
          };
        });

      const hiddenStashHelperHashes = new Set(
        items
          .filter(item => /^index on .+: /.test(item.subject) || /^untracked files on .+: /.test(item.subject))
          .map(item => item.hash)
      );
      const visibleItems = items
        .filter(item => !hiddenStashHelperHashes.has(item.hash))
        .map(item => ({
          ...item,
          parents: item.parents.filter(parent => !hiddenStashHelperHashes.has(parent))
        }));

      visibleItems.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(prev => {
        const combined = reset ? visibleItems : [...prev, ...visibleItems];
        const seen = new Set<string>();
        return combined.filter(item => {
          if (seen.has(item.hash)) return false;
          seen.add(item.hash);
          return true;
        });
      });
    } catch (err) {
      if (historyRequestIdRef.current !== requestId) return;
      console.error('Failed to load history:', err);
    } finally {
      if (historyRequestIdRef.current !== requestId) return;
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (!historyFindQuery || historyMatchHashes.length === 0) {
      setActiveHistoryMatchIndex(-1);
      return;
    }

    setActiveHistoryMatchIndex((current) => {
      if (current >= 0 && current < historyMatchHashes.length) {
        return current;
      }
      return 0;
    });
  }, [historyFindQuery, historyMatchHashes.length]);

  useLayoutEffect(() => {
    if (!activeHistoryMatchHash) return;
    const row = historyRowRefs.current.get(activeHistoryMatchHash);
    const container = historyContainerRef.current;
    if (!row || !container) return;

    const rowTop = row.offsetTop;
    const targetTop = Math.max(0, rowTop - container.clientHeight * 0.35);
    container.scrollTo({ top: targetTop, behavior: 'auto' });
  }, [activeHistoryMatchHash]);

  const goToHistoryMatch = useCallback((direction: 'next' | 'previous') => {
    if (historyMatchHashes.length === 0) {
      if (historyFindQuery && hasMoreHistory && !historyLoadingRef.current && activeTab === 'history') {
        loadHistory(false);
      }
      return;
    }
    setActiveHistoryMatchIndex((current) => {
      if (current < 0) return 0;
      if (
        direction === 'next' &&
        current === historyMatchHashes.length - 1 &&
        historyFindQuery &&
        hasMoreHistory &&
        !historyLoadingRef.current &&
        activeTab === 'history'
      ) {
        loadHistory(false);
      }
      if (direction === 'next') {
        return (current + 1) % historyMatchHashes.length;
      }
      return (current - 1 + historyMatchHashes.length) % historyMatchHashes.length;
    });
  }, [activeTab, hasMoreHistory, historyFindQuery, historyMatchHashes.length, loadHistory]);


  const handleCommitRowClick = useCallback(async (commit: CommitHistoryItem) => {
    if (selectedCommit?.hash === commit.hash) {
      commitFilesRequestIdRef.current += 1;
      commitDiffRequestIdRef.current += 1;
      setSelectedCommit(null);
      setCommitFiles([]);
      setCommitFilesHasMore(false);
      setSelectedCommitFile(null);
      setDiff(null);
      setDiffError(null);
      setHiddenDiffSnippets({});
      return;
    }

    const requestId = commitFilesRequestIdRef.current + 1;
    commitFilesRequestIdRef.current = requestId;
    commitDiffRequestIdRef.current += 1;

    setSelectedCommit(commit);
    setCommitFiles([]);
    setCommitFilesHasMore(false);
    setSelectedCommitFile(null);
    setDiff(null);
    setDiffError(null);
    setHiddenDiffSnippets({});
    setCommitFilesLoading(true);

    try {
      const files = await window.terminalApi.gitCommitFiles({
        cwd,
        hash: commit.hash
      });
      if (commitFilesRequestIdRef.current !== requestId) return;
      setCommitFiles(files.files);
      setCommitFilesHasMore(files.hasMore);
    } catch (err) {
      if (commitFilesRequestIdRef.current !== requestId) return;
      console.error('Failed to load commit files:', err);
    } finally {
      if (commitFilesRequestIdRef.current === requestId) {
        setCommitFilesLoading(false);
      }
    }
  }, [cwd, selectedCommit]);

  const handleCommitFileClick = useCallback(async (filePath: string) => {
    if (!cwd || !selectedCommit) return;

    const requestId = commitDiffRequestIdRef.current + 1;
    commitDiffRequestIdRef.current = requestId;

    setSelectedCommitFile({ path: filePath });
    setDiff(null);
    setImageDiff(null);
    setDiffError(null);
    setHiddenDiffSnippets({});

    if (isImageFile(filePath)) {
      try {
        const result = await window.terminalApi.gitImageDiff({
          cwd,
          filePath,
          isStaged: false,
          hash: selectedCommit.hash
        });
        if (commitDiffRequestIdRef.current !== requestId) return;
        if (result.error) {
          setDiffError(result.error);
        } else {
          setImageDiff(result);
        }
      } catch (err: any) {
        if (commitDiffRequestIdRef.current !== requestId) return;
        setDiffError(err.message || 'Failed to load image diff');
      }
      return;
    }

    try {
      const result = await window.terminalApi.gitCommitFileDiff({
        cwd,
        hash: selectedCommit.hash,
        filePath
      });
      if (commitDiffRequestIdRef.current !== requestId) return;
      if (result.error) {
        setDiffError(result.error);
      } else {
        setDiff(result.diff || 'No differences found.');
      }
    } catch (err: any) {
      if (commitDiffRequestIdRef.current !== requestId) return;
      setDiffError(err.message || 'Failed to load diff');
    }
  }, [cwd, selectedCommit]);

  // Handle Watcher / Initial Load (only when app is focused)
  useEffect(() => {
    if (!cwd) return;

    let unsubscribe: (() => void) | null = null;
    let isWatched = false;

    const startWatching = (sync = true) => {
      if (isWatched) return;
      isWatched = true;

      if (sync) {
        loadStatus(false);
      }

      window.terminalApi.gitWatch({ cwd });

      unsubscribe = window.terminalApi.onGitChange(() => {
        loadStatus(false);
      });
    };

    const stopWatching = () => {
      if (!isWatched) return;
      isWatched = false;

      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      // Stop watching in Main Process to release OS file descriptors
      window.terminalApi.gitWatch({ cwd: '' });
    };

    // Initial load
    loadStatus(true);

    if (document.hasFocus()) {
      startWatching(false);
    }

    // Listen to window focus/blur
    const handleFocus = () => {
      startWatching();
    };

    const handleBlur = () => {
      stopWatching();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      stopWatching();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [cwd, loadStatus]);

  // Load history when tab is history, CWD changes, or window gains focus
  useEffect(() => {
    if (activeTab !== 'history' || !cwd) return;

    loadedHistoryRawCountRef.current = 0;
    setHasMoreHistory(true);
    setHistory([]);
    setSelectedCommit(null);
    setCommitFiles([]);
    setCommitFilesHasMore(false);
    setSelectedCommitFile(null);
    setDiff(null);
    setDiffError(null);
    setHiddenDiffSnippets({});
    loadHistory(true);

    const handleFocus = () => {
      loadedHistoryRawCountRef.current = 0;
      setHasMoreHistory(true);
      loadHistory(true);
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [cwd, activeTab, loadHistory]);

  // Load diff when selection changes
  useEffect(() => {
    if (selectedFile) {
      loadDiff(selectedFile);
    }
  }, [selectedFile, loadDiff]);

  useLayoutEffect(() => {
    const body = diffBodyRef.current;
    if (!body || diffError || diff === null) {
      setDiffScrollMarkers([]);
      return;
    }

    const measureMarkers = () => {
      const scrollableHeight = Math.max(1, body.scrollHeight);
      const markerNodes = Array.from(body.querySelectorAll<HTMLElement>('[data-diff-marker-type]'));
      const measuredMarkers = markerNodes.map((node, index) => {
        const type = node.dataset.diffMarkerType as DiffScrollMarker['type'];
        return {
          key: `${type}-${node.offsetTop}-${index}`,
          type,
          targetTop: node.offsetTop,
          bottomTop: node.offsetTop + node.offsetHeight
        };
      });
      const groupedMarkers: { type: DiffScrollMarker['type']; targetTop: number; bottomTop: number }[] = [];
      const markerGapThreshold = 3;

      for (const marker of measuredMarkers) {
        const current = groupedMarkers[groupedMarkers.length - 1];
        if (current && current.type === marker.type && marker.targetTop - current.bottomTop <= markerGapThreshold) {
          current.bottomTop = Math.max(current.bottomTop, marker.bottomTop);
        } else {
          groupedMarkers.push({
            type: marker.type,
            targetTop: marker.targetTop,
            bottomTop: marker.bottomTop
          });
        }
      }

      const nextMarkers = groupedMarkers.map((marker, index) => ({
        key: `${marker.type}-${marker.targetTop}-${index}`,
        type: marker.type,
        targetTop: marker.targetTop,
        topPercent: (marker.targetTop / scrollableHeight) * 100,
        heightPercent: Math.max(0.7, ((marker.bottomTop - marker.targetTop) / scrollableHeight) * 100)
      }));
      setDiffScrollMarkers(nextMarkers);
    };

    const frameId = requestAnimationFrame(measureMarkers);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureMarkers);
    resizeObserver?.observe(body);
    const content = body.querySelector<HTMLElement>('.git-diff-pre');
    if (content) {
      resizeObserver?.observe(content);
    }
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [diff, diffError, hiddenDiffLineCount, hiddenDiffSnippets, parsedLines]);

  // Trigger refresh from prop
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadStatus(true);
      if (activeTab === 'history') {
        loadHistory(true);
      }
    }
  }, [refreshTrigger, loadStatus, loadHistory, activeTab]);

  // Keyboard shortcuts (Escape to restore, Cmd+Shift+D to toggle maximized diff view)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Escape to restore (only when maximized)
      if (isDiffMaximized && e.key === 'Escape') {
        setIsDiffMaximized(false);
        return;
      }

      // 2. Cmd+Shift+D (Mac) or Ctrl+Shift+D (Windows/Linux) to toggle
      const modifier = IS_MAC ? e.metaKey : e.ctrlKey;
      if (modifier && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsDiffMaximized((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDiffMaximized]);

  useLayoutEffect(() => {
    if (!isDiffMaximized) {
      setMaximizedDiffRect(null);
      return;
    }

    const terminalCanvas = document.querySelector<HTMLElement>('.terminal-canvas');
    if (!terminalCanvas) {
      setMaximizedDiffRect(null);
      return;
    }

    const updateRect = () => {
      const rect = terminalCanvas.getBoundingClientRect();
      setMaximizedDiffRect((prev) => {
        const next = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        };
        if (
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height
        ) {
          return prev;
        }
        return next;
      });
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateRect);
    resizeObserver?.observe(terminalCanvas);

    return () => {
      window.removeEventListener('resize', updateRect);
      resizeObserver?.disconnect();
    };
  }, [isDiffMaximized]);

  // Infinite scroll intersection observer
  useEffect(() => {
    if (!hasMoreHistory || historyLoading || !cwd || activeTab !== 'history') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !historyLoadingRef.current && !historyLoading) {
          loadHistory(false);
        }
      },
      {
        root: historyContainerRef.current, // relative to the scroll container
        rootMargin: '100px', // trigger load 100px before reaching the bottom
        threshold: 0
      }
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [hasMoreHistory, historyLoading, cwd, activeTab, loadHistory]);

  // File Actions
  const handleStageFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    try {
      await window.terminalApi.gitStage({ cwd, filePath });
      await loadStatus();
      if (selectedFile?.path === filePath) {
        setSelectedFile({ path: filePath, isStaged: true });
      }
    } catch (err) {
      alert('Failed to stage file: ' + err);
    }
  };

  const handleUnstageFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    try {
      await window.terminalApi.gitUnstage({ cwd, filePath });
      await loadStatus();
      if (selectedFile?.path === filePath) {
        setSelectedFile({ path: filePath, isStaged: false });
      }
    } catch (err) {
      alert('Failed to unstage file: ' + err);
    }
  };

  const handleDiscardFile = async (e: React.MouseEvent, filePath: string, isUntracked: boolean) => {
    e.stopPropagation();
    const isDirectory = filePath.endsWith('/');
    const targetDescription = isDirectory ? `directory ${filePath}` : filePath;
    if (!confirm(`Are you sure you want to discard changes in ${targetDescription}? This cannot be undone.`)) {
      return;
    }
    try {
      await window.terminalApi.gitDiscard({ cwd, filePath, isUntracked });
      await loadStatus();
    } catch (err) {
      alert('Failed to discard changes: ' + err);
    }
  };

  const handleDiscardAll = async () => {
    if (!confirm('Are you sure you want to discard ALL unstaged changes? This cannot be undone.')) {
      return;
    }
    try {
      await window.terminalApi.gitDiscardAll({ cwd });
      await loadStatus();
    } catch (err) {
      alert('Failed to discard all changes: ' + err);
    }
  };

  const handleStageAll = async () => {
    try {
      await window.terminalApi.gitStageAll({ cwd });
      await loadStatus();
    } catch (err) {
      alert('Failed to stage all: ' + err);
    }
  };

  const handleUnstageAll = async () => {
    try {
      await window.terminalApi.gitUnstageAll({ cwd });
      await loadStatus();
    } catch (err) {
      alert('Failed to unstage all: ' + err);
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    if (!status?.staged || status.staged.length === 0) {
      alert('No staged changes to commit.');
      return;
    }

    setCommitLoading(true);
    try {
      await window.terminalApi.gitCommit({ cwd, message: commitMessage });
      setCommitMessage('');
      await loadStatus();
      if (activeTab === 'history') {
        loadHistory(true);
      }
    } catch (err) {
      alert('Failed to commit: ' + err);
    } finally {
      setCommitLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCommit(e);
    }
  };

  const handleInitRepo = async () => {
    try {
      await window.terminalApi.gitInit({ cwd });
      await loadStatus(true);
    } catch (err) {
      alert('Failed to initialize repository: ' + err);
    }
  };

  const handleHiddenLinesToggle = async (line: HiddenDiffLinesBlock) => {
    const current = hiddenDiffSnippets[line.key];
    if (current?.lines || current?.error) {
      setHiddenDiffSnippets((snippets) => {
        const next = { ...snippets };
        delete next[line.key];
        return next;
      });
      return;
    }

    const activeFile = activeTab === 'changes' ? selectedFile : selectedCommitFile;
    if (!activeFile) return;

    setHiddenDiffSnippets((snippets) => ({
      ...snippets,
      [line.key]: { loading: true }
    }));

    try {
      const result = await window.terminalApi.gitFileSnippet({
        cwd,
        filePath: activeFile.path,
        source: activeTab === 'history' ? 'commit' : (selectedFile?.isStaged ? 'index' : 'workingTree'),
        ref: activeTab === 'history' ? selectedCommit?.hash : undefined,
        startLine: line.newStartLine,
        lineCount: line.count
      });

      setHiddenDiffSnippets((snippets) => ({
        ...snippets,
        [line.key]: result.error ? { error: result.error } : { lines: result.lines || [] }
      }));
    } catch (err: any) {
      setHiddenDiffSnippets((snippets) => ({
        ...snippets,
        [line.key]: { error: err.message || 'Failed to load hidden lines' }
      }));
    }
  };

  const renderDiffLine = (line: RenderableDiffLine, index: number) => {
    if ('type' in line && line.type === 'hidden-lines') {
      const snippet = hiddenDiffSnippets[line.key];
      return (
        <React.Fragment key={line.key}>
          <button
            type="button"
            className={`git-diff-hidden-lines-row ${snippet?.lines || snippet?.error ? 'is-expanded' : ''}`}
            data-diff-marker-type="hidden"
            onClick={() => handleHiddenLinesToggle(line)}
            title={snippet?.lines || snippet?.error ? 'Collapse hidden lines' : 'Show hidden lines'}
          >
            <div className="git-diff-hidden-gutter">
              {snippet?.loading ? null : (snippet?.lines || snippet?.error ? <FoldIcon /> : <UnfoldIcon />)}
            </div>
            <div className="git-diff-hidden-text">
              {snippet?.loading
                ? 'Loading hidden lines...'
                : snippet?.lines || snippet?.error
                  ? `Hide ${line.count} hidden lines`
                  : `${line.count} hidden lines`}
            </div>
          </button>
          {snippet?.error && renderDiffLine({
            raw: snippet.error,
            className: 'diff-line-meta',
            prefix: '',
            oldLineNumber: '',
            newLineNumber: '',
            isCodeLine: false,
            dataLang: 'text',
            highlightedCode: snippet.error
          }, index)}
          {snippet?.lines && (() => {
            const hasManyLines = snippet.lines.length > 100;
            const showSplit = hasManyLines && !snippet.fullyExpanded;

            const renderLineHelper = (content: string, snippetIndex: number) => renderDiffLine({
              raw: ` ${content}`,
              className: 'diff-line-normal',
              prefix: ' ',
              oldLineNumber: line.oldStartLine + snippetIndex,
              newLineNumber: line.newStartLine + snippetIndex,
              isCodeLine: true,
              dataLang: 'text',
              highlightedCode: highlightCodeLine(content, activeTab === 'changes' ? selectedFile?.path || '' : selectedCommitFile?.path || '')
            }, index + snippetIndex + 1);

            if (showSplit) {
              const firstPart = snippet.lines.slice(0, 50);
              const lastPart = snippet.lines.slice(-50);
              const middleCount = snippet.lines.length - 100;

              return (
                <>
                  {firstPart.map((content, idx) => renderLineHelper(content, idx))}
                  <button
                    type="button"
                    className="git-diff-hidden-lines-row git-diff-hidden-lines-middle"
                    onClick={() => {
                      setHiddenDiffSnippets((snippets) => ({
                        ...snippets,
                        [line.key]: {
                          ...snippets[line.key],
                          fullyExpanded: true
                        }
                      }));
                    }}
                  >
                    {middleCount > 500
                      ? `Show remaining ${middleCount} lines (expensive action)`
                      : `Show remaining ${middleCount} lines`}
                  </button>
                  {lastPart.map((content, idx) => {
                    const actualIdx = snippet.lines!.length - 50 + idx;
                    return renderLineHelper(content, actualIdx);
                  })}
                </>
              );
            }

            return snippet.lines.map((content, idx) => renderLineHelper(content, idx));
          })()}
        </React.Fragment>
      );
    }

    const diffLine = line as HighlightedDiffLine;
    const { className, prefix, oldLineNumber, newLineNumber, isCodeLine, dataLang, highlightedCode } = diffLine;
    const markerType =
      className === 'diff-line-addition'
        ? 'addition'
        : className === 'diff-line-deletion'
          ? 'deletion'
          : className === 'diff-line-hunk'
            ? 'hunk'
            : undefined;

    return (
      <div key={index} className={`git-diff-line ${className}`} data-lang={dataLang} data-diff-marker-type={markerType}>
        {isCodeLine ? (
          <>
            <span className="diff-line-number-old">{oldLineNumber}</span>
            <span className="diff-line-number-new">{newLineNumber}</span>
            <span className="diff-prefix">{prefix}</span>
            <span className="diff-code">{highlightedCode}</span>
          </>
        ) : (
          <>
            <span className="diff-line-number-old"></span>
            <span className="diff-line-number-new"></span>
            <span className="diff-prefix"></span>
            <span className="diff-code">{highlightedCode}</span>
          </>
        )}
      </div>
    );
  };

  const getStatusBadge = (statusChar: string) => {
    switch (statusChar.toUpperCase()) {
      case 'M':
        return <span className="git-badge badge-modified" title="Modified">M</span>;
      case 'A':
        return <span className="git-badge badge-added" title="Added">A</span>;
      case 'D':
        return <span className="git-badge badge-deleted" title="Deleted">D</span>;
      case 'R':
        return <span className="git-badge badge-renamed" title="Renamed">R</span>;
      case '?':
        return <span className="git-badge badge-untracked" title="Untracked">U</span>;
      default:
        return <span className="git-badge badge-modified" title="Modified">{statusChar}</span>;
    }
  };

  const handleDiffMarkerClick = (targetTop: number) => {
    const body = diffBodyRef.current;
    if (!body) return;

    body.scrollTop = Math.max(0, targetTop - body.clientHeight * 0.2);
  };

  // Helper icons
  const BranchIcon = () => (
    <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3.53 1.83 3.75 3.75 0 0 1-3.03 3.63v1.79a2.25 2.25 0 1 1-1.5 0V8.21c-.08-.01-.15-.02-.23-.04A3.75 3.75 0 0 1 5.28 4.75a2.25 2.25 0 1 1 1.5 0A2.25 2.25 0 0 0 9 6.75a2.25 2.25 0 0 0 1.25-.38V3.25zm-6 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM5 12.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/>
    </svg>
  );

  const UnfoldIcon = () => (
    <svg className="git-svg-icon unfold-icon" viewBox="0 0 16 16" width="12" height="12">
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 5l5-4 5 4M3 11l5 4 5-4"/>
    </svg>
  );

  const FoldIcon = () => (
    <svg className="git-svg-icon fold-icon" viewBox="0 0 16 16" width="12" height="12">
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 2l5 4 5-4M3 14l5-4 5 4"/>
    </svg>
  );

  const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
    <svg className={`git-svg-icon chevron ${collapsed ? '' : 'expanded'}`} viewBox="0 0 16 16" width="12" height="12">
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M6 12l4-4-4-4"/>
    </svg>
  );

  const TrashIcon = () => (
    <svg className="git-action-svg" viewBox="0 0 16 16" width="13" height="13">
      <path fill="currentColor" d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75zm4.5 1.25V1.75A1.75 1.75 0 0 0 9.25 0h-2.5A1.75 1.75 0 0 0 5 1.75V3H1.75a.75.75 0 0 0 0 1.5h.31l.86 10.02c.08.97.9 1.73 1.88 1.73h6.4c.98 0 1.8-.76 1.88-1.73l.86-10.02h.31a.75.75 0 0 0 0-1.5H11zm-1.5 1.5v9.5H6V4.5h3.5zm-5 0V14H3.26L2.56 4.5H4.5z"/>
    </svg>
  );

  const PlusIcon = () => (
    <svg className="git-action-svg" viewBox="0 0 16 16" width="13" height="13">
      <path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2z"/>
    </svg>
  );

  const MinusIcon = () => (
    <svg className="git-action-svg" viewBox="0 0 16 16" width="13" height="13">
      <path fill="currentColor" d="M2.75 7.25h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5z"/>
    </svg>
  );

  const RollbackIcon = () => (
    <svg className="git-action-svg" viewBox="0 0 16 16" width="13" height="13">
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a1.5 1.5 0 0 1-3 0V3H4.5V11.5a3 3 0 0 0 6 0V5.707l2.146 2.147a.5.5 0 0 0 .708-.708l-3-3a.5.5 0 0 0-.708 0l-3 3a.5.5 0 0 0 .708.708L7.5 5.707V1.854L7.646 1.146z"/>
    </svg>
  );

  const CloseIcon = () => (
    <svg className="git-svg-icon" viewBox="0 0 16 16" width="16" height="16">
      <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
    </svg>
  );

  const RefreshIcon = () => (
    <svg className={`git-svg-icon ${isRefreshing ? 'spin' : ''}`} viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M8 3a5 5 0 1 0 4.546 2.914.75.75 0 0 1 1.364-.628A6.5 6.5 0 1 1 8 1.5c1.479 0 2.87.492 4 1.332V1.25a.75.75 0 0 1 1.5 0v3.75a.75.75 0 0 1-.75.75h-3.75a.75.75 0 0 1 0-1.5h1.86A4.985 4.985 0 0 0 8 3z"/>
    </svg>
  );

  const SearchIcon = () => (
    <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 0 1-1.06 1.06l-3.04-3.04zM6.5 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"/>
    </svg>
  );

  const ArrowUpIcon = () => (
    <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M8 2.75a.75.75 0 0 1 .53.22l4.25 4.25a.75.75 0 1 1-1.06 1.06L8.75 5.31v7.94a.75.75 0 0 1-1.5 0V5.31L4.28 8.28a.75.75 0 0 1-1.06-1.06l4.25-4.25A.75.75 0 0 1 8 2.75z"/>
    </svg>
  );

  const ArrowDownIcon = () => (
    <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M8 13.25a.75.75 0 0 1-.53-.22L3.22 8.78a.75.75 0 0 1 1.06-1.06l2.97 2.97V2.75a.75.75 0 0 1 1.5 0v7.94l2.97-2.97a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-.53.22z"/>
    </svg>
  );

  const SparklesIcon = () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5z" />
      <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" />
    </svg>
  );

  // Loading skeleton/null checks
  if (!status) {
    return (
      <aside className="git-panel" style={{ width }}>
        <div className="git-sidebar-resize-handle" onPointerDown={handleResizeStart} />
        <div className="git-panel-header">
          <span className="git-panel-title">Git Control</span>
          <button className="git-close-btn" onClick={onClose} title="Close Sidebar">
            <CloseIcon />
          </button>
        </div>
        <div className="git-panel-loading">
          <div className="git-spinner"></div>
          <span>Loading Git status...</span>
        </div>
      </aside>
    );
  }

  // Not a repo state
  if (!status.isRepo) {
    return (
      <aside className="git-panel" style={{ width }}>
        <div className="git-sidebar-resize-handle" onPointerDown={handleResizeStart} />
        <div className="git-panel-header">
          <span className="git-panel-title">Git Control</span>
          <button className="git-close-btn" onClick={onClose} title="Close Sidebar">
            <CloseIcon />
          </button>
        </div>
        <div className="git-empty-state">
          <svg className="git-empty-icon" viewBox="0 0 16 16" width="48" height="48">
            <path fill="currentColor" d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2zm0 1.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75zm1.5 2.25a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5h-8a.75.75 0 0 1-.75-.75zm0 3.5a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5h-8a.75.75 0 0 1-.75-.75z"/>
          </svg>
          <h3>No Git Repository</h3>
          <p>This directory is not a Git repository. Initialize one to start tracking changes.</p>
          <button className="git-init-btn" onClick={handleInitRepo}>
            Initialize Repository
          </button>
        </div>
      </aside>
    );
  }

  const stagedCount = status.staged?.length || 0;
  const unstagedCount = status.unstaged?.length || 0;
  const totalChanges = stagedCount + unstagedCount;

  const maximizedPlaceholder = (
    <div className="git-diff-container git-diff-maximized-placeholder">
      <div className="git-diff-placeholder" style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <span style={{ fontSize: '12px', color: '#8b949e', textAlign: 'center' }}>Diff is maximized over terminals</span>
        <button
          type="button"
          onClick={() => setIsDiffMaximized(false)}
          style={{
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: '6px',
            color: '#c9d1d9',
            padding: '4px 10px',
            fontSize: '11px',
            cursor: 'pointer'
          }}
        >
          Restore View
        </button>
      </div>
    </div>
  );

  const activeFile = activeTab === 'changes' ? selectedFile : selectedCommitFile;

  const inlineStyles: React.CSSProperties = isDiffMaximized && maximizedDiffRect ? {
    position: 'fixed',
    top: maximizedDiffRect.top,
    left: maximizedDiffRect.left,
    width: maximizedDiffRect.width,
    height: maximizedDiffRect.height
  } : {};

  const diffElement = (
    <div className={`git-diff-container ${isDiffMaximized ? 'maximized' : ''}`} style={{ flex: 1, ...inlineStyles }}>
      {activeFile ? (
        <>
          <div className="git-diff-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <button
                type="button"
                className="git-icon-btn git-diff-maximize-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDiffMaximized((v) => !v);
                }}
                title={isDiffMaximized ? "Restore to sidebar (Cmd+Shift+D / Esc)" : "Show on top of terminal (Cmd+Shift+D)"}
              >
                {isDiffMaximized ? <MinimizeIcon /> : <MaximizeIcon />}
              </button>
              <span className="git-diff-filename" title={activeFile.path}>{activeFile.path}</span>
            </div>
            <div className="git-diff-header-actions">
              {isDiffMaximized && foldedDiffLineCount > 0 && (
                <span className="git-diff-hidden-summary" title="Unchanged lines hidden between diff hunks">
                  {foldedDiffLineCount} hidden
                </span>
              )}
              <span className="git-diff-status">
                {activeTab === 'changes'
                  ? (selectedFile?.isStaged ? 'staged' : 'working tree')
                  : `commit ${selectedCommit?.hash.substring(0, 8)}`}
              </span>
            </div>
          </div>
          <div className="git-diff-body-shell">
            <div className="git-diff-body" ref={diffBodyRef}>
              {diffError ? (
                <div className="git-diff-error">{diffError}</div>
              ) : isImageFile(activeFile.path) ? (
                imageDiff === null ? (
                  <div className="git-diff-loading">Loading image diff...</div>
                ) : (
                  <ImageDiffViewer diff={imageDiff} />
                )
              ) : diff === null ? (
                <div className="git-diff-loading">Loading diff...</div>
              ) : (
                <pre className="git-diff-pre">
                  <code>
                    {parsedLines.map((lineInfo, i) => renderDiffLine(lineInfo, i))}
                    {hiddenDiffLineCount > 0 && renderDiffLine({
                      raw: `... Preview truncated: ${hiddenDiffLineCount} more lines not shown.`,
                      className: 'diff-line-meta',
                      prefix: '',
                      oldLineNumber: '',
                      newLineNumber: '',
                      isCodeLine: false,
                      dataLang: 'text',
                      highlightedCode: `... Preview truncated: ${hiddenDiffLineCount} more lines not shown.`
                    }, parsedLines.length)}
                  </code>
                </pre>
              )}
            </div>
            {diffScrollMarkers.length > 0 && (
              <div className="git-diff-scroll-markers">
                {diffScrollMarkers.map((marker) => (
                  <button
                    key={marker.key}
                    type="button"
                    className={`git-diff-scroll-marker marker-${marker.type}`}
                    style={{
                      top: `${marker.topPercent}%`,
                      height: `${marker.heightPercent}%`
                    }}
                    onClick={() => handleDiffMarkerClick(marker.targetTop)}
                    tabIndex={-1}
                    title="Jump to diff marker"
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {isDiffMaximized && (
            <div className="git-diff-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="git-icon-btn git-diff-maximize-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDiffMaximized(false);
                  }}
                  title="Restore to sidebar (Cmd+Shift+D / Esc)"
                >
                  <MinimizeIcon />
                </button>
                <span className="git-diff-filename">No file selected</span>
              </div>
            </div>
          )}
          <div className="git-diff-placeholder">
            {activeTab === 'changes'
              ? 'Select a file to view differences'
              : 'Select a file in the expanded commit to view differences'}
          </div>
        </>
      )}
    </div>
  );

  return (
    <aside className="git-panel" style={{ width, zIndex: isDiffMaximized ? 30 : undefined }}>
      <div className="git-sidebar-resize-handle" onPointerDown={handleResizeStart} />
      {/* 1. Header with Branch Name and Repo info */}
      <div className="git-panel-header">
        <div className="git-header-left">
          <div className="git-branch-badge">
            <BranchIcon />
            <span className="git-branch-name">{status.branch}</span>
          </div>
          <div className="git-repo-dropdown" onClick={() => setIsDropdownOpen((open) => !open)}>
            <span className="git-repo-name">{status.repoName}</span>
            <svg viewBox="0 0 16 16" width="10" height="10" className={`git-dropdown-chevron ${isDropdownOpen ? 'open' : ''}`}>
              <path fill="currentColor" d="M8 11L3 6h10l-5 5z"/>
            </svg>
            {isDropdownOpen && worktrees.length > 0 && (
              <div className="git-worktree-dropdown-list" onClick={(e) => e.stopPropagation()}>
                <div className="git-worktree-dropdown-header">Git Worktrees</div>
                {worktrees.map((wt) => (
                  <button
                    key={wt.path}
                    className={`git-worktree-dropdown-item ${wt.isCurrent ? 'active' : ''}`}
                    onClick={() => handleSelectWorktree(wt)}
                    title={wt.path}
                    type="button"
                  >
                    <div className="git-worktree-item-name">
                      {wt.name} {wt.branch && <span className="git-worktree-item-branch">[{wt.branch}]</span>}
                    </div>
                    <div className="git-worktree-item-path">{wt.path}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="git-header-actions">
          <button
            className="git-icon-btn"
            onClick={async () => {
              await loadStatus(true);
              if (activeTab === 'history') {
                loadHistory(true);
              }
            }}
            title="Refresh"
          >
            <RefreshIcon />
          </button>
          <button className="git-close-btn" onClick={onClose} title="Close Sidebar">
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* 2. Changes vs History Tabs */}
      <div className="git-tabs">
        <button
          className={`git-tab ${activeTab === 'changes' ? 'active' : ''}`}
          onClick={() => {
            diffRequestIdRef.current += 1;
            commitFilesRequestIdRef.current += 1;
            commitDiffRequestIdRef.current += 1;
            setActiveTab('changes');
            setSelectedFile(null);
            setSelectedCommit(null);
            setCommitFiles([]);
            setCommitFilesHasMore(false);
            setSelectedCommitFile(null);
            setDiff(null);
            setDiffError(null);
            setHiddenDiffSnippets({});
          }}
        >
          Changes
          {totalChanges > 0 && <span className="git-tab-count">{totalChanges}</span>}
        </button>
        <button
          className={`git-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => {
            diffRequestIdRef.current += 1;
            commitFilesRequestIdRef.current += 1;
            commitDiffRequestIdRef.current += 1;
            setActiveTab('history');
            setSelectedFile(null);
            setSelectedCommit(null);
            setCommitFiles([]);
            setCommitFilesHasMore(false);
            setSelectedCommitFile(null);
            setDiff(null);
            setDiffError(null);
            setHiddenDiffSnippets({});
          }}
        >
          History
        </button>
      </div>

      {activeTab === 'changes' ? (
        <div className="git-tab-content">
          <form className="git-commit-container" onSubmit={handleCommit}>
            <div className="git-commit-input-wrapper">
              <textarea
                className="git-commit-input"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message (${navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘Enter' : 'Ctrl+Enter'} to commit on "${status?.branch || 'master'}")`}
                rows={1}
              />
              <div className="git-commit-input-icon">
                <SparklesIcon />
              </div>
            </div>
            <button
              type="submit"
              className="git-commit-btn"
              disabled={commitLoading || !commitMessage.trim()}
            >
              {commitLoading ? (
                <span>Committing...</span>
              ) : (
                <>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', paddingLeft: '20px' }}>
                    <svg className="git-commit-btn-check" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
                    </svg>
                    <span>Commit</span>
                  </div>
                  <div className="git-commit-btn-divider" style={{ width: '1px', height: '100%', background: 'rgba(255, 255, 255, 0.2)', margin: '0 8px' }} />
                  <svg className="git-commit-btn-chevron" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style={{ marginRight: '4px' }}>
                    <path d="M4.47 5.47a.75.75 0 0 1 1.06 0L8 7.94l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06z"/>
                  </svg>
                </>
              )}
            </button>
          </form>
          {/* Changes content wrapper */}
          <div className="git-changes-scroll-area" style={{ height: fileListHeight, flex: 'none' }}>
            {/* STAGED SECTION */}
            <div className="git-section-header" onClick={() => setIsStagedCollapsed(!isStagedCollapsed)}>
              <div className="git-section-header-left">
                <ChevronIcon collapsed={isStagedCollapsed} />
                <span>Staged Changes</span>
                <span className="git-section-count">{stagedCount}</span>
              </div>
              {stagedCount > 0 && (
                <button
                  className="git-section-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnstageAll();
                  }}
                  title="Unstage all"
                >
                  <MinusIcon />
                </button>
              )}
            </div>

            {!isStagedCollapsed && (
              <div className="git-file-list">
                {stagedCount === 0 ? (
                  <div className="git-file-empty">No staged changes</div>
                ) : (
                  <>
                    {status.staged?.slice(0, stagedLimit).map((file) => {
                      const isSelected = selectedFile?.path === file.path && selectedFile.isStaged;
                      return (
                        <div
                          key={file.path}
                          className={`git-file-row ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSelectedFile({ path: file.path, isStaged: true })}
                        >
                          <div className="git-file-row-left">
                            <FileIcon filename={file.name} isDirectory={file.kind === 'directory'} />
                            <span className="git-file-name" title={file.path}>{file.name}</span>
                            {file.dir && <span className="git-file-dir">{file.dir}</span>}
                          </div>
                          <div className="git-file-row-right">
                            {getStatusBadge(file.status)}
                            <div className="git-file-row-actions">
                              <button
                                className="git-row-action-btn"
                                onClick={(e) => handleUnstageFile(e, file.path)}
                                title="Unstage"
                              >
                                <MinusIcon />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {(stagedCount > stagedLimit || stagedLimit > MAX_DISPLAYED_CHANGES) && (
                      <div className="git-file-limit-message" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 12px', fontSize: '11px', color: '#8b949e', borderTop: '1px solid #21262d' }}>
                        <span>Showing first {Math.min(stagedLimit, stagedCount)} of {stagedCount} staged changes.</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {stagedCount > stagedLimit && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStagedLimit(prev => prev + MAX_DISPLAYED_CHANGES);
                              }}
                              className="git-show-more-btn"
                              style={{
                                background: '#21262d',
                                border: '1px solid #30363d',
                                borderRadius: '4px',
                                color: '#c9d1d9',
                                padding: '4px 8px',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              Show More
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStagedLimit(MAX_DISPLAYED_CHANGES);
                            }}
                            className="git-show-less-btn"
                            style={{
                              background: '#21262d',
                              border: '1px solid #30363d',
                              borderRadius: '4px',
                              color: '#c9d1d9',
                              padding: '4px 8px',
                              fontSize: '11px',
                              cursor: 'pointer'
                            }}
                          >
                            Collapse
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* UNSTAGED CHANGES SECTION */}
            <div className="git-section-header" onClick={() => setIsUnstagedCollapsed(!isUnstagedCollapsed)}>
              <div className="git-section-header-left">
                <ChevronIcon collapsed={isUnstagedCollapsed} />
                <span>Changes</span>
                <span className="git-section-count">{unstagedCount}</span>
              </div>
              {unstagedCount > 0 && (
                <div className="git-section-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="git-section-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDiscardAll();
                    }}
                    title="Discard all changes"
                  >
                    <MinusIcon />
                  </button>
                  <button
                    className="git-section-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStageAll();
                    }}
                    title="Stage all"
                  >
                    <PlusIcon />
                  </button>
                </div>
              )}
            </div>

            {!isUnstagedCollapsed && (
              <div className="git-file-list">
                {unstagedCount === 0 ? (
                  <div className="git-file-empty">No unstaged changes</div>
                ) : (
                  <>
                    {status.unstaged?.slice(0, unstagedLimit).map((file) => {
                      const isSelected = selectedFile?.path === file.path && !selectedFile.isStaged;
                      return (
                        <div
                          key={file.path}
                          className={`git-file-row ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSelectedFile({ path: file.path, isStaged: false })}
                        >
                          <div className="git-file-row-left">
                            <FileIcon filename={file.name} isDirectory={file.kind === 'directory'} />
                            <span className="git-file-name" title={file.path}>{file.name}</span>
                            {file.dir && <span className="git-file-dir">{file.dir}</span>}
                          </div>
                          <div className="git-file-row-right">
                            {getStatusBadge(file.status)}
                            <div className="git-file-row-actions">
                              <button
                                className="git-row-action-btn discard"
                                onClick={(e) => handleDiscardFile(e, file.path, file.status === '?')}
                                title="Discard changes"
                              >
                                <MinusIcon />
                              </button>
                              <button
                                className="git-row-action-btn stage"
                                onClick={(e) => handleStageFile(e, file.path)}
                                title="Stage changes"
                              >
                                <PlusIcon />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {(unstagedCount > unstagedLimit || unstagedLimit > MAX_DISPLAYED_CHANGES) && (
                      <div className="git-file-limit-message" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 12px', fontSize: '11px', color: '#8b949e', borderTop: '1px solid #21262d' }}>
                        <span>Showing first {Math.min(unstagedLimit, unstagedCount)} of {unstagedCount} changes.</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {unstagedCount > unstagedLimit && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnstagedLimit(prev => prev + MAX_DISPLAYED_CHANGES);
                              }}
                              className="git-show-more-btn"
                              style={{
                                background: '#21262d',
                                border: '1px solid #30363d',
                                borderRadius: '4px',
                                color: '#c9d1d9',
                                padding: '4px 8px',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              Show More
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setUnstagedLimit(MAX_DISPLAYED_CHANGES);
                            }}
                            className="git-show-less-btn"
                            style={{
                              background: '#21262d',
                              border: '1px solid #30363d',
                              borderRadius: '4px',
                              color: '#c9d1d9',
                              padding: '4px 8px',
                              fontSize: '11px',
                              cursor: 'pointer'
                            }}
                          >
                            Collapse
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Vertical Resize Handle */}
          <div className="git-vertical-resizer" onPointerDown={handleVerticalResizeStart} />

          {/* 3. Diff View */}
          {isDiffMaximized && maximizedPlaceholder}
          {diffElement}
        </div>
      ) : (
        /* HISTORY TAB CONTENT */
        (() => {
          const currentHistoryMatchNumber = activeHistoryMatchIndex >= 0 ? activeHistoryMatchIndex + 1 : 0;
          const historySearchToolbar = (
            <div className="git-history-search-toolbar">
              <div className="git-history-search-box">
                <SearchIcon />
                <input
                  type="search"
                  className="git-history-search-input"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  placeholder="Search commits, author, hash, branch..."
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      goToHistoryMatch(e.shiftKey ? 'previous' : 'next');
                    }
                  }}
                />
                <button
                  type="button"
                  className="git-history-search-clear"
                  onClick={() => setHistorySearchQuery('')}
                  disabled={!historySearchQuery}
                  title="Clear search"
                >
                  <CloseIcon />
                </button>
              </div>
              <button
                type="button"
                className={`git-history-find-option ${historySearchCaseSensitive ? 'active' : ''}`}
                onClick={() => setHistorySearchCaseSensitive((enabled) => !enabled)}
                title="Match case"
              >
                Aa
              </button>
              <span className="git-history-search-status">
                {historyFindQuery
                  ? `${currentHistoryMatchNumber} of ${historyMatchHashes.length}`
                  : historyLoading && history.length > 0
                    ? 'Loading...'
                    : ''}
              </span>
              <button
                type="button"
                className="git-history-find-nav"
                onClick={() => goToHistoryMatch('previous')}
                disabled={historyMatchHashes.length === 0}
                title="Previous match"
              >
                <ArrowUpIcon />
              </button>
              <button
                type="button"
                className="git-history-find-nav"
                onClick={() => goToHistoryMatch('next')}
                disabled={historyMatchHashes.length === 0}
                title="Next match"
              >
                <ArrowDownIcon />
              </button>
            </div>
          );

          if (historyLoading && history.length === 0) {
            return (
              <div className="git-tab-content history-tab">
                {historySearchToolbar}
                <div className="git-panel-loading">
                  <div className="git-spinner"></div>
                  <span>Loading commit history...</span>
                </div>
              </div>
            );
          }

          if (historyForGraph.length === 0) {
            return (
              <div className="git-tab-content history-tab">
                {historySearchToolbar}
                <div className="git-empty-state">
                  <p>No commits found in this repository.</p>
                </div>
              </div>
            );
          }

          const colWidth = 14;
          const paddingX = 24;
          const rowHeight = 36;
          const graphWidth = columnWidths.graph;

          return (
            <div className="git-tab-content history-tab">
              {historySearchToolbar}
              {/* 1. History Graph Table */}
              <div ref={historyContainerRef} className="git-history-container" style={{ height: fileListHeight, flex: 'none' }}>
                <div className="git-history-table-wrapper">
                  <table className="git-history-table">
                    <thead>
                      <tr>
                        <th className="col-graph" style={{ width: columnWidths.graph, minWidth: columnWidths.graph, maxWidth: columnWidths.graph }}>
                          <span className="th-text">Graph</span>
                          <div className="git-col-resizer" onPointerDown={(e) => handleColResizeStart(e, 'graph')} />
                        </th>
                        <th className="col-desc" style={{ width: columnWidths.desc, minWidth: columnWidths.desc, maxWidth: columnWidths.desc }}>
                          <span className="th-text">Description</span>
                          <div className="git-col-resizer" onPointerDown={(e) => handleColResizeStart(e, 'desc')} />
                        </th>
                        <th className="col-date" style={{ width: columnWidths.date, minWidth: columnWidths.date, maxWidth: columnWidths.date }}>
                          <span className="th-text">Date</span>
                          <div className="git-col-resizer" onPointerDown={(e) => handleColResizeStart(e, 'date')} />
                        </th>
                        <th className="col-author" style={{ width: columnWidths.author, minWidth: columnWidths.author, maxWidth: columnWidths.author }}>
                          <span className="th-text">Author</span>
                          <div className="git-col-resizer" onPointerDown={(e) => handleColResizeStart(e, 'author')} />
                        </th>
                        <th className="col-commit" style={{ width: columnWidths.commit, minWidth: columnWidths.commit, maxWidth: columnWidths.commit }}>
                          <span className="th-text">Commit</span>
                          <div className="git-col-resizer" onPointerDown={(e) => handleColResizeStart(e, 'commit')} />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {graphRows.map((row, i) => {
                        const { commit } = row;
                        const isUncommitted = commit.isUncommitted;
                        const shortHash = isUncommitted ? '*' : commit.hash.substring(0, 8);
                        const isSelected = selectedCommit?.hash === commit.hash;
                        const isHistoryMatch = historyMatchHashSet.has(commit.hash);
                        const isActiveHistoryMatch = activeHistoryMatchHash === commit.hash;
                        const rowZIndex = (30 - (i % 30)) * 2;
                        const detailsZIndex = rowZIndex - 1;

                        return (
                          <React.Fragment key={commit.hash + '-' + i}>
                            <tr
                              ref={(node) => {
                                if (node && !isUncommitted) {
                                  historyRowRefs.current.set(commit.hash, node);
                                } else {
                                  historyRowRefs.current.delete(commit.hash);
                                }
                              }}
                              className={`git-history-row ${isUncommitted ? 'uncommitted-row' : ''} ${isSelected ? 'selected' : ''} ${isHistoryMatch ? 'search-match' : ''} ${isActiveHistoryMatch ? 'active-search-match' : ''}`}
                              style={{ zIndex: rowZIndex, cursor: isUncommitted ? 'default' : 'pointer' }}
                              onClick={() => !isUncommitted && handleCommitRowClick(commit)}
                            >
                              <td className="col-graph" style={{ width: columnWidths.graph, minWidth: columnWidths.graph, maxWidth: columnWidths.graph, position: 'relative', zIndex: rowZIndex }}>
                                <GraphCell
                                  col={row.col}
                                  incomingTracks={row.incomingTracks}
                                  outgoingTracks={row.outgoingTracks}
                                  isBranchHead={row.isBranchHead}
                                  commit={commit}
                                  graphWidth={graphWidth}
                                  rowHeight={rowHeight}
                                  colWidth={colWidth}
                                  paddingX={paddingX}
                                  rowIdx={i}
                                  hashToIndexMap={hashToIndexMap}
                                  parentCols={row.parentCols}
                                  incomingColToOutgoingCol={row.incomingColToOutgoingCol}
                                  incomingColors={row.incomingColors}
                                  outgoingColors={row.outgoingColors}
                                />
                              </td>
                              <td className="col-desc" style={{ width: columnWidths.desc, minWidth: columnWidths.desc, maxWidth: columnWidths.desc, overflow: 'hidden' }} title={commit.subject}>
                                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, width: '100%', overflow: 'hidden' }}>
                                  {renderRefBadges(commit.decorations)}
                                  <span className="git-commit-subject">{renderHistorySearchHighlight(commit.subject)}</span>
                                </div>
                              </td>
                              <td className="col-date" style={{ width: columnWidths.date, minWidth: columnWidths.date, maxWidth: columnWidths.date }}>
                                <span className="git-history-date-time">{renderHistorySearchHighlight(commit.date)}</span>
                              </td>
                              <td className="col-author" style={{ width: columnWidths.author, minWidth: columnWidths.author, maxWidth: columnWidths.author }} title={commit.author}>
                                <span className="git-history-author-name">{renderHistorySearchHighlight(commit.author)}</span>
                              </td>
                              <td className="col-commit" style={{ width: columnWidths.commit, minWidth: columnWidths.commit, maxWidth: columnWidths.commit }}>
                                {isUncommitted ? (
                                  <span style={{ color: '#8b949e', fontWeight: 600 }}>*</span>
                                ) : (
                                  <span className="git-history-hash-label">{renderHistorySearchHighlight(shortHash)}</span>
                                )}
                              </td>
                            </tr>
                            {isSelected && (
                              <tr className="git-history-details-row" style={{ zIndex: detailsZIndex }}>
                                <td className="col-graph" style={{ width: columnWidths.graph, minWidth: columnWidths.graph, maxWidth: columnWidths.graph, position: 'relative', zIndex: detailsZIndex, background: '#0d1117', padding: 0 }}>
                                  <svg width={graphWidth} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, display: 'block', overflow: 'visible', height: '100%' }}>
                                    {row.outgoingTracks.map((hash, idx) => {
                                      const x = idx * colWidth + paddingX;
                                      const isGrey = hash === 'unstaged' || hash === 'staged' || hash === 'uncommitted';
                                      const color = isGrey ? '#8b949e' : getColorForCol(row.outgoingColors[idx]);
                                      return (
                                        <line
                                          key={idx}
                                          x1={x}
                                          y1={0}
                                          x2={x}
                                          y2="100%"
                                          stroke={color}
                                          strokeWidth={isGrey ? 1.5 : 2}
                                        />
                                      );
                                    })}
                                  </svg>
                                </td>
                                <td colSpan={4} className="git-history-details-cell" style={{ padding: '8px 12px 12px 12px', background: '#0d1117', borderBottom: '1px solid #21262d' }}>
                                  <div className="git-commit-files-box" style={{ borderRadius: '6px', border: '1px solid #30363d', padding: '12px 16px', background: '#161b22', color: '#c9d1d9' }}>
                                    {commitFilesLoading ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8b949e' }}>
                                        <div className="git-spinner" style={{ width: '14px', height: '14px' }}></div>
                                        <span>Loading changed files...</span>
                                      </div>
                                    ) : commitFiles.length === 0 ? (
                                      <div style={{ color: '#8b949e' }}>No changed files found.</div>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                                        {Object.entries(groupedCommitFiles).map(([dir, files]) => (
                                          <div key={dir} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8b949e', fontWeight: 500 }}>
                                              <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                                                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75z"/>
                                              </svg>
                                              <span>{dir ? dir.split('/').join(' / ') : '.'}</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '16px' }}>
                                              {files.map((file) => {
                                                const isFileSelected = selectedCommitFile?.path === file.path;
                                                return (
                                                  <div
                                                    key={file.path}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleCommitFileClick(file.path);
                                                    }}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'space-between',
                                                      padding: '4px 8px',
                                                      borderRadius: '4px',
                                                      cursor: 'pointer',
                                                      background: isFileSelected ? '#1f6feb' : 'transparent',
                                                      color: isFileSelected ? '#ffffff' : '#c9d1d9',
                                                    }}
                                                    className="git-commit-file-item"
                                                  >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                      <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style={{ opacity: 0.8 }}>
                                                        <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l3.664 3.663c.33.329.513.774.513 1.238v8.836A1.75 1.75 0 0 1 14 16H3.75A1.75 1.75 0 0 1 2 14.25V1.75zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.25a.25.25 0 0 0 .25-.25V5.5h-3a.75.75 0 0 1-.75-.75V1.5H3.75z"/>
                                                      </svg>
                                                      <span>{file.name}</span>
                                                    </div>
                                                    <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                                                      ( <span style={{ color: isFileSelected ? '#ffffff' : '#56d364' }}>+{file.additions}</span> | <span style={{ color: isFileSelected ? '#ffffff' : '#ff7b72' }}>-{file.deletions}</span> )
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                        {(hiddenCommitFilesCount > 0 || commitFilesHasMore) && (
                                          <div style={{ color: '#8b949e', fontStyle: 'italic', paddingLeft: '18px', paddingTop: '4px' }}>
                                            {hiddenCommitFilesCount > 0
                                              ? `... and ${hiddenCommitFilesCount} more files not shown.`
                                              : '... more files not shown.'}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {hasMoreHistory && (
                        <tr ref={loaderRef} className="git-history-load-more-row" style={{ background: 'transparent' }}>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '12px 10px', borderBottom: 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#8b949e', fontSize: '13px' }}>
                              {historyLoading ? (
                                <>
                                  <div className="git-spinner" style={{ width: '14px', height: '14px' }}></div>
                                  <span>Loading more commits...</span>
                                </>
                              ) : (
                                <span style={{ opacity: 0.3 }}>Scroll to load more</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 2. Vertical Resize Handle */}
              <div className="git-vertical-resizer" onPointerDown={handleVerticalResizeStart} />

              {/* 3. Diff View */}
              {isDiffMaximized && maximizedPlaceholder}
              {diffElement}
            </div>
          );
        })()
      )}
    </aside>
  );
};

// Graph and Badge Helper Functions
