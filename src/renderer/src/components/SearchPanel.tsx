import { useEffect, useState } from 'react';
import type { FileSearchResultEntry, FileSearchResultMatch } from '../../../shared/ipcTypes';
import { ChevronDownIcon, CloseIcon, FileTreeIcon, SearchIcon } from './AppIcons';

type SearchPanelProps = {
  rootPath: string;
  onClose: () => void;
  onOpenFile: (path: string, lineNumber?: number) => void;
  activeFilePath?: string;
};

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

export function SearchPanel({
  rootPath,
  onClose,
  onOpenFile,
  activeFilePath
}: SearchPanelProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);

  const [results, setResults] = useState<FileSearchResultEntry[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Auto-search as the user types with a 150ms debounce
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setTotalResults(0);
      setTotalFiles(0);
      setError(undefined);
      return;
    }

    setLoading(true);
    setError(undefined);

    const timer = window.setTimeout(() => {
      window.terminalApi
        .searchFiles({
          rootPath,
          query: trimmed,
          caseSensitive,
          wholeWord,
          useRegex
        })
        .then((result) => {
          if (result.error) {
            setError(result.error);
            setResults([]);
            setTotalResults(0);
            setTotalFiles(0);
          } else {
            setResults(result.results);
            setTotalResults(result.totalResults);
            setTotalFiles(result.totalFiles);

            const initialExpanded: Record<string, boolean> = {};
            result.results.forEach((entry) => {
              initialExpanded[entry.filePath] = true;
            });
            setExpandedFiles(initialExpanded);
          }
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setResults([]);
          setTotalResults(0);
          setTotalFiles(0);
        })
        .finally(() => {
          setLoading(false);
        });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [query, rootPath, caseSensitive, wholeWord, useRegex]);

  const toggleFileExpanded = (filePath: string) => {
    setExpandedFiles((current) => ({
      ...current,
      [filePath]: !current[filePath]
    }));
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setTotalResults(0);
    setTotalFiles(0);
    setError(undefined);
  };

  return (
    <div className="search-panel">
      <div className="search-input-form">
        <div className="search-input-container">
          <div className="search-input-icon">
            <SearchIcon />
          </div>
          <input
            type="text"
            className="search-text-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files content..."
            spellCheck={false}
          />
          <div className="search-options-group">
            <button
              type="button"
              className={`search-option-button ${caseSensitive ? 'is-active' : ''}`}
              onClick={() => setCaseSensitive((prev) => !prev)}
              title="Match Case (Aa)"
              aria-label="Match Case"
            >
              Aa
            </button>
            <button
              type="button"
              className={`search-option-button ${wholeWord ? 'is-active' : ''}`}
              onClick={() => setWholeWord((prev) => !prev)}
              title="Match Whole Word (ab)"
              aria-label="Match Whole Word"
            >
              ab
            </button>
            <button
              type="button"
              className={`search-option-button ${useRegex ? 'is-active' : ''}`}
              onClick={() => setUseRegex((prev) => !prev)}
              title="Use Regular Expression (.*)"
              aria-label="Use Regular Expression"
            >
              .*
            </button>
          </div>
          {query && (
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
        {loading && <div className="search-status-message">Searching...</div>}
        {error && <div className="search-status-message is-error">{error}</div>}
        {!loading && !error && query && results.length === 0 && (
          <div className="search-status-message">No results found.</div>
        )}
        {!loading && !error && results.length > 0 && (
          <>
            <div className="search-results-summary">
              {totalResults} result{totalResults === 1 ? '' : 's'} in {totalFiles} file{totalFiles === 1 ? '' : 's'}
            </div>
            <div className="search-results-list">
              {results.map((entry) => {
                const expanded = expandedFiles[entry.filePath] !== false;
                
                const matchesByLine: Record<number, FileSearchResultMatch[]> = {};
                entry.matches.forEach((m) => {
                  if (!matchesByLine[m.lineNumber]) {
                    matchesByLine[m.lineNumber] = [];
                  }
                  matchesByLine[m.lineNumber].push(m);
                });

                return (
                  <div key={entry.filePath} className="search-file-entry">
                    <button
                      type="button"
                      className="search-file-header"
                      onClick={() => toggleFileExpanded(entry.filePath)}
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
                        {Object.keys(matchesByLine)
                          .map(Number)
                          .sort((a, b) => a - b)
                          .map((lineNum) => {
                            const matches = matchesByLine[lineNum];
                            const firstMatch = matches[0];
                            return (
                              <button
                                key={lineNum}
                                className={`search-match-line ${activeFilePath === entry.filePath ? 'is-in-active-file' : ''}`}
                                type="button"
                                onClick={() => onOpenFile(entry.filePath, lineNum)}
                              >
                                <span className="search-match-line-number">{lineNum}</span>
                                <HighlightedLine content={firstMatch.lineContent} matchesInLine={matches} />
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
