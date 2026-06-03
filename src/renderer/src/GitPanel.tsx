import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prism-themes/themes/prism-vsc-dark-plus.css';
import { FileIcon } from './FileIcon';

const MAX_RENDERED_DIFF_LINES = 5000;

interface GitFile {
  path: string;
  status: string;
  dir: string;
  name: string;
  kind?: 'file' | 'directory';
}

interface GitStatus {
  isRepo: boolean;
  branch?: string;
  repoName?: string;
  staged?: GitFile[];
  unstaged?: GitFile[];
  error?: string;
}

interface CommitHistoryItem {
  hash: string;
  parents: string[];
  decorations: string;
  subject: string;
  author: string;
  date: string;
  timestamp: number;
  isUncommitted?: boolean;
  isHEAD?: boolean;
}

interface GitWorktree {
  path: string;
  name: string;
  commit: string;
  branch: string;
  isCurrent: boolean;
}

interface GitPanelProps {
  cwd: string;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  activePaneId?: string;
  terminalId?: string;
  refreshTrigger?: number;
}

function renderPrismTokens(tokens: string | Prism.Token | (string | Prism.Token)[]): React.ReactNode {
  if (typeof tokens === 'string') {
    return tokens;
  }
  if (Array.isArray(tokens)) {
    return tokens.map((t, idx) => <React.Fragment key={idx}>{renderPrismTokens(t)}</React.Fragment>);
  }

  const tokenType = tokens.type;
  const content = tokens.content;

  let extraClass = '';
  if (tokenType === 'keyword' && typeof content === 'string') {
    const controlFlowKeywords = [
      'export', 'import', 'from', 'return', 'if', 'else', 'for', 'while',
      'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
      'finally', 'as', 'in', 'of', 'throw'
    ];
    if (controlFlowKeywords.includes(content)) {
      extraClass = ' control-flow';
    }
  }

  return (
    <span className={`token ${tokenType}${extraClass}`}>
      {renderPrismTokens(content)}
    </span>
  );
}

function highlightCodeLine(code: string, filePath: string): React.ReactNode {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  let grammar = Prism.languages.clike;

  if (['ts', 'tsx'].includes(ext)) {
    grammar = Prism.languages.tsx || Prism.languages.typescript || Prism.languages.javascript;
  } else if (['js', 'jsx'].includes(ext)) {
    grammar = Prism.languages.jsx || Prism.languages.javascript;
  } else if (ext === 'css') {
    grammar = Prism.languages.css;
  } else if (ext === 'json') {
    grammar = Prism.languages.json;
  } else if (['html', 'htm', 'xml'].includes(ext)) {
    grammar = Prism.languages.markup || Prism.languages.html;
  }

  if (!grammar) {
    return code;
  }

  try {
    const tokens = Prism.tokenize(code, grammar);
    return renderPrismTokens(tokens);
  } catch (err) {
    console.error('Error tokenizing line:', err);
    return code;
  }
}

interface DiffLineInfo {
  raw: string;
  className: string;
  prefix: string;
  content: string;
  oldLineNumber: number | string;
  newLineNumber: number | string;
}

interface HighlightedDiffLine {
  oldLineNumber: number | string;
  newLineNumber: number | string;
  prefix: string;
  className: string;
  isCodeLine: boolean;
  raw: string;
  dataLang: string;
  highlightedCode: React.ReactNode;
}

function parseDiffLines(lines: string[]): DiffLineInfo[] {
  let currentOldLine = 0;
  let currentNewLine = 0;
  let hasParsedHunk = false;

  return lines.map(line => {
    let className = 'diff-line-normal';
    let prefix = '';
    let content = line;
    let oldLineNumber: number | string = '';
    let newLineNumber: number | string = '';

    if (line.startsWith('+') && !line.startsWith('+++')) {
      className = 'diff-line-addition';
      prefix = '+';
      content = line.slice(1);
      if (hasParsedHunk) {
        newLineNumber = currentNewLine;
        currentNewLine++;
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      className = 'diff-line-deletion';
      prefix = '-';
      content = line.slice(1);
      if (hasParsedHunk) {
        oldLineNumber = currentOldLine;
        currentOldLine++;
      }
    } else if (line.startsWith('@@')) {
      className = 'diff-line-hunk';
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        currentOldLine = parseInt(match[1], 10);
        currentNewLine = parseInt(match[2], 10);
        hasParsedHunk = true;
      }
    } else if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
      className = 'diff-line-meta';
    } else if (line.startsWith(' ')) {
      prefix = ' ';
      content = line.slice(1);
      if (hasParsedHunk) {
        oldLineNumber = currentOldLine;
        newLineNumber = currentNewLine;
        currentOldLine++;
        currentNewLine++;
      }
    } else {
      prefix = '';
      content = line;
      if (hasParsedHunk && line.length === 0) {
        oldLineNumber = currentOldLine;
        newLineNumber = currentNewLine;
        currentOldLine++;
        currentNewLine++;
      }
    }

    return {
      raw: line,
      className,
      prefix,
      content,
      oldLineNumber,
      newLineNumber
    };
  });
}

export const GitPanel: React.FC<GitPanelProps> = ({ cwd, onClose, width, onResize, activePaneId, terminalId, refreshTrigger = 0 }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes');
  const [selectedFile, setSelectedFile] = useState<{ path: string; isStaged: boolean } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitLoading, setCommitLoading] = useState(false);
  const [history, setHistory] = useState<CommitHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isStagedCollapsed, setIsStagedCollapsed] = useState(true);
  const [isUnstagedCollapsed, setIsUnstagedCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selectedFileRef = useRef<{ path: string; isStaged: boolean } | null>(null);
  const statusInFlightRef = useRef(false);
  const pendingStatusRef = useRef(false);
  const statusPromiseRef = useRef<Promise<void> | null>(null);
  const diffRequestIdRef = useRef(0);

  const { historyWithUncommitted, graphRows, maxTracks, hashToIndexMap } = useMemo(() => {
    const stagedCount = status?.staged?.length || 0;
    const unstagedCount = status?.unstaged?.length || 0;

    let historyWithUncommitted = [...history];
    const uncommittedItems: CommitHistoryItem[] = [];
    const actualHeadCommit = history.find((item) => item.isHEAD);
    const headHash = actualHeadCommit ? actualHeadCommit.hash : (history[0]?.hash || 'HEAD');

    const baseTime = Date.now() / 1000;

    if (unstagedCount > 0) {
      uncommittedItems.push({
        hash: 'unstaged',
        parents: [stagedCount > 0 ? 'staged' : headHash],
        decorations: '',
        subject: `untracked files on ${status?.branch || 'main'}`,
        author: '*',
        date: 'Now',
        timestamp: baseTime + 2,
        isUncommitted: true
      });
    }

    if (stagedCount > 0) {
      uncommittedItems.push({
        hash: 'staged',
        parents: [headHash],
        decorations: '',
        subject: `Index on ${status?.branch || 'main'}`,
        author: '*',
        date: 'Now',
        timestamp: baseTime + 1,
        isUncommitted: true
      });
    }

    if (uncommittedItems.length > 0) {
      historyWithUncommitted = [...uncommittedItems, ...history];
    }

    const graphRows = computeGraphData(historyWithUncommitted);
    let maxTracks = 1;
    graphRows.forEach(row => {
      maxTracks = Math.max(maxTracks, row.incomingTracks.length, row.outgoingTracks.length);
    });

    const hashToIndexMap = new Map<string, { index: number; isHEAD: boolean }>();
    historyWithUncommitted.forEach((item, index) => {
      hashToIndexMap.set(item.hash, { index, isHEAD: !!item.isHEAD });
    });

    return {
      historyWithUncommitted,
      graphRows,
      maxTracks,
      hashToIndexMap
    };
  }, [history, status?.staged, status?.unstaged, status?.branch]);

  const { parsedLines, hiddenDiffLineCount } = useMemo(() => {
    if (!diff) return { parsedLines: [], hiddenDiffLineCount: 0 };
    const lines = diff.split('\n');
    const visibleLines = lines.slice(0, MAX_RENDERED_DIFF_LINES);
    const hiddenCount = Math.max(0, lines.length - MAX_RENDERED_DIFF_LINES);
    const parsed = parseDiffLines(visibleLines);

    const ext = selectedFile?.path?.split('.').pop()?.toLowerCase() || '';
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

    const highlighted = parsed.map((lineInfo) => {
      const { className, prefix, content, oldLineNumber, newLineNumber, raw } = lineInfo;
      const isCodeLine = className === 'diff-line-addition' || className === 'diff-line-deletion' || className === 'diff-line-normal';

      let highlightedCode: React.ReactNode = null;
      if (isCodeLine) {
        highlightedCode = highlightCodeLine(content, selectedFile?.path || '');
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

    return {
      parsedLines: highlighted,
      hiddenDiffLineCount: hiddenCount
    };
  }, [diff, selectedFile?.path]);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

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
    commit: 90
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
          setStatus(gitStatus);

          const currentSelection = selectedFileRef.current;
          if (currentSelection) {
            const fileExists =
              (gitStatus.staged?.some(f => f.path === currentSelection.path) || false) ||
              (gitStatus.unstaged?.some(f => f.path === currentSelection.path) || false);
            if (!fileExists) {
              selectedFileRef.current = null;
              setSelectedFile(null);
              setDiff(null);
            }
          }
        } while (pendingStatusRef.current);
      } catch (err) {
        console.error('Failed to load git status:', err);
      } finally {
        statusInFlightRef.current = false;
        statusPromiseRef.current = null;
        if (showLoading) setIsRefreshing(false);
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
    setDiffError(null);
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

  // Load History
  const loadHistory = useCallback(async () => {
    if (!cwd) return;
    setHistoryLoading(true);
    try {
      const logText = await window.terminalApi.gitHistory({ cwd });
      const items: CommitHistoryItem[] = logText
        .split('\n')
        .filter(Boolean)
        .map(line => {
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
      items.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(items);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [cwd]);

  // Handle Watcher / Initial Load (only when tab is open and app is focused)
  useEffect(() => {
    if (!cwd) return;

    let unsubscribe: (() => void) | null = null;
    let isWatched = false;

    const startWatching = (sync = true) => {
      if (isWatched) return;
      isWatched = true;

      if (sync) {
        loadStatus(false);
        if (activeTab === 'history') {
          loadHistory();
        }
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
    if (activeTab === 'history') {
      loadHistory();
    }

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
  }, [cwd, activeTab, loadStatus, loadHistory]);

  // Load diff when selection changes
  useEffect(() => {
    if (selectedFile) {
      loadDiff(selectedFile);
    }
  }, [selectedFile, loadDiff]);

  // Trigger refresh from prop
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadStatus(true);
      if (activeTab === 'history') {
        loadHistory();
      }
    }
  }, [refreshTrigger, loadStatus, loadHistory, activeTab]);

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
        loadHistory();
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

  const renderDiffLine = (line: HighlightedDiffLine, index: number) => {
    const { className, prefix, oldLineNumber, newLineNumber, isCodeLine, dataLang, highlightedCode } = line;

    return (
      <div key={index} className={`git-diff-line ${className}`} data-lang={dataLang}>
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

  // Helper icons
  const BranchIcon = () => (
    <svg className="git-svg-icon" viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3.53 1.83 3.75 3.75 0 0 1-3.03 3.63v1.79a2.25 2.25 0 1 1-1.5 0V8.21c-.08-.01-.15-.02-.23-.04A3.75 3.75 0 0 1 5.28 4.75a2.25 2.25 0 1 1 1.5 0A2.25 2.25 0 0 0 9 6.75a2.25 2.25 0 0 0 1.25-.38V3.25zm-6 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM5 12.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/>
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

  return (
    <aside className="git-panel" style={{ width }}>
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
                loadHistory();
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
          onClick={() => setActiveTab('changes')}
        >
          Changes
          {totalChanges > 0 && <span className="git-tab-count">{totalChanges}</span>}
        </button>
        <button
          className={`git-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
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
                  status.staged?.map((file) => {
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
                  })
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
                  status.unstaged?.map((file) => {
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
                  })
                )}
              </div>
            )}
          </div>

          {/* Vertical Resize Handle */}
          <div className="git-vertical-resizer" onPointerDown={handleVerticalResizeStart} />

          {/* 3. Diff View */}
          <div className="git-diff-container" style={{ flex: 1 }}>
            {selectedFile ? (
              <>
                <div className="git-diff-header">
                  <span className="git-diff-filename">{selectedFile.path}</span>
                  <span className="git-diff-status">
                    {selectedFile.isStaged ? 'staged' : 'working tree'}
                  </span>
                </div>
                <div className="git-diff-body">
                  {diffError ? (
                    <div className="git-diff-error">{diffError}</div>
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
              </>
            ) : (
              <div className="git-diff-placeholder">
                Select a file to view differences
              </div>
            )}
          </div>
        </div>
      ) : (
        /* HISTORY TAB CONTENT */
        (() => {
          if (historyLoading) {
            return (
              <div className="git-tab-content history-tab">
                <div className="git-panel-loading">
                  <div className="git-spinner"></div>
                  <span>Loading commit history...</span>
                </div>
              </div>
            );
          }

          if (historyWithUncommitted.length === 0) {
            return (
              <div className="git-tab-content history-tab">
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
              <div className="git-history-container">
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

                        return (
                          <tr
                            key={commit.hash + '-' + i}
                            className={`git-history-row ${isUncommitted ? 'uncommitted-row' : ''}`}
                            style={{ zIndex: 1000 - i }}
                          >
                            <td className="col-graph" style={{ width: columnWidths.graph, minWidth: columnWidths.graph, maxWidth: columnWidths.graph }}>
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
                              />
                            </td>
                            <td className="col-desc" style={{ width: columnWidths.desc, minWidth: columnWidths.desc, maxWidth: columnWidths.desc }} title={commit.subject}>
                              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                                {renderRefBadges(commit.decorations)}
                                <span className="git-commit-subject">{commit.subject}</span>
                              </div>
                            </td>
                            <td className="col-date" style={{ width: columnWidths.date, minWidth: columnWidths.date, maxWidth: columnWidths.date }}>
                              <span className="git-history-date-time">{commit.date}</span>
                            </td>
                            <td className="col-author" style={{ width: columnWidths.author, minWidth: columnWidths.author, maxWidth: columnWidths.author }} title={commit.author}>
                              <span className="git-history-author-name">{commit.author}</span>
                            </td>
                            <td className="col-commit" style={{ width: columnWidths.commit, minWidth: columnWidths.commit, maxWidth: columnWidths.commit }}>
                              {isUncommitted ? (
                                <span style={{ color: '#8b949e', fontWeight: 600 }}>*</span>
                              ) : (
                                <span className="git-history-hash-label">{shortHash}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()
      )}
    </aside>
  );
};

// Graph and Badge Helper Functions
const TRACK_COLORS = [
  '#ec4899', // Pink
  '#10b981', // Green
  '#f59e0b', // Orange
  '#8b5cf6', // Purple
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#3b82f6'  // Blue
];

const hashColors = new Map<string, string>();
let colorCounter = 0;

function getColorForHash(hash: string): string {
  if (!hash || hash === 'uncommitted' || hash === 'unstaged' || hash === 'staged') return '#8b949e';
  if (!hashColors.has(hash)) {
    const color = TRACK_COLORS[colorCounter % TRACK_COLORS.length];
    hashColors.set(hash, color);
    colorCounter++;
  }
  return hashColors.get(hash)!;
}

function getColorForCol(colIndex: number): string {
  return TRACK_COLORS[colIndex % TRACK_COLORS.length];
}

interface RefDecoration {
  name: string;
  type: 'head' | 'remote' | 'tag' | 'stash' | 'other';
}

interface MergedRefDecoration {
  name: string;
  type: 'head' | 'remote' | 'tag' | 'stash' | 'other';
  isHEAD: boolean;
  remoteNames?: string[];
}

function parseDecorations(decorationStr: string): RefDecoration[] {
  if (!decorationStr) return [];
  let clean = decorationStr.trim();
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = clean.slice(1, -1);
  }

  const parts = clean.split(', ');
  const decorations: RefDecoration[] = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    let name = part;
    let type: RefDecoration['type'] = 'head';

    if (name.includes('HEAD -> ')) {
      name = name.replace('HEAD -> ', '');
      type = 'head';
    } else if (name.startsWith('tag: ')) {
      name = name.replace('tag: ', '');
      type = 'tag';
    } else if (name.startsWith('origin/')) {
      type = 'remote';
    } else if (name.startsWith('refs/stash') || name.includes('stash')) {
      type = 'stash';
      name = 'stash';
    } else {
      type = 'other';
    }

    decorations.push({ name, type });
  }

  return decorations;
}

function getMergedDecorations(decorationStr: string): MergedRefDecoration[] {
  if (!decorationStr) return [];
  let clean = decorationStr.trim();
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = clean.slice(1, -1);
  }

  const parts = clean.split(', ');
  const items: {
    raw: string;
    type: 'head-pointer' | 'local-branch' | 'remote-branch' | 'tag' | 'stash' | 'other';
    name: string;
    isHEAD: boolean;
    remoteName?: string;
    branchName?: string;
  }[] = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    if (part.startsWith('HEAD -> ')) {
      const name = part.replace('HEAD -> ', '');
      items.push({
        raw: part,
        type: 'local-branch',
        name,
        isHEAD: true
      });
    } else if (part === 'HEAD') {
      items.push({
        raw: part,
        type: 'head-pointer',
        name: 'HEAD',
        isHEAD: true
      });
    } else if (part.startsWith('tag: ')) {
      items.push({
        raw: part,
        type: 'tag',
        name: part.replace('tag: ', ''),
        isHEAD: false
      });
    } else if (part === 'refs/stash' || part.includes('stash')) {
      items.push({
        raw: part,
        type: 'stash',
        name: 'stash',
        isHEAD: false
      });
    } else {
      const match = part.match(/^([^/]+)\/(.+)$/);
      const knownRemotes = ['origin', 'upstream', 'github', 'gitlab', 'heroku'];
      if (match && (knownRemotes.includes(match[1]) || part.startsWith('origin/') || part.startsWith('upstream/'))) {
        items.push({
          raw: part,
          type: 'remote-branch',
          name: part,
          isHEAD: false,
          remoteName: match[1],
          branchName: match[2]
        });
      } else {
        items.push({
          raw: part,
          type: 'local-branch',
          name: part,
          isHEAD: false
        });
      }
    }
  }

  const merged: MergedRefDecoration[] = [];
  const processedRemoteRaws = new Set<string>();

  const localBranches = items.filter(item => item.type === 'local-branch');
  for (const local of localBranches) {
    const matchingRemotes = items.filter(
      item => item.type === 'remote-branch' && item.branchName === local.name
    );

    const remoteNames: string[] = [];
    for (const rem of matchingRemotes) {
      if (rem.remoteName) {
        remoteNames.push(rem.remoteName);
        processedRemoteRaws.add(rem.raw);
      }
    }

    merged.push({
      name: local.name,
      type: local.isHEAD ? 'head' : 'other',
      isHEAD: local.isHEAD,
      remoteNames: remoteNames.length > 0 ? remoteNames : undefined
    });
  }

  const headPointers = items.filter(item => item.type === 'head-pointer');
  for (const hp of headPointers) {
    merged.push({
      name: hp.name,
      type: 'head',
      isHEAD: true
    });
  }

  const remoteBranches = items.filter(
    item => item.type === 'remote-branch' && !processedRemoteRaws.has(item.raw)
  );
  for (const rem of remoteBranches) {
    merged.push({
      name: rem.name,
      type: 'remote',
      isHEAD: false
    });
  }

  const tags = items.filter(item => item.type === 'tag');
  for (const tag of tags) {
    merged.push({
      name: tag.name,
      type: 'tag',
      isHEAD: false
    });
  }

  const stashes = items.filter(item => item.type === 'stash');
  for (const stash of stashes) {
    merged.push({
      name: stash.name,
      type: 'stash',
      isHEAD: false
    });
  }

  return merged;
}

const renderRefBadges = (decorationStr: string) => {
  const decs = getMergedDecorations(decorationStr);
  if (decs.length === 0) return null;

  return (
    <div style={{ display: 'inline-flex', gap: '4px', marginRight: '6px', flexWrap: 'nowrap', flexShrink: 0 }}>
      {decs.map((dec) => {
        let badgeClass = 'git-badge-other';
        const nameLower = dec.name.toLowerCase();
        let icon = null;

        if (dec.type === 'head') {
          if (dec.isHEAD) {
            badgeClass = 'git-badge-head-active';
          } else {
            if (nameLower.includes('fix') || nameLower.includes('bug')) {
              badgeClass = 'git-badge-head-fix';
            } else if (nameLower.includes('feat') || nameLower.includes('improve')) {
              badgeClass = 'git-badge-head-feat';
            } else {
              badgeClass = 'git-badge-head-other';
            }
          }
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          );
        } else if (dec.type === 'remote') {
          if (nameLower.includes('main') || nameLower.includes('master') || nameLower.includes('head')) {
            badgeClass = 'git-badge-remote-main';
          } else if (nameLower.includes('develop') || nameLower.includes('dev')) {
            badgeClass = 'git-badge-remote-dev';
          } else {
            badgeClass = 'git-badge-remote-other';
          }
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          );
        } else if (dec.type === 'stash') {
          badgeClass = 'git-badge-stash';
        } else if (dec.type === 'tag') {
          badgeClass = 'git-badge-tag';
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
              <line x1="7" y1="7" x2="7.01" y2="7"></line>
            </svg>
          );
        } else {
          if (nameLower.includes('fix') || nameLower.includes('bug')) {
            badgeClass = 'git-badge-head-fix';
          } else if (nameLower.includes('feat') || nameLower.includes('improve')) {
            badgeClass = 'git-badge-head-feat';
          } else {
            badgeClass = 'git-badge-head-other';
          }
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          );
        }

        return (
          <span key={dec.name} className={`git-ref-badge ${badgeClass}`}>
            {icon}
            <span className="git-branch-name">{dec.name}</span>
            {dec.remoteNames && dec.remoteNames.length > 0 && (
              <>
                <span className="git-badge-divider" />
                <span className="git-badge-remote-names">
                  {dec.remoteNames.join(', ')}
                </span>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
};

function computeGraphData(commits: CommitHistoryItem[]) {
  const activeTracks: string[] = [];
  const rows: {
    commit: CommitHistoryItem;
    col: number;
    incomingTracks: string[];
    outgoingTracks: string[];
    isBranchHead: boolean;
  }[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const incomingTracks = [...activeTracks];

    let isBranchHead = false;
    let col = activeTracks.indexOf(commit.hash);
    if (col === -1) {
      activeTracks.push(commit.hash);
      col = activeTracks.length - 1;
      incomingTracks.push(commit.hash);
      isBranchHead = true;
    }

    const outgoingTracks = [...activeTracks];
    outgoingTracks.splice(col, 1);

    const parents = commit.parents || [];
    for (let pIdx = 0; pIdx < parents.length; pIdx++) {
      const parent = parents[pIdx];
      if (parent && !outgoingTracks.includes(parent)) {
        if (pIdx === 0) {
          outgoingTracks.splice(col, 0, parent);
        } else {
          outgoingTracks.push(parent);
        }
      }
    }

    rows.push({
      commit,
      col,
      incomingTracks,
      outgoingTracks: [...outgoingTracks],
      isBranchHead
    });

    activeTracks.length = 0;
    activeTracks.push(...outgoingTracks);
  }

  return rows;
}

interface GraphCellProps {
  col: number;
  incomingTracks: string[];
  outgoingTracks: string[];
  isBranchHead: boolean;
  commit: CommitHistoryItem;
  graphWidth: number;
  rowHeight: number;
  colWidth: number;
  paddingX: number;
  rowIdx: number;
  hashToIndexMap: Map<string, { index: number; isHEAD: boolean }>;
}

const GraphCell: React.FC<GraphCellProps> = ({
  col,
  incomingTracks,
  outgoingTracks,
  isBranchHead,
  commit,
  graphWidth,
  rowHeight,
  colWidth,
  paddingX,
  rowIdx,
  hashToIndexMap
}) => {
  const yMid = rowHeight / 2;
  const xDot = col * colWidth + paddingX;
  const dotColor = commit.isUncommitted ? '#8b949e' : getColorForCol(col);

  const paths: React.ReactNode[] = [];

  incomingTracks.forEach((hash, idx) => {
    const xStart = idx * colWidth + paddingX;
    
    // Determine if this incoming track is part of the uncommitted segments above the HEAD commit
    const lookup = hashToIndexMap.get(hash);
    const commitIdx = lookup ? lookup.index : -1;
    const isHEAD = lookup ? lookup.isHEAD : false;

    const color = (hash === 'unstaged' || hash === 'staged' || hash === 'uncommitted')
      ? '#8b949e'
      : (commitIdx !== -1 && isHEAD && rowIdx < commitIdx)
        ? '#8b949e'
        : getColorForCol(idx);

    if (idx === col) {
      if (!isBranchHead) {
        paths.push(
          <line
            key={`in-commit-${idx}`}
            x1={xStart}
            y1={0}
            x2={xStart}
            y2={yMid}
            stroke={color}
            strokeWidth={color === '#8b949e' ? 1.5 : 2}
            strokeLinecap="round"
          />
        );
      }
    } else {
      const outIdx = outgoingTracks.indexOf(hash);
      if (outIdx !== -1) {
        const xEnd = outIdx * colWidth + paddingX;
        paths.push(
          <path
            key={`in-pass-${idx}-${outIdx}`}
            d={`M ${xStart} 0 C ${xStart} ${yMid}, ${xEnd} ${yMid}, ${xEnd} ${rowHeight}`}
            stroke={color}
            fill="none"
            strokeWidth={color === '#8b949e' ? 1.5 : 2}
            strokeLinecap="round"
          />
        );
      }
    }
  });

  const parents = commit.parents || [];
  parents.forEach((parentHash) => {
    const outIdx = outgoingTracks.indexOf(parentHash);
    if (outIdx !== -1) {
      const xEnd = outIdx * colWidth + paddingX;
      
      // Determine parent connection line color: if the commit itself is uncommitted, the link to its parent is grey
      const color = commit.isUncommitted
        ? '#8b949e'
        : getColorForCol(col);

      paths.push(
        <path
          key={`out-parent-${outIdx}`}
          d={`M ${xDot} ${yMid} C ${xDot} ${yMid + 8}, ${xEnd} ${yMid + 8}, ${xEnd} ${rowHeight}`}
          stroke={color}
          fill="none"
          strokeWidth={color === '#8b949e' ? 1.5 : 2.2}
          strokeLinecap="round"
        />
      );
    }
  });

  return (
    <svg width={graphWidth} height={rowHeight} style={{ display: 'block', overflow: 'visible' }}>
      {paths}
      {commit.isUncommitted ? (
        <circle
          cx={xDot}
          cy={yMid}
          r={5}
          fill="#080a0d"
          stroke="#8b949e"
          strokeWidth={2.5}
        />
      ) : commit.isHEAD ? (
        <circle
          cx={xDot}
          cy={yMid}
          className="git-graph-node-head"
          stroke={dotColor}
          strokeWidth={3}
          r={5}
        />
      ) : (
        <circle
          cx={xDot}
          cy={yMid}
          r={4.5}
          fill={dotColor}
        />
      )}
    </svg>
  );
};
