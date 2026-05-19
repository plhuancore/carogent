# Carogent Terminal

Carogent Terminal is an Electron desktop app for working with multiple real terminal sessions in one workspace. It supports split panes, independent Command Prompt or PowerShell sessions, pane resizing, layout restore, and per-pane header customization.

## Project Info

- App type: Electron desktop app
- Frontend: React + TypeScript + Vite
- Terminal UI: xterm.js
- Shell backend: node-pty
- Default Windows shell: Command Prompt (`cmd.exe`)
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
- Choose Command Prompt or Windows PowerShell per pane.
- Restore the pane layout after restarting the app.
- Customize each pane name and header color.

## Choose A Pane Shell

Carogent is the terminal workspace. Command Prompt and Windows PowerShell are the shells that run inside each pane.

1. Click the dropdown on the left side of a pane title bar.
2. Choose `Command Prompt` or `Windows PowerShell`.
3. The selected pane restarts with the chosen shell.

New panes use Command Prompt by default. Split panes inherit the shell from the pane that was split.

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

## Notes

- Terminal command output and scrollback are not saved between app restarts.
- Only the pane layout, pane shells, pane names, pane colors, and working directory metadata are restored.
- The app is currently Windows-first and uses Command Prompt by default.
