import { useEffect, useMemo, useState } from 'react';
import carogentLogoUrl from './assets/carogent-logo.png';
import './styles.css';

function openAgentDonePane(item: AgentDoneOverlayItem): void {
  window.terminalApi.openAgentDonePane({ workspaceId: item.workspaceId, paneId: item.paneId });
}

function OverlayApp(): JSX.Element {
  const [items, setItems] = useState<AgentDoneOverlayItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const latestItem = items[0];
  const menuItems = useMemo(() => items.slice(1), [items]);

  useEffect(() => {
    document.documentElement.classList.add('is-agent-overlay');

    window.terminalApi.getAgentDoneOverlayItems().then(setItems).catch(() => setItems([]));

    const stopItems = window.terminalApi.onAgentDoneOverlayItems((nextItems) => {
      setItems(nextItems);

      if (nextItems.length <= 1) {
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
    const nextExpanded = !expanded && menuItems.length > 0;

    setExpanded(nextExpanded);
    window.terminalApi.setAgentDoneOverlayExpanded(nextExpanded).catch(() => {});
  };

  return (
    <main className="agent-overlay-shell">
      <div className={`agent-overlay-dropdown ${expanded && menuItems.length > 0 ? 'is-expanded' : ''}`}>
        <div className="agent-overlay-trigger" aria-label="Recently finished agents">
          <button
            className="agent-overlay-logo"
            type="button"
            title="Open Carogent"
            onClick={() => window.terminalApi.focusCarogentApp()}
          >
            <img src={carogentLogoUrl} alt="" />
          </button>
          {latestItem ? (
            <button
              className="agent-overlay-current"
              type="button"
              title={`${latestItem.workspaceName}: ${latestItem.cwd || latestItem.title}`}
              onClick={() => openAgentDonePane(latestItem)}
            >
              <span className="agent-overlay-chip-dot" aria-hidden="true" />
              <span className="agent-overlay-chip-title">{latestItem.title}</span>
            </button>
          ) : (
            <span className="agent-overlay-empty">Idle</span>
          )}
          <button
            className="agent-overlay-menu-button"
            type="button"
            title="Show completed tasks"
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
                onClick={() => openAgentDonePane(item)}
              >
                <span className="agent-overlay-chip-dot" aria-hidden="true" />
                <span className="agent-overlay-menu-title">{item.title}</span>
                <span className="agent-overlay-chip-workspace">{item.workspaceName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default OverlayApp;
