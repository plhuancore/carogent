# Carogent MCP Integration

This repository has a built-in MCP server that exposes tools to control the Carogent Terminal desktop application.

## Setup

The MCP server is registered in your `mcp_config.json`:

```json
{
  "mcpServers": {
    "carogent": {
      "command": "node",
      "args": ["/Users/huanpham/MyProjects/carogent/scripts/carogent-mcp.mjs"]
    }
  }
}
```

## Available Tools

When you run inside a Carogent terminal pane, you can use the following tools:

- `carogent_status`: Check bridge connection status and active workspace/pane.
- `list_workspaces`: List workspaces.
- `list_panes`: List terminal panes with metadata (title, cwd, shell, browser URL, etc.).
- `insert_text`: Insert text/keystrokes directly into a terminal pane without pressing Enter.
- `focus_pane`: Focus Carogent and activate a specific pane.
- `notify_done`: Pin or update a pane in the Carogent floating bar.
- `open_browser`: Open or focus a browser URL (defaults to the pane's browser URL).
- `open_vscode`: Open VS Code at a pane's current working directory.
