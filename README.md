# Carogent Terminal

Carogent Terminal is an Electron desktop app for working with multiple real terminal sessions in one workspace. It supports split panes, independent shell sessions, pane resizing, layout restore, and per-pane header customization.

## Project Info

- App type: Electron desktop app
- Runtime: Electron main process + browser renderer
- Frontend: React + TypeScript + Vite
- Terminal UI: xterm.js
- Shell backend: node-pty
- Default Windows shell: Command Prompt (`cmd.exe`)
- Default macOS shell: zsh (`/bin/zsh`)
- Package manager: npm

## Getting Started

Install dependencies:

```powershell
npm install
```

Run the app in development mode:

```powershell
npm run dev
```

Build the app:

```powershell
npm run build
```

Run the app:

```powershell
npm run preview
```

Run type checking:

```powershell
npm run typecheck
```

## Main Features

- Split a terminal pane to the right.
- Split a terminal pane downward.
- Resize panes by dragging the divider.
- Close panes.
- Run independent terminal sessions in each pane.
- Choose the shell for each pane.
- Pin one folder in the sidebar and insert file paths into the active terminal.
- Open or focus a browser tab from the active pane.
- Save frequently used websites in Quick Access.
- Show agent completion notifications for terminal panes.
- Open Git Control for the active pane to stage changes, preview diffs, commit, and browse history.
- Restore the pane layout after restarting the app.
- Customize each pane name and header color.

## Git Control

Git Control opens a source-control sidebar for the active pane's current working directory.

1. Click `Git Control` in the top bar.
2. Use the `Changes` tab to inspect staged and unstaged files.
3. Select a file to preview its diff with syntax highlighting.
4. Stage, unstage, or discard file changes from the row actions.
5. Enter a commit message and commit the staged changes.

To maintain UI responsiveness in repositories with extensive modifications, the following performance optimizations are built into Git Control:

- **Display Limits**: Staged and unstaged change lists are capped at a maximum count (defaulting to 50 files). You can click `Show More` to progressively reveal additional files, or `Collapse` to reset the view.
- **Progressive Diff Line Reveal**: Unchanged lines between diff hunks are folded by default and replaced with an expander row (e.g., "120 hidden lines"). Clicking this row asynchronously loads the missing lines. For blocks exceeding 100 lines, it partially reveals the first 50 and last 50 lines with a middle collapse/expansion button to avoid rendering bottlenecks.
- **Binary & Size Guardrails**: Large files or binary file previews are automatically skipped or truncated to prevent UI lag.

Use the `History` tab to browse recent commits and their graph. Use the repository dropdown to view available Git worktrees and switch the active pane to another worktree.

- **Infinite Scrolling**: Commits are loaded dynamically in chunks using an intersection observer, allowing you to scroll through deep project histories without performance degradation.
- **Visual Stability**: Layering z-indexes and graph layouts are mathematically aligned to prevent visual clipping or overlapping of row cells during rendering.

`Discard` deletes untracked files or reverts tracked file changes. This cannot be undone.

## Choose A Pane Shell

Carogent is the terminal workspace. The selected shell runs inside each pane.

1. Click the dropdown on the left side of a pane title bar.
2. Choose a shell from the platform-specific menu.
3. The selected pane restarts with the chosen shell.

Windows shows Command Prompt and Windows PowerShell. macOS shows zsh and bash.

New panes use the platform default shell. Split panes inherit the shell from the pane that was split.

## Pin A Folder

The sidebar can keep one pinned folder across all workspaces.

1. Enter a folder path under `Pinned Folder`.
2. Click `Open`.
3. Click a file to insert its path into the active terminal, or drag a file/folder row into a terminal pane.

Folder rows open that folder in the sidebar. Inserted paths are quoted and followed by a space; Carogent does not press `Enter` or run a command.

## Rename A Pane

Each split terminal pane can have its own display name.

1. Double-click the pane title in the header.
2. Type the new pane name in the `Pane name` input.
3. Press `Enter` to save.

To return to the default shell name, open the editor again, clear the input, and press `Enter`.

Custom names are saved with the layout and restored when the app opens again.

## Change Pane Header Color

Each pane header can use its own preset background color.

1. Double-click the pane title in the header.
2. Choose one of the color swatches.
3. The editor closes and the selected color is applied immediately.

The first swatch restores the default header color.

Header colors are saved per pane, so different split terminals can use different colors.

## Install The Chrome Browser Bridge

Install the included Chrome extension if you want `Open in Browser` and Quick Access to focus existing Chrome tabs instead of opening duplicate tabs.

1. Open `chrome://extensions` in Chrome.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `extensions/chrome-browser-bridge` folder from this repository.
5. Optionally pin `Carogent Browser Bridge` from Chrome's extensions menu.
6. Open the extension popup and keep `Enabled` turned on.

The extension connects to the running Carogent app over `ws://127.0.0.1:17321`. It reconnects automatically after Carogent or Chrome restarts.

After the extension connects, the status dot inside Carogent's top-bar `Open in Browser` button turns green. If it stays gray, make sure Carogent is running, reload the extension from `chrome://extensions`, and wait a few seconds for reconnect.

## Open In Browser

Each terminal pane can keep its own browser URL.

1. Double-click the pane title.
2. Enter a URL or domain in the `Domain` input.
3. Press `Enter` to save.
4. Click `Open in Browser` in the top bar, or click the domain badge in the pane header.

If no URL is configured for the active pane, Carogent opens `http://localhost:3000`.

Carogent first asks the optional Chrome browser bridge to open or focus a matching tab. If the bridge is not installed or unavailable, it tries Chrome remote debugging and then falls back to opening the URL normally.

The status dot inside the top-bar `Open in Browser` button shows the browser bridge state:

- Gray: browser bridge disconnected.
- Green: browser bridge connected.
- Amber: browser bridge connected but disabled in the extension.

## Use Quick Access

Quick Access stores frequently used websites and opens them from a searchable palette.

Add an item:

1. Click the settings icon in the top-right corner.
2. Choose `Quick Access`.
3. Enter a name and domain or URL.
4. Click `Add`.

Open an item:

1. Click `Quick Access` in the top bar, or press `Cmd+P` on macOS / `Ctrl+P` on Windows.
2. Type part of the saved name or domain.
3. Select an item to open or focus its browser tab.

The palette also supports commands:

- Press `Cmd+Shift+P` on macOS / `Ctrl+Shift+P` on Windows to open command mode.
- Or type `>` at the start of a Quick Access search.
- Use command mode to run `Open in Browser` or `Open in VS Code` for the active pane.

## Floating Bar

Use `Pin Current Shell to Floating Bar` from command mode or the pane toolbar to pin a shell preview. The floating always-on-top bar shows pinned shells and their latest terminal preview.

- Click a pinned shell to focus Carogent and open its pane.
- Click the Carogent logo in the floating bar to focus the app.
- Use the settings menu in the top-right corner and toggle `Floating Bar` to show or hide the floating bar. A checkmark appears when it is enabled.

## Agent MCP

Carogent exposes a local MCP control plane for agents launched from a Carogent terminal pane.

Run the MCP server:

```sh
npm run mcp
```

MCP client config example (registered in your `mcp_config.json`):

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

Available tools:

- `carogent_status`: Check bridge connection status and active workspace/pane.
- `list_workspaces`: List workspaces.
- `list_panes`: List terminal panes with metadata (title, cwd, shell, browser URL, etc.).
- `insert_text`: Insert text/keystrokes directly into a terminal pane without pressing Enter.
- `focus_pane`: Focus Carogent and activate a specific pane.
- `notify_done`: Pin or update a pane in the Carogent floating bar.
- `open_vscode`: Open VS Code at a pane's current working directory.

The app injects `CAROGENT_BRIDGE_URL`, `CAROGENT_AGENT_TOKEN`, and `CAROGENT_PANE_ID` into each Carogent shell. Run MCP clients from inside a Carogent pane so requests target the calling pane by default. The localhost bridge only accepts the current app-session token.

For repository-specific setup, place the same content in:

```text
<repo>/GEMINI.md
```

### Skill Setup

To enable AI agents to automatically use these tools, you can copy the reusable skills from this repository:

#### 1. Terminal Control Skill

```bash
mkdir -p ~/.gemini/antigravity-cli/skills/carogent-terminal-control
cp skills/carogent-terminal-control/SKILL.md ~/.gemini/antigravity-cli/skills/carogent-terminal-control/
```

*(Or for standard Gemini CLI: `~/.gemini/skills/carogent-terminal-control/SKILL.md`)*

#### 2. Auto-Notify Done Toggle Skill

```bash
mkdir -p ~/.gemini/antigravity-cli/skills/carogent-done
cp skills/carogent-done/SKILL.md ~/.gemini/antigravity-cli/skills/carogent-done/
```

*(Or for standard Gemini CLI: `~/.gemini/skills/carogent-done/SKILL.md`)*

#### 3. Auto-Notify Done Hook Setup

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

The global `~/.gemini/GEMINI.md` file is the reliable automatic trigger for short prompts such as `say hi`. Skill metadata alone may not activate for every request.

Restart Gemini CLI or Antigravity CLI after updating the instructions.

## Performance & Stability Optimizations

Carogent Terminal incorporates key optimizations in the backend IPC and the frontend rendering layer to handle heavy development workloads seamlessly:

- **File Snippet Caching**: Diff preview snippet requests (`git:file-snippet`) are cached on the backend (`fileLinesCacheMap`) using an LRU eviction strategy (capped at 10 files). For files in the working tree, the cache checks file modification times (`mtimeMs`) to invalidate entries automatically if changes are written to disk. Immutable index and commit files bypass invalidation for direct hits.
- **Zero-Allocation Git Watcher Scanner**: Parsing lists of files from `ls-files` buffers in the main process directory watcher avoids expensive array allocations and string split operations. Instead, it scans files using index-based string searching (`indexOf('\0')`) to identify directories directly. Directory watching is debounced at 1000ms and capped at 2,000 directories to avoid exceeding Node.js file descriptor limits.
- **Git Status Race Condition Prevention**: Async status queries validate paths using a `cwdRef` upon completion. Stale in-flight status promises are ignored if the user switches active panes or directories in the middle of a request, preventing the UI from populating with incorrect or mixed directory data.
- **Asynchronous Terminal Focus**: Activating panes or restoring layouts triggers a deferred focus (`setTimeout`) on the target `xterm.js` instance. This resolves focus race conditions across Electron windows and ensures immediate keyboard input readiness.

## Notes

- Terminal command output and scrollback are not saved between app restarts.
- Only the pane layout, pinned folder, pane shells, pane names, pane colors, pane browser URLs, Quick Access items, and working directory metadata are restored.
- The app uses platform-specific shell defaults: Command Prompt on Windows and zsh on macOS.
