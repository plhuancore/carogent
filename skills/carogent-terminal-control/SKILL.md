---
name: carogent-terminal-control
description: Integrate with the Carogent Desktop Terminal workspace. Use this skill to focus panes, split panes, insert terminal text, open browser tabs in Carogent, open the workspace in VS Code, and manage terminal actions.
---

# Carogent Workspace Integration

## Purpose

Use this skill when you are operating inside the Carogent Terminal workspace environment. These tools allow you to interact directly with the desktop app's panes and browser, providing seamless flow between your terminal work and the Carogent UI.

## MCP Routing

Use the local `carogent` MCP server to interact with the Carogent Terminal.

Available tools:
- `carogent_status`: Inspect bridge connection status and active workspace/pane.
- `list_workspaces`: List workspaces.
- `list_panes`: List terminal panes with metadata (title, cwd, shell, browser URL, etc.).
- `insert_text`: Insert text/keystrokes directly into a terminal pane without pressing Enter.
- `focus_pane`: Focus Carogent and activate a specific pane.
- `notify_done`: Pin or update a pane in the Carogent floating bar.
- `open_browser`: Open or focus a browser URL (defaults to the pane's browser URL).
- `open_vscode`: Open VS Code at a pane's current working directory.
- `split_pane`: Split a terminal pane and optionally assign a title.

## Recommended Workflow and Rules

1. **Check connection status**: Run `carogent_status` to ensure you are communicating properly with the Carogent desktop app.
2. **Interact with panes**: If you need to focus, split, or send commands to terminal panes, use `focus_pane`, `split_pane`, or `insert_text`.
3. **Notify on task completion**: When you finish any task, command execution, or build, you MUST call `notify_done` on the active pane to alert the user and pin/update the terminal pane status on the Carogent floating bar.
