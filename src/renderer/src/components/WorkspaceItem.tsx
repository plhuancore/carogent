import { useEffect, useState } from 'react';
import type { WorkspaceState } from '../storage';
import { countPanes } from '../layout';
import { CloseIcon } from './AppIcons';

const WORKSPACE_COLOR_PRESETS = [
  '#a78bfa',
  '#8bb9ff',
  '#8b5cf6',
  '#f0abfc',
  '#f5c77a',
  '#8ee6b0',
  '#a7a0b8',
  '#131217'
];

type WorkspaceItemProps = {
  workspace: WorkspaceState;
  active: boolean;
  canDelete: boolean;
  onSelect: (workspaceId: string) => void;
  onRename: (workspaceId: string, name: string) => void;
  onColorChange: (workspaceId: string, color: string) => void;
  onDelete: (workspaceId: string) => void;
};

export function WorkspaceItem({
  workspace,
  active,
  canDelete,
  onSelect,
  onRename,
  onColorChange,
  onDelete
}: WorkspaceItemProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);
  const workspaceColor = workspace.color || WORKSPACE_COLOR_PRESETS[0];
  const dotStyle = {
    backgroundColor: workspaceColor,
    boxShadow: active
      ? `0 0 0 2px rgba(248, 250, 252, 0.58), 0 0 14px ${workspaceColor}`
      : `0 0 0 1px rgba(248, 250, 252, 0.28), 0 0 10px ${workspaceColor}`
  };

  const commitName = (): void => {
    onRename(workspace.id, draftName);
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) {
      setDraftName(workspace.name);
    }
  }, [editing, workspace.name]);

  if (editing) {
    return (
      <div className={`workspace-item is-editing ${active ? 'active' : ''}`}>
        <div className="workspace-edit-row">
          <span className="status-dot" style={dotStyle} />
          <input
            className="workspace-name-input"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitName();
              }

              if (event.key === 'Escape') {
                setDraftName(workspace.name);
                setEditing(false);
              }
            }}
          />
          <span className="badge">{countPanes(workspace.layout)}</span>
        </div>
        <div className="workspace-color-swatches" aria-label="Workspace color">
          {WORKSPACE_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              className={`workspace-color-swatch ${color === workspaceColor ? 'is-selected' : ''}`}
              type="button"
              title={color === WORKSPACE_COLOR_PRESETS[0] ? 'Default' : color}
              style={{ backgroundColor: color }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onColorChange(workspace.id, color)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`workspace-item ${active ? 'active' : ''}`}>
      <button
        className="workspace-select-button"
        type="button"
        onClick={() => onSelect(workspace.id)}
        onDoubleClick={() => setEditing(true)}
      >
        <span className="status-dot" style={dotStyle} />
        <span className="workspace-name">{workspace.name}</span>
      </button>
      <span className="badge">{countPanes(workspace.layout)}</span>
      <button
        className="workspace-delete-button"
        type="button"
        title={canDelete ? 'Delete workspace' : 'Cannot delete the last workspace'}
        onClick={() => onDelete(workspace.id)}
        disabled={!canDelete}
      >
        <CloseIcon />
      </button>
    </div>
  );
}


