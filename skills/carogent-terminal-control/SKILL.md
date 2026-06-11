---
name: carogent-terminal-control
description: Integrate with the Carogent Desktop Terminal workspace. Use this skill to focus panes, split panes, insert terminal text, open the workspace in VS Code, and manage terminal actions.
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
- `open_vscode`: Open VS Code at a pane's current working directory.
- `split_pane`: Split a terminal pane and optionally assign a title.

## Recommended Workflow and Rules

1. **Check connection status**: Run `carogent_status` to ensure you are communicating properly with the Carogent desktop app.
2. **Interact with panes**: If you need to focus, split, or send commands to terminal panes, use `focus_pane`, `split_pane`, or `insert_text`.
3. **Notify on task completion**: When you finish any task, command execution, or build, you MUST call `notify_done` on the active pane to alert the user and pin/update the terminal pane status on the Carogent floating bar.

## Subagent Monitoring Utility

When the user asks you to spawn a subagent and monitor it in a separate shell pane, follow these steps:
1. Spawn the subagent using `invoke_subagent`. You will receive a `conversationId` for the subagent.
2. Split a new terminal pane using `split_pane` with `title: "<Subagent Role> Monitor"` (or `<Subagent TypeName> Monitor` if role is not available).
3. Locate the monitoring script:
   - Check if `scripts/monitor.js` exists in the current project workspace.
   - If not, use the global script at `~/.gemini/scripts/monitor.js`.
4. Insert the command into the new monitor pane using `insert_text` to start it. Prefer targeting the specific subagent ID to avoid auto-detection issues:
   - **Recommended**: Run the script with the specific subagent ID:
     `node scripts/monitor.js <conversationId>\n` (or `node ~/.gemini/scripts/monitor.js <conversationId>\n`)
   - Alternatively, run the script in Auto-Detect mode (only if the parent conversation ID is correctly configured/skipped in the script):
     `node scripts/monitor.js\n` (or `node ~/.gemini/scripts/monitor.js\n`)

