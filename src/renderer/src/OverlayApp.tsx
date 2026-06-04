import { useEffect, useState } from 'react';
import type { AgentDoneOverlayItem } from '../../shared/ipcTypes';
import carogentLogoUrl from './assets/carogent-logo-v2.png';
import './styles.css';

function OverlayApp(): JSX.Element {
  const [items, setItems] = useState<AgentDoneOverlayItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const menuItems = items;

  useEffect(() => {
    document.documentElement.classList.add('is-agent-overlay');

    window.terminalApi.getAgentDoneOverlayItems().then(setItems).catch(() => setItems([]));

    const stopItems = window.terminalApi.onAgentDoneOverlayItems((nextItems) => {
      setItems(nextItems);

      if (nextItems.length === 0) {
        setExpanded(false);
        window.terminalApi.setAgentDoneOverlayExpanded(false).catch(() => {});
      }
    });

    return () => {
      stopItems();
      document.documentElement.classList.remove('is-agent-overlay');
    };
  }, []);

  const toggleExpanded = (): void => {
    const nextExpanded = !expanded && items.length > 0;

    setExpanded(nextExpanded);
    window.terminalApi.setAgentDoneOverlayExpanded(nextExpanded).catch(() => {});
  };

  const handleOpenPane = (item: AgentDoneOverlayItem): void => {
    window.terminalApi.openAgentDonePane({ workspaceId: item.workspaceId, paneId: item.paneId });
  };

  return (
    <main className="agent-overlay-shell">
      <div className={`agent-overlay-dropdown ${expanded && menuItems.length > 0 ? 'is-expanded' : ''}`}>
        <div className="agent-overlay-trigger" aria-label="Pinned shells">
          <button
            className="agent-overlay-logo"
            type="button"
            title="Open Carogent"
            onClick={() => window.terminalApi.focusCarogentApp()}
          >
            <img src={carogentLogoUrl} alt="" draggable={false} />
          </button>
          {items.length > 0 ? (
            <div
              className="agent-overlay-current-count"
              title={`${items.length} shells pinned`}
            >
              <span className="agent-overlay-chip-dot" aria-hidden="true" />
              <span className="agent-overlay-chip-title">{items.length} Pinned</span>
            </div>
          ) : (
            <span className="agent-overlay-empty">Idle</span>
          )}
          <button
            className="agent-overlay-menu-button"
            type="button"
            title="Show terminal previews"
            aria-expanded={expanded}
            disabled={menuItems.length === 0}
            onClick={toggleExpanded}
          />
          <button
            className="agent-overlay-close"
            type="button"
            title="Hide floating bar"
            onClick={() => window.terminalApi.closeAgentDoneOverlay()}
          >
            ×
          </button>
        </div>
        {expanded && menuItems.length > 0 && (
          <div className="agent-overlay-menu" role="menu">
            {menuItems.map((item) => (
              <button
                key={item.paneId}
                className="agent-overlay-menu-item"
                type="button"
                role="menuitem"
                title={`${item.workspaceName}: ${item.cwd || item.title}`}
                onClick={() => handleOpenPane(item)}
              >
                <div className="agent-overlay-item-header">
                  <span className="agent-overlay-chip-dot" aria-hidden="true" />
                  <span className="agent-overlay-menu-title">{item.title}</span>
                  <span className="agent-overlay-chip-workspace">{item.workspaceName}</span>
                </div>
                {item.lines && item.lines.length > 0 && (
                  <div className="agent-overlay-item-terminal">
                    {item.lines.map((line, idx) => (
                      <div key={idx} className="agent-overlay-terminal-line">
                        {line || '\u00A0'}
                      </div>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default OverlayApp;
