import { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react';
import type { FileSearchResultEntry, FileSearchResultMatch } from '../../../shared/ipcTypes';
import { ChevronDownIcon, CloseIcon, FileTreeIcon, SearchIcon } from './AppIcons';

type SearchPanelProps = {
  rootPath: string;
  onClose: () => void;
  onOpenFile: (path: string, lineNumber?: number, columnNumber?: number) => void;
  onCommitSearchHighlight: (options: {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
  }) => void;
  activeFilePath?: string;
  activeLineNumber?: number;
};

const SEARCH_FILE_BATCH_SIZE = 30;
const SEARCH_MATCH_LINE_BATCH_SIZE = 80;

function HighlightedLine({
  content,
  matchesInLine
}: {
  content: string;
  matchesInLine: FileSearchResultMatch[];
}): JSX.Element {
  const sorted = [...matchesInLine].sort((a, b) => a.matchIndex - b.matchIndex);
  const elements: JSX.Element[] = [];
  let lastIndex = 0;

  sorted.forEach((match, idx) => {
    if (match.matchIndex > lastIndex) {
      elements.push(<span key={`text-${idx}`}>{content.slice(lastIndex, match.matchIndex)}</span>);
    }
    const matchText = content.slice(match.matchIndex, match.matchIndex + match.matchLength);
    elements.push(
      <mark key={`match-${idx}`} className="search-match-highlight">
        {matchText}
      </mark>
    );
    lastIndex = match.matchIndex + match.matchLength;
  });

  if (lastIndex < content.length) {
    elements.push(<span key="text-end">{content.slice(lastIndex)}</span>);
  }

  return <span className="search-line-content">{elements}</span>;
}

const SearchFileResult = memo(({
  entry,
  activeFilePath,
  activeLineNumber,
  expanded,
  onToggleExpanded,
  onOpenFile
}: {
  entry: FileSearchResultEntry;
  activeFilePath?: string;
  activeLineNumber?: number;
  expanded: boolean;
  onToggleExpanded: (path: string) => void;
  onOpenFile: (path: string, line?: number, column?: number) => void;
}) => {
  const [visibleLineCount, setVisibleLineCount] = useState(SEARCH_MATCH_LINE_BATCH_SIZE);
  const matchesByLine = useMemo(() => {
    const grouped: Record<number, FileSearchResultMatch[]> = {};
    entry.matches.forEach((match) => {
      if (!grouped[match.lineNumber]) {
        grouped[match.lineNumber] = [];
      }
      grouped[match.lineNumber].push(match);
    });

    return Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b)
      .map((lineNumber) => ({
        lineNumber,
        matches: grouped[lineNumber]
      }));
  }, [entry.matches]);

  useEffect(() => {
    setVisibleLineCount(SEARCH_MATCH_LINE_BATCH_SIZE);
  }, [entry.matches]);

  const visibleMatchesByLine = matchesByLine.slice(0, visibleLineCount);

  return (
    <div className="search-file-entry">
      <button
        type="button"
        className="search-file-header"
        onClick={() => onToggleExpanded(entry.filePath)}
      >
        <span className={`search-disclosure-icon ${expanded ? 'is-expanded' : ''}`}>
          <ChevronDownIcon />
        </span>
        <span className="search-file-icon">
          <FileTreeIcon type="file" />
        </span>
        <span className="search-file-name" title={entry.filePath}>
          {entry.relativeFilePath.split(/[\\/]/).pop()}
        </span>
        <span className="search-file-path" title={entry.filePath}>
          {entry.relativeFilePath.split(/[\\/]/).slice(0, -1).join('/') || '.'}
        </span>
        <span className="search-matches-badge">{entry.matches.length}</span>
      </button>

      {expanded && (
        <div className="search-file-matches">
          {visibleMatchesByLine.map(({ lineNumber, matches }) => {
            const firstMatch = matches[0];
            return (
              <button
                key={lineNumber}
                className={`search-match-line ${activeFilePath === entry.filePath && activeLineNumber === lineNumber ? 'is-in-active-file' : ''}`}
                type="button"
                onClick={() => onOpenFile(entry.filePath, lineNumber)}
              >
                <span className="search-match-line-number">{lineNumber}</span>
                <HighlightedLine content={firstMatch.lineContent} matchesInLine={matches} />
              </button>
            );
          })}

          {visibleLineCount < matchesByLine.length && (
            <button
              type="button"
              className="search-match-line"
              onClick={() => setVisibleLineCount((count) => count + SEARCH_MATCH_LINE_BATCH_SIZE)}
            >
              <span className="search-match-line-number">+</span>
              <span className="search-line-content">
                Show {Math.min(SEARCH_MATCH_LINE_BATCH_SIZE, matchesByLine.length - visibleLineCount)} more match lines
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

SearchFileResult.displayName = 'SearchFileResult';

const SearchResultsList = memo(({
  results,
  activeFilePath,
  activeLineNumber,
  expandedFiles,
  toggleFileExpanded,
  onOpenFile
}: {
  results: FileSearchResultEntry[];
  activeFilePath?: string;
  activeLineNumber?: number;
  expandedFiles: Record<string, boolean>;
  toggleFileExpanded: (path: string) => void;
  onOpenFile: (path: string, line?: number, column?: number) => void;
}) => {
  return (
    <div className="search-results-list">
      {results.map((entry) => (
        <SearchFileResult
          key={entry.filePath}
          entry={entry}
          activeFilePath={activeFilePath}
          activeLineNumber={activeLineNumber}
          expanded={expandedFiles[entry.filePath] !== false}
          onToggleExpanded={toggleFileExpanded}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
});

SearchResultsList.displayName = 'SearchResultsList';

export function SearchPanel({
  rootPath,
  onClose,
  onOpenFile,
  onCommitSearchHighlight,
  activeFilePath,
  activeLineNumber
}: SearchPanelProps): JSX.Element {

  const [localQuery, setLocalQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState<FileSearchResultEntry[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [visibleFileCount, setVisibleFileCount] = useState(SEARCH_FILE_BATCH_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const searchRequestSeqRef = useRef(0);

  // Auto-search as the user types with a 150ms debounce
  useEffect(() => {
    const requestSeq = ++searchRequestSeqRef.current;
    const trimmed = localQuery.trim();
    if (!trimmed) {
      setResults([]);
      setTotalResults(0);
      setTotalFiles(0);
      setVisibleFileCount(SEARCH_FILE_BATCH_SIZE);
      setError(undefined);
      setLoading(false);
      return;
    }

    setError(undefined);

    const timer = window.setTimeout(() => {
      setLoading(true);
      window.terminalApi
        .searchFiles({
          rootPath,
          query: trimmed,
          caseSensitive,
          wholeWord,
          useRegex
        })
        .then((result) => {
          if (requestSeq !== searchRequestSeqRef.current) {
            return;
          }

          if (result.error) {
            setError(result.error);
            setResults([]);
            setTotalResults(0);
            setTotalFiles(0);
            setVisibleFileCount(SEARCH_FILE_BATCH_SIZE);
          } else {
            setResults(result.results);
            setTotalResults(result.totalResults);
            setTotalFiles(result.totalFiles);
            setVisibleFileCount(SEARCH_FILE_BATCH_SIZE);
            setExpandedFiles({});
          }
        })
        .catch((err: unknown) => {
          if (requestSeq !== searchRequestSeqRef.current) {
            return;
          }

          setError(err instanceof Error ? err.message : String(err));
          setResults([]);
          setTotalResults(0);
          setTotalFiles(0);
          setVisibleFileCount(SEARCH_FILE_BATCH_SIZE);
        })
        .finally(() => {
          if (requestSeq === searchRequestSeqRef.current) {
            setLoading(false);
          }
        });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [localQuery, rootPath, caseSensitive, wholeWord, useRegex]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onCommitSearchHighlight({
        query: localQuery.trim(),
        caseSensitive,
        wholeWord,
        useRegex
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [caseSensitive, localQuery, onCommitSearchHighlight, useRegex, wholeWord]);

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles((current) => ({
      ...current,
      [filePath]: current[filePath] === false
    }));
  }, []);

  const handleOpenFile = useCallback((path: string, lineNumber?: number) => {
    const trimmed = localQuery.trim();
    if (trimmed) {
      onCommitSearchHighlight({
        query: trimmed,
        caseSensitive,
        wholeWord,
        useRegex
      });
    }
    onOpenFile(path, lineNumber);
  }, [caseSensitive, localQuery, onCommitSearchHighlight, onOpenFile, useRegex, wholeWord]);

  const handleClear = () => {
    setLocalQuery('');
    onCommitSearchHighlight({
      query: '',
      caseSensitive,
      wholeWord,
      useRegex
    });
    setResults([]);
    setTotalResults(0);
    setTotalFiles(0);
    setVisibleFileCount(SEARCH_FILE_BATCH_SIZE);
    setExpandedFiles({});
    setError(undefined);
  };

  const visibleResults = useMemo(
    () => results.slice(0, visibleFileCount),
    [results, visibleFileCount]
  );

  return (
    <div className="search-panel">
      <div className="explorer-viewlet-header">
        <span className="explorer-viewlet-title">Search</span>
      </div>
      <div className="search-input-form">
        <div className="search-input-container">
          <div className="search-input-icon">
            <SearchIcon />
          </div>
          <input
            type="text"
            className="search-text-input"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search files content..."
            spellCheck={false}
          />
          <div className="search-options-group">
            <button
              type="button"
              className={`search-option-button ${caseSensitive ? 'is-active' : ''}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Match Case (Aa)"
              aria-label="Match Case"
            >
              Aa
            </button>
            <button
              type="button"
              className={`search-option-button ${wholeWord ? 'is-active' : ''}`}
              onClick={() => setWholeWord(!wholeWord)}
              title="Match Whole Word (ab)"
              aria-label="Match Whole Word"
            >
              ab
            </button>
            <button
              type="button"
              className={`search-option-button ${useRegex ? 'is-active' : ''}`}
              onClick={() => setUseRegex(!useRegex)}
              title="Use Regular Expression (.*)"
              aria-label="Use Regular Expression"
            >
              .*
            </button>
          </div>
          {localQuery && (
            <button
              type="button"
              className="search-clear-button"
              onClick={handleClear}
              title="Clear Search"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      <div className="search-results-container">
        {loading && results.length === 0 && <div className="search-status-message">Searching...</div>}
        {error && <div className="search-status-message is-error">{error}</div>}
        {!loading && !error && localQuery && results.length === 0 && (
          <div className="search-status-message">No results found.</div>
        )}
        {!error && results.length > 0 && (
          <>
            <div className="search-results-summary" style={{ opacity: loading ? 0.6 : 1 }}>
              {totalResults} result{totalResults === 1 ? '' : 's'} in {totalFiles} file{totalFiles === 1 ? '' : 's'}
              {visibleResults.length < results.length && ` (showing ${visibleResults.length} files)`}
              {loading && ' (Searching...)'}
            </div>
            <SearchResultsList
              results={visibleResults}
              activeFilePath={activeFilePath}
              activeLineNumber={activeLineNumber}
              expandedFiles={expandedFiles}
              toggleFileExpanded={toggleFileExpanded}
              onOpenFile={handleOpenFile}
            />
            {visibleResults.length < results.length && (
              <button
                type="button"
                className="search-match-line"
                onClick={() => setVisibleFileCount((count) => count + SEARCH_FILE_BATCH_SIZE)}
              >
                <span className="search-match-line-number">+</span>
                <span className="search-line-content">
                  Show {Math.min(SEARCH_FILE_BATCH_SIZE, results.length - visibleResults.length)} more files
                </span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
