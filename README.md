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
- Restore the pane layout after restarting the app.
- Customize each pane name and header color.

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

For repository-specific setup, place the same content in:

```text
<repo>/GEMINI.md
```

Optional reusable skills can also live at:

```text
~/.gemini/skills/carogent-agent-notify/SKILL.md
~/.gemini/antigravity-cli/skills/carogent-agent-notify/SKILL.md
```

The global `~/.gemini/GEMINI.md` file is the reliable automatic trigger for short prompts such as `say hi`. Skill metadata alone may not activate for every request.

Restart Gemini CLI or Antigravity CLI after updating the instructions.

## Notes

- Terminal command output and scrollback are not saved between app restarts.
- Only the pane layout, pinned folder, pane shells, pane names, pane colors, pane browser URLs, Quick Access items, and working directory metadata are restored.
- The app uses platform-specific shell defaults: Command Prompt on Windows and zsh on macOS.
