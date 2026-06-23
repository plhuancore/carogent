import { useEffect, useState, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { AgentDoneOverlayItem } from '../../shared/ipcTypes';
import carogentLogoUrl from './assets/carogent-logo-v2.png';
import './styles.css';

function ArrowUpIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m3.5 10.5 4.5-4.5 4.5 4.5" />
    </svg>
  );
}

function ArrowDownIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m3.5 5.5 4.5 4.5 4.5-4.5" />
    </svg>
  );
}

function RemoveIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m4.75 4.75 6.5 6.5M11.25 4.75l-6.5 6.5" />
    </svg>
  );
}

function OverlayApp(): JSX.Element {
  const [items, setItems] = useState<AgentDoneOverlayItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [blinkingPaneIds, setBlinkingPaneIds] = useState<Set<string>>(new Set());
  const lastTimestamps = useRef<Map<string, number>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    const toAdd = new Set<string>();
    const toRemove = new Set<string>();

    for (const item of items) {
      if (!item.hasUnreadNotification) {
        // Clear any existing blinking timer for this pane
        const timer = timers.current.get(item.paneId);
        if (timer) {
          clearTimeout(timer);
          timers.current.delete(item.paneId);
        }
        toRemove.add(item.paneId);
        continue;
      }

      const timestamp = item.notifyTimestamp || 0;

      const lastTimestamp = lastTimestamps.current.get(item.paneId) || 0;

      if (timestamp > 0 && timestamp > lastTimestamp) {
        lastTimestamps.current.set(item.paneId, timestamp);
        
        const age = now - timestamp;
        if (age < 10000) {
          // Clear any existing timer for this pane
          const existingTimer = timers.current.get(item.paneId);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          toAdd.add(item.paneId);

          const remaining = 10000 - age;
          const paneId = item.paneId;
          const newTimer = setTimeout(() => {
            setBlinkingPaneIds((prev) => {
              const next = new Set(prev);
              next.delete(paneId);
              return next;
            });
            timers.current.delete(paneId);
          }, remaining);
          
          timers.current.set(paneId, newTimer);
        } else {
          // If the notification is older than 10s, remove blinking
          const timer = timers.current.get(item.paneId);
          if (timer) {
            clearTimeout(timer);
            timers.current.delete(item.paneId);
          }
          toRemove.add(item.paneId);
        }
      }
    }

    // Clean up removed items from lastTimestamps and active timers
    const currentPaneIds = new Set(items.map((i) => i.paneId));
    for (const key of lastTimestamps.current.keys()) {
      if (!currentPaneIds.has(key)) {
        lastTimestamps.current.delete(key);
        const timer = timers.current.get(key);
        if (timer) {
          clearTimeout(timer);
          timers.current.delete(key);
        }
        toRemove.add(key);
      }
    }

    if (toAdd.size > 0 || toRemove.size > 0) {
      setBlinkingPaneIds((prev) => {
        const next = new Set(prev);
        for (const id of toAdd) {
          next.add(id);
        }
        for (const id of toRemove) {
          next.delete(id);
        }
        return next;
      });
    }
  }, [items]);

  const toggleExpanded = (): void => {
    const nextExpanded = !expanded && items.length > 0;

    setExpanded(nextExpanded);
    window.terminalApi.setAgentDoneOverlayExpanded(nextExpanded).catch(() => {});
  };

  const handleOpenPane = (item: AgentDoneOverlayItem): void => {
    window.terminalApi.openAgentDonePane({ workspaceId: item.workspaceId, paneId: item.paneId });
  };

  const handleRemove = (event: ReactMouseEvent, paneId: string): void => {
    event.stopPropagation();
    window.terminalApi.unpinAgentDonePane(paneId).catch(() => {});
  };

  const handleMoveUp = (event: ReactMouseEvent, index: number): void => {
    event.stopPropagation();
    if (index <= 0) return;
    const nextItems = [...items];
    const temp = nextItems[index];
    nextItems[index] = nextItems[index - 1];
    nextItems[index - 1] = temp;
    setItems(nextItems);

    const paneIds = nextItems.map((item) => item.paneId);
    window.terminalApi.reorderAgentDoneOverlayItems(paneIds).catch(() => {});
  };

  const handleMoveDown = (event: ReactMouseEvent, index: number): void => {
    event.stopPropagation();
    if (index >= items.length - 1) return;
    const nextItems = [...items];
    const temp = nextItems[index];
    nextItems[index] = nextItems[index + 1];
    nextItems[index + 1] = temp;
    setItems(nextItems);

    const paneIds = nextItems.map((item) => item.paneId);
    window.terminalApi.reorderAgentDoneOverlayItems(paneIds).catch(() => {});
  };

  const handleKeyDown = (event: ReactKeyboardEvent, item: AgentDoneOverlayItem): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenPane(item);
    }
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
              {items.some((item) => item.hasUnreadNotification) && (
                <span
                  className={`agent-overlay-chip-dot ${
                    items.some((item) => blinkingPaneIds.has(item.paneId)) ? 'is-blinking' : ''
                  }`}
                  aria-hidden="true"
                />
              )}
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
            {menuItems.map((item, index) => (
              <div
                key={item.paneId}
                className="agent-overlay-menu-item"
                role="menuitem"
                tabIndex={0}
                title={`${item.workspaceName}: ${item.cwd || item.title}`}
                onClick={() => handleOpenPane(item)}
                onKeyDown={(e) => handleKeyDown(e, item)}
              >
                <div className="agent-overlay-menu-item-actions">
                  {index > 0 && (
                    <button
                      className="agent-overlay-action-button move-up"
                      type="button"
                      title="Move up"
                      onClick={(e) => handleMoveUp(e, index)}
                    >
                      <ArrowUpIcon />
                    </button>
                  )}
                  {index < menuItems.length - 1 && (
                    <button
                      className="agent-overlay-action-button move-down"
                      type="button"
                      title="Move down"
                      onClick={(e) => handleMoveDown(e, index)}
                    >
                      <ArrowDownIcon />
                    </button>
                  )}
                  <button
                    className="agent-overlay-action-button remove"
                    type="button"
                    title="Remove from floating bar"
                    onClick={(e) => handleRemove(e, item.paneId)}
                  >
                    <RemoveIcon />
                  </button>
                </div>
                <div className="agent-overlay-item-header">
                  {item.hasUnreadNotification && (
                    <span
                      className={`agent-overlay-chip-dot ${
                        blinkingPaneIds.has(item.paneId) ? 'is-blinking' : ''
                      }`}
                      aria-hidden="true"
                    />
                  )}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default OverlayApp;
