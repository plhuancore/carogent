import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { McpIcon } from './AppIcons';

type McpSettingsModalProps = {
  onClose: () => void;
};

export function McpSettingsModal({ onClose }: McpSettingsModalProps): JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [port, setPort] = useState('17322');
  const [scriptPath, setScriptPath] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    window.terminalApi.getAgentBridgeSettings().then((settings) => {
      setEnabled(settings.enabled);
      setPort(String(settings.port));
    }).catch(() => {});

    window.terminalApi.getAgentBridgeScriptPath().then((path) => {
      setScriptPath(path);
    }).catch(() => {});
  }, []);

  const handleCopy = (): void => {
    const config = JSON.stringify({
      mcpServers: {
        carogent: {
          command: 'node',
          args: [scriptPath || 'scripts/carogent-mcp.mjs']
        }
      }
    }, null, 2);
    window.terminalApi.writeClipboardText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = (event: FormEvent): void => {
    event.preventDefault();
    const portNumber = parseInt(port, 10);
    if (isNaN(portNumber) || portNumber < 1024 || portNumber > 65535) {
      setErrorMsg('Port must be a number between 1024 and 65535.');
      return;
    }
    setErrorMsg('');

    window.terminalApi.setAgentBridgeSettings({
      enabled,
      port: portNumber
    }).then(() => {
      onClose();
    }).catch((err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings.');
    });
  };

  return (
    <div className="mcp-settings-overlay" onMouseDown={onClose}>
      <div className="mcp-settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="mcp-settings-header">
          <div className="mcp-settings-title">
            <span className="mcp-settings-icon" aria-hidden="true">
              <McpIcon />
            </span>
            <div>
              <h2>Carogent MCP Server</h2>
              <p>Configure agent integration for terminal automation</p>
            </div>
          </div>
          <button type="button" className="mcp-settings-close-btn" onClick={onClose}>
            Close
          </button>
        </header>

        <form onSubmit={handleSave}>
          <div className="mcp-settings-body">
            <div className="mcp-settings-row">
              <div className="mcp-settings-label-group">
                <span className="mcp-settings-label">Enable MCP Server</span>
                <span className="mcp-settings-desc">Allow AI agents to read, split, and run commands in terminal panes</span>
              </div>
              <label className="mcp-settings-switch">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span className="mcp-settings-slider"></span>
              </label>
            </div>

            <div className="mcp-settings-row">
              <div className="mcp-settings-label-group">
                <span className="mcp-settings-label">Port Number</span>
                <span className="mcp-settings-desc">Local port for the HTTP/MCP bridge connection</span>
              </div>
              <input
                className="mcp-settings-input"
                type="text"
                disabled={!enabled}
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </div>

            {errorMsg && (
              <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '-4px' }}>
                {errorMsg}
              </div>
            )}

            <div className="mcp-settings-section-title">MCP Client Configuration</div>

            <div className="mcp-settings-desc" style={{ marginBottom: '8px' }}>
              Add this configuration to your AI agent's config file (e.g. <code>mcp_config.json</code>):
            </div>

            <div className="mcp-config-box">
              <button type="button" className="mcp-copy-btn" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy Config'}
              </button>
              <pre className="mcp-config-code">
{JSON.stringify({
  mcpServers: {
    carogent: {
      command: 'node',
      args: [scriptPath || 'scripts/carogent-mcp.mjs']
    }
  }
}, null, 2)}
              </pre>
            </div>
          </div>

          <footer className="mcp-settings-footer">
            <button type="button" className="mcp-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="mcp-btn-primary">
              Save Settings
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
