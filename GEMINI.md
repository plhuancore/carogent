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
- `open_vscode`: Open VS Code at a pane's current working directory.

## Skill Setup

For AI agents to effectively use these MCP tools and commands, you should install the reusable skills provided in this repository.

### 1. Terminal Control Skill

Copy the terminal control skill file from the repository to your Gemini/Antigravity config directory:

```bash
mkdir -p ~/.gemini/antigravity-cli/skills/carogent-terminal-control
cp skills/carogent-terminal-control/SKILL.md ~/.gemini/antigravity-cli/skills/carogent-terminal-control/
```

*(Or for standard Gemini CLI: `~/.gemini/skills/carogent-terminal-control/SKILL.md`)*

### 2. Auto-Notify Done Toggle Skill

Copy the auto-notify done skill file from the repository to your config directory:

```bash
mkdir -p ~/.gemini/antigravity-cli/skills/carogent-done
cp skills/carogent-done/SKILL.md ~/.gemini/antigravity-cli/skills/carogent-done/
```

*(Or for standard Gemini CLI: `~/.gemini/skills/carogent-done/SKILL.md`)*

### 3. Auto-Notify Done Hook Setup

Install the hook script into the agent's own config directory, then point the agent hook at that copied file. Do not run the hook through a relative repository path like `node scripts/carogent-done-hook.js`; agents may finish tasks from any working directory.

For Codex:

```bash
mkdir -p ~/.codex/scripts
cp scripts/carogent-done-hook.js ~/.codex/scripts/carogent-done-hook.js
```

Use this command in Codex stop hooks and completion instructions:

```bash
node /Users/huanpham/.codex/scripts/carogent-done-hook.js
```

For Gemini or Antigravity CLI:

```bash
mkdir -p ~/.gemini/antigravity-cli/scripts
cp scripts/carogent-done-hook.js ~/.gemini/antigravity-cli/scripts/carogent-done-hook.js
```

Then add the hook configuration to your Gemini hooks file (usually at `~/.gemini/config/hooks.json`):

```json
{
  "carogent-done-hook": {
    "Stop": [
      {
        "type": "command",
        "command": "node /Users/huanpham/.gemini/antigravity-cli/scripts/carogent-done-hook.js"
      }
    ]
  }
}
```

Verify the hook from a different working directory:

```bash
cd /tmp
node /Users/huanpham/.codex/scripts/carogent-done-hook.js
```

The command should exit with code `0`. If it fails with a missing token, run it from inside a Carogent terminal pane so `CAROGENT_AGENT_TOKEN` is available, or ensure the bridge state file exists.
