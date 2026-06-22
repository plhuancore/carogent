import { useState } from 'react';
import type { FormEvent as ReactFormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { QuickAccessItem } from '../storage';
import type { CommandPaletteItem, PaletteMode } from '../commandPalette';
import { CommandPaletteIcon, QuickAccessIcon, SearchIcon } from './AppIcons';

function formatBrowserUrlLabel(value?: string): string {
  const rawValue = value?.trim();

  if (!rawValue) {
    return '';
  }

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(rawValue) ? rawValue : `http://${rawValue}`);
    const path = `${url.pathname}${url.search}${url.hash}`;

    return path === '/' ? url.host : `${url.host}${path}`;
  } catch {
    return rawValue;
  }
}

function highlightTextMatches(text: string, query: string): React.ReactNode {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return text;
  }

  let cleanQuery = trimmedQuery;
  if (cleanQuery.startsWith('>')) {
    cleanQuery = cleanQuery.slice(1).trim();
  }

  // Remove line number suffix (e.g. :17)
  cleanQuery = cleanQuery.replace(/:\d+$/, '');

  // Remove symbol search suffix (e.g. @symbolName)
  cleanQuery = cleanQuery.replace(/@.*$/, '');

  // Split by whitespace, forward slashes, and backslashes
  const terms = cleanQuery.toLowerCase().split(/[\s/\\]+/).filter(Boolean);
  if (terms.length === 0) {
    return text;
  }

  const matchedIndices = new Array(text.length).fill(false);

  // For each term, find subsequence match in text case-insensitively
  terms.forEach((term) => {
    let textIndex = 0;
    const tempIndices: number[] = [];
    for (let q = 0; q < term.length; q++) {
      const char = term[q];
      const idx = text.toLowerCase().indexOf(char, textIndex);
      if (idx !== -1) {
        tempIndices.push(idx);
        textIndex = idx + 1;
      } else {
        break;
      }
    }
    // If the entire term was matched as a subsequence, mark it
    if (tempIndices.length === term.length) {
      tempIndices.forEach((idx) => {
        matchedIndices[idx] = true;
      });
    }
  });

  // Group consecutive matched/unmatched indices and render
  const elements: React.ReactNode[] = [];
  let currentGroupMatched = matchedIndices[0];
  let currentGroupStart = 0;

  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || matchedIndices[i] !== currentGroupMatched) {
      const chunk = text.slice(currentGroupStart, i);
      if (currentGroupMatched) {
        elements.push(
          <span key={currentGroupStart} className="quick-access-highlight">
            {chunk}
          </span>
        );
      } else {
        elements.push(<span key={currentGroupStart}>{chunk}</span>);
      }
      if (i < text.length) {
        currentGroupMatched = matchedIndices[i];
        currentGroupStart = i;
      }
    }
  }

  return <>{elements}</>;
}

type QuickAccessPaletteProps = {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  mode: PaletteMode;
  items: CommandPaletteItem[];
  selectedIndex: number;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onOpenItem: (item: CommandPaletteItem) => void;
  onClose: () => void;
  onOpenManager: () => void;
};

export function QuickAccessPalette({
  inputRef,
  query,
  mode,
  items,
  selectedIndex,
  onQueryChange,
  onSelectedIndexChange,
  onOpenItem,
  onClose,
  onOpenManager
}: QuickAccessPaletteProps): JSX.Element {
  const isCommandMode = mode === 'command';
  const hasQuery = query.trim().length > 0;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onSelectedIndexChange(items.length === 0 ? 0 : Math.min(items.length - 1, selectedIndex + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onSelectedIndexChange(Math.max(0, selectedIndex - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      const item = items[selectedIndex];

      if (item) {
        onOpenItem(item);
      } else {
        onOpenManager();
      }
    }
  };

  return (
    <div className="quick-access-overlay" onMouseDown={onClose}>
      <div className="quick-access-palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-access-search">
          <span className="quick-access-search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="quick-access-input"
            value={query}
            placeholder={
              mode === 'file'
                ? 'Search files by name (append : to go to line or @ to go to symbol)'
                : isCommandMode
                ? 'Search commands'
                : 'Search quick access'
            }
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="quick-access-results">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={`quick-access-result ${index === selectedIndex ? 'is-selected' : ''}`}
              type="button"
              onClick={() => onOpenItem(item)}
            >
              <span className="quick-access-result-icon" aria-hidden="true">
                <CommandPaletteIcon type={item.icon} />
              </span>
              <span className="quick-access-result-copy">
                <span className="quick-access-result-name">
                  {highlightTextMatches(item.title, query)}
                </span>
                <span className="quick-access-result-domain">
                  {highlightTextMatches(item.subtitle, query)}
                </span>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <div className="quick-access-empty">
              <div>
                <div className="quick-access-empty-title">
                  {isCommandMode
                    ? 'No matching commands'
                    : hasQuery
                    ? 'No matching quick access items'
                    : 'No quick access items'}
                </div>
                <div className="quick-access-empty-copy">
                  {isCommandMode
                    ? 'Try another command search.'
                    : 'Create entries to open your frequent domains faster.'}
                </div>
              </div>
              {!isCommandMode && (
                <button type="button" onClick={onOpenManager}>
                  Manage Quick Access
                </button>
              )}
            </div>
          )}
        </div>
        {mode !== 'file' && (
          <div className="quick-access-footer">
            <span><kbd>Enter</kbd> Open</span>
            <span><kbd>Esc</kbd> Close</span>
            <span><kbd>↑↓</kbd> Navigate</span>
            {!isCommandMode && <span><kbd>&gt;</kbd> Commands</span>}
          </div>
        )}
      </div>
    </div>
  );
}

type QuickAccessManagerProps = {
  items: QuickAccessItem[];
  onSave: (item: QuickAccessItem) => void;
  onDelete: (itemId: string) => void;
  onClose: () => void;
};

export function QuickAccessManager({ items, onSave, onDelete, onClose }: QuickAccessManagerProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDomain, setDraftDomain] = useState('');

  const resetDraft = (): void => {
    setEditingId(null);
    setDraftName('');
    setDraftDomain('');
  };

  const beginEdit = (item: QuickAccessItem): void => {
    setEditingId(item.id);
    setDraftName(item.name);
    setDraftDomain(item.domain);
  };

  const handleSubmit = (event: ReactFormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const name = draftName.trim();
    const domain = draftDomain.trim();

    if (!name || !domain) {
      return;
    }

    onSave({
      id: editingId || crypto.randomUUID(),
      name,
      domain
    });
    resetDraft();
  };

  return (
    <div className="quick-access-overlay" onMouseDown={onClose}>
      <section className="quick-access-manager" onMouseDown={(event) => event.stopPropagation()}>
        <header className="quick-access-manager-header">
          <div className="quick-access-manager-title">
            <span className="quick-access-manager-icon" aria-hidden="true">
              <QuickAccessIcon />
            </span>
            <div>
              <h2>Quick Access</h2>
              <p>{items.length} item{items.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <form className="quick-access-form" onSubmit={handleSubmit}>
          <input
            value={draftName}
            placeholder="Name"
            onChange={(event) => setDraftName(event.target.value)}
          />
          <input
            value={draftDomain}
            placeholder="localhost:3000"
            onChange={(event) => setDraftDomain(event.target.value)}
          />
          <button type="submit" disabled={!draftName.trim() || !draftDomain.trim()}>
            {editingId ? 'Save' : 'Add'}
          </button>
          {editingId && (
            <button type="button" onClick={resetDraft}>
              Cancel
            </button>
          )}
        </form>

        <div className="quick-access-manager-list">
          {items.map((item) => (
            <div className="quick-access-manager-item" key={item.id}>
              <div>
                <div className="quick-access-manager-name">{item.name}</div>
                <div className="quick-access-manager-domain">{formatBrowserUrlLabel(item.domain) || item.domain}</div>
              </div>
              <button type="button" onClick={() => beginEdit(item)}>
                Edit
              </button>
              <button type="button" onClick={() => onDelete(item.id)}>
                Delete
              </button>
            </div>
          ))}
          {items.length === 0 && <div className="quick-access-manager-empty">No quick access items yet.</div>}
        </div>
      </section>
    </div>
  );
}
