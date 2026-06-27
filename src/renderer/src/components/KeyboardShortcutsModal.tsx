import { useEffect, useState, useRef } from 'react';
import { SearchIcon, CloseIcon } from './AppIcons';

const isMacPlatform = typeof navigator !== 'undefined' &&
  (navigator.userAgent.includes('Macintosh') || navigator.platform.toUpperCase().indexOf('MAC') >= 0);

// Keyboard icon SVG
function KeyboardIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <line x1="6" y1="8" x2="6.01" y2="8" />
      <line x1="10" y1="8" x2="10.01" y2="8" />
      <line x1="14" y1="8" x2="14.01" y2="8" />
      <line x1="18" y1="8" x2="18.01" y2="8" />
      <line x1="6" y1="12" x2="6.01" y2="12" />
      <line x1="10" y1="12" x2="10.01" y2="12" />
      <line x1="14" y1="12" x2="14.01" y2="12" />
      <line x1="18" y1="12" x2="18.01" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  );
}

// Pencil/Edit icon SVG
function EditIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

// Reset/Undo icon SVG
function ResetIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export type CommandKeybindingInfo = {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  when: string;
};

export const COMMANDS_METADATA: CommandKeybindingInfo[] = [
  {
    id: 'fileSearch',
    name: 'Quick Access: Open File Search',
    description: 'Search for files in the active workspace and open them',
    defaultKey: 'Ctrl+P',
    when: 'Explorer open & active pane cwd'
  },
  {
    id: 'commandPalette',
    name: 'Command Palette: Open Command Palette',
    description: 'Search and execute editor/app commands',
    defaultKey: 'Ctrl+Shift+P',
    when: 'Global'
  },
  {
    id: 'toggleExplorer',
    name: 'Explorer: Toggle Folder Explorer',
    description: 'Show or hide the folder explorer panel',
    defaultKey: 'Ctrl+Shift+E',
    when: 'Global'
  },
  {
    id: 'toggleSearch',
    name: 'Search: Toggle Search Panel',
    description: 'Show or hide the global search and replace panel',
    defaultKey: 'Ctrl+Shift+F',
    when: 'Global'
  },
  {
    id: 'toggleGit',
    name: 'Git: Toggle Git Control',
    description: 'Show or hide the Git version control panel',
    defaultKey: 'Ctrl+Shift+G',
    when: 'Global'
  },
  {
    id: 'toggleWorkspace',
    name: 'Workspace: Toggle Workspace Island',
    description: 'Show or hide the workspace tab list',
    defaultKey: 'Ctrl+Shift+W',
    when: 'Global'
  },
  {
    id: 'terminalSearch',
    name: 'Terminal: Search in Active Pane',
    description: 'Find text inside the currently focused terminal pane',
    defaultKey: 'Ctrl+F',
    when: 'Terminal focused'
  },
  {
    id: 'newCommandPrompt',
    name: isMacPlatform ? 'Terminal: Create zsh Pane' : 'Terminal: Create Command Prompt Pane',
    description: isMacPlatform ? 'Split the active pane and open a new zsh shell' : 'Split the active pane and open a new Command Prompt (cmd) shell',
    defaultKey: 'Ctrl+Shift+1',
    when: 'Global'
  },
  {
    id: 'newPowerShell',
    name: isMacPlatform ? 'Terminal: Create bash Pane' : 'Terminal: Create PowerShell Pane',
    description: isMacPlatform ? 'Split the active pane and open a new bash shell' : 'Split the active pane and open a new Windows PowerShell shell',
    defaultKey: 'Ctrl+Shift+2',
    when: 'Global'
  }
];

type KeybindingRecorderProps = {
  commandName: string;
  initialKeys: string;
  onSave: (keys: string) => void;
  onCancel: () => void;
};

function KeybindingRecorder({ commandName, initialKeys, onSave, onCancel }: KeybindingRecorderProps): JSX.Element {
  const [recordedKeys, setRecordedKeys] = useState<string>(initialKeys);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      // Check if Enter is pressed without modifiers to submit the current keys
      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        if (recordedKeys) {
          onSave(recordedKeys);
        }
        return;
      }

      const isModifierOnly = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key);

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');

      if (!isModifierOnly) {
        let key = e.key;
        if (key === ' ') {
          key = 'Space';
        } else if (key.length === 1) {
          key = key.toUpperCase();
        } else {
          key = key.charAt(0).toUpperCase() + key.slice(1);
        }
        parts.push(key);
      }

      const combo = parts.join('+');
      if (combo) {
        setRecordedKeys(combo);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordedKeys, onSave, onCancel]);

  return (
    <div className="keyboard-shortcuts-recorder-overlay" onMouseDown={onCancel}>
      <div className="keyboard-shortcuts-recorder-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="keyboard-shortcuts-recorder-title">Customize Keybinding</div>
        <div className="keyboard-shortcuts-command-name" style={{ fontSize: '13px' }}>{commandName}</div>
        <div className="keyboard-shortcuts-recorder-display">
          {recordedKeys ? (
            <div className="keyboard-shortcuts-recorder-display-keys">
              {recordedKeys.split('+').map((key, idx) => (
                <span key={idx}>
                  {idx > 0 && <span className="keyboard-shortcuts-plus">+</span>}
                  <kbd className="keyboard-shortcuts-keycap" style={{ fontSize: '13px', padding: '4px 8px' }}>{key}</kbd>
                </span>
              ))}
            </div>
          ) : (
            <span className="keyboard-shortcuts-recorder-empty">Press desired key combination...</span>
          )}
        </div>
        <div className="keyboard-shortcuts-recorder-hint">
          Press modifiers (Ctrl, Alt, Shift, Cmd/Win) and key, then press <strong>Enter</strong> to save, or <strong>Escape</strong> to cancel.
        </div>
        <div className="keyboard-shortcuts-recorder-footer">
          <button type="button" className="keyboard-shortcuts-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="keyboard-shortcuts-btn-primary"
            disabled={!recordedKeys}
            onClick={() => onSave(recordedKeys)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

type KeyboardShortcutsModalProps = {
  onClose: () => void;
  keybindings: Record<string, string>;
  onSaveKeybindings: (newKeybindings: Record<string, string>) => void;
};

export function KeyboardShortcutsModal({ onClose, keybindings, onSaveKeybindings }: KeyboardShortcutsModalProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus search on open
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    const handleGlobalEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editingCommandId) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalEsc);
    return () => window.removeEventListener('keydown', handleGlobalEsc);
  }, [editingCommandId, onClose]);

  const handleEdit = (commandId: string) => {
    setEditingCommandId(commandId);
  };

  const handleSaveRecording = (newKeys: string) => {
    if (editingCommandId) {
      const updated = { ...keybindings, [editingCommandId]: newKeys };
      onSaveKeybindings(updated);
      setEditingCommandId(null);
    }
  };

  const handleResetRow = (commandId: string) => {
    const defaultMeta = COMMANDS_METADATA.find(c => c.id === commandId);
    if (defaultMeta) {
      const updated = { ...keybindings, [commandId]: defaultMeta.defaultKey };
      onSaveKeybindings(updated);
    }
  };

  const handleResetAll = () => {
    const defaults = COMMANDS_METADATA.reduce((acc, cmd) => {
      acc[cmd.id] = cmd.defaultKey;
      return acc;
    }, {} as Record<string, string>);
    onSaveKeybindings(defaults);
  };

  // Filter commands
  const filteredCommands = COMMANDS_METADATA.filter(cmd => {
    const currentKey = keybindings[cmd.id] || cmd.defaultKey;
    const isCustomized = currentKey !== cmd.defaultKey;
    const sourceText = isCustomized ? 'user' : 'default system';
    
    const term = searchQuery.toLowerCase();
    return (
      cmd.name.toLowerCase().includes(term) ||
      cmd.description.toLowerCase().includes(term) ||
      cmd.when.toLowerCase().includes(term) ||
      currentKey.toLowerCase().includes(term) ||
      sourceText.includes(term)
    );
  });

  const renderingEditingCommand = COMMANDS_METADATA.find(c => c.id === editingCommandId);

  return (
    <div className="keyboard-shortcuts-overlay" onMouseDown={onClose}>
      <div className="keyboard-shortcuts-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="keyboard-shortcuts-header">
          <div className="keyboard-shortcuts-title">
            <span className="keyboard-shortcuts-icon">
              <KeyboardIcon />
            </span>
            <div>
              <h2>Keyboard Shortcuts</h2>
              <p>Customize and manage keyboard triggers for common actions</p>
            </div>
          </div>
          <button type="button" className="keyboard-shortcuts-close-btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="keyboard-shortcuts-body">
          <div className="keyboard-shortcuts-search-container">
            <span className="keyboard-shortcuts-search-icon">
              <SearchIcon />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="keyboard-shortcuts-search-input"
              placeholder="Type to search in keybindings (e.g. explorer, Ctrl+P, user)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="keyboard-shortcuts-table-wrapper">
            {filteredCommands.length > 0 ? (
              <table className="keyboard-shortcuts-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Keybinding</th>
                    <th>When</th>
                    <th>Source</th>
                    <th style={{ width: '80px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommands.map((cmd) => {
                    const activeKey = keybindings[cmd.id] || cmd.defaultKey;
                    const isCustomized = activeKey !== cmd.defaultKey;

                    return (
                      <tr
                        key={cmd.id}
                        className="keyboard-shortcuts-row"
                        onDoubleClick={() => handleEdit(cmd.id)}
                      >
                        <td>
                          <div className="keyboard-shortcuts-command-name">{cmd.name}</div>
                          <div className="keyboard-shortcuts-command-desc">{cmd.description}</div>
                        </td>
                        <td className="keyboard-shortcuts-keys-cell">
                          {activeKey ? (
                            activeKey.split('+').map((key, idx) => (
                              <span key={idx}>
                                {idx > 0 && <span className="keyboard-shortcuts-plus">+</span>}
                                <kbd className="keyboard-shortcuts-keycap">{key}</kbd>
                              </span>
                            ))
                          ) : (
                            <span className="keyboard-shortcuts-none">None</span>
                          )}
                        </td>
                        <td>
                          <span className="keyboard-shortcuts-when">{cmd.when}</span>
                        </td>
                        <td>
                          <span className={`keyboard-shortcuts-source ${isCustomized ? 'user' : 'system'}`}>
                            {isCustomized ? 'User' : 'Default'}
                          </span>
                        </td>
                        <td>
                          <div className="keyboard-shortcuts-actions">
                            <button
                              type="button"
                              className="keyboard-shortcuts-action-btn"
                              title="Edit keybinding"
                              onClick={() => handleEdit(cmd.id)}
                            >
                              <EditIcon />
                            </button>
                            {isCustomized && (
                              <button
                                type="button"
                                className="keyboard-shortcuts-action-btn reset"
                                title="Reset to default"
                                onClick={() => handleResetRow(cmd.id)}
                              >
                                <ResetIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="keyboard-shortcuts-empty-state">
                <KeyboardIcon />
                <div>No matching keybindings found</div>
              </div>
            )}
          </div>
        </div>

        <footer className="keyboard-shortcuts-footer">
          <button
            type="button"
            className="keyboard-shortcuts-reset-all"
            onClick={handleResetAll}
          >
            Reset All to Default
          </button>
          <button type="button" className="keyboard-shortcuts-btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>

      {editingCommandId && renderingEditingCommand && (
        <KeybindingRecorder
          commandName={renderingEditingCommand.name}
          initialKeys={keybindings[renderingEditingCommand.id] || renderingEditingCommand.defaultKey}
          onSave={handleSaveRecording}
          onCancel={() => setEditingCommandId(null)}
        />
      )}
    </div>
  );
}

export function isEventMatchingKeybinding(event: KeyboardEvent, keybindingStr: string): boolean {
  if (!keybindingStr) return false;

  const parts = keybindingStr.split('+');
  const targetKey = parts[parts.length - 1].toLowerCase();
  
  const hasCtrl = parts.includes('Ctrl');
  const hasAlt = parts.includes('Alt');
  const hasShift = parts.includes('Shift');
  const hasMeta = parts.includes('Meta');

  // Platform-dependent control key mapping
  // On Mac, Ctrl in keybinding corresponds to Cmd (metaKey), unless Meta is explicitly specified.
  const isMac = navigator.userAgent.includes('Macintosh') || navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  
  const matchesCtrl = isMac 
    ? (hasCtrl ? event.metaKey : !event.metaKey)
    : (hasCtrl ? event.ctrlKey : !event.ctrlKey);
  
  const matchesAlt = hasAlt ? event.altKey : !event.altKey;
  const matchesShift = hasShift ? event.shiftKey : !event.shiftKey;
  const matchesMeta = isMac 
    ? (hasMeta ? event.ctrlKey : !event.ctrlKey) // check physical Ctrl on Mac if Meta is set
    : (hasMeta ? event.metaKey : !event.metaKey);

  // Compare the actual key
  let eventKey = event.key.toLowerCase();
  if (eventKey === ' ') {
    eventKey = 'space';
  }

  return matchesCtrl && matchesAlt && matchesShift && matchesMeta && eventKey === targetKey;
}

