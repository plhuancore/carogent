# Source Structure Guide

Use this guide before changing the codebase. Keep changes in the domain that owns the behavior. Prefer small modules over adding more logic to long orchestration files.

## App Shape

This is an Electron + React + TypeScript app.

- `src/main`: Electron main process. Owns native APIs, IPC handlers, PTY processes, local HTTP/WebSocket bridges, filesystem access, and app windows.
- `src/preload`: Safe bridge from renderer to main. Exposes `window.terminalApi`.
- `src/renderer`: React UI, xterm rendering, workspace layout, Git panel UI, overlay UI, and styling.
- `src/shared`: Cross-process TypeScript contracts. Put IPC request/response/event types here.
- `scripts`: Node scripts used outside the bundled app.
- `extensions`: Chrome extension for the browser bridge.

## Main Process

`src/main/index.ts` is the main lifecycle and wiring file. Keep it focused on app startup, window lifecycle, and registering domain handlers.

Domain modules:

- `src/main/browserBridge.ts`: Chrome extension WebSocket bridge, browser URL normalization, remote-debug tab focus fallback, external browser opening.
- `src/main/filesystem.ts`: pinned-folder directory listing and image preview loading.
- `src/main/git/registerGitIpcHandlers.ts`: Git IPC handlers, git command execution, status/diff/history parsing, repository watcher setup.

When adding main-process behavior:

- Add native or OS-specific logic in a domain module, not in renderer code.
- Add shared request/response types in `src/shared/ipcTypes.ts`.
- Register only the IPC binding in `src/main/index.ts` unless the feature needs its own `register...Handlers` module.
- Do not rename existing IPC channels or `window.terminalApi` methods unless the renderer/preload callers are updated together.

## Preload And Shared Types

`src/preload/index.ts` exposes one object: `terminalApi`.

- Keep `terminalApi` method names stable; renderer code depends on them.
- Use `TerminalApi` from `src/shared/ipcTypes.ts` for the exposed API shape.
- Add new event/request/result types to `src/shared/ipcTypes.ts` first, then consume them from main/preload/renderer.

## Renderer

`src/renderer/src/App.tsx` is the top-level orchestrator. It should own app-wide state and compose feature components, not contain large leaf UI blocks.

Current renderer modules:

- `components/AppIcons.tsx`: reusable SVG icon components.
- `components/McpSettingsModal.tsx`: MCP settings dialog.
- `components/PinnedFolderPanel.tsx`: pinned folder browser, image preview, drag path behavior.
- `components/QuickAccess.tsx`: Quick Access palette and manager UI.
- `components/TerminalViews.tsx`: recursive pane tree rendering, split resizing, terminal pane UI, pane search/editor/drop handling.
- `components/WorkspaceItem.tsx`: workspace tab row item.
- `commandPalette.ts`: command palette item type and fuzzy scoring.
- `terminalHelpers.ts`: xterm creation, terminal session type, shell option helpers, fit/scroll/selection helpers.
- `layout.ts`: immutable split-pane layout operations.
- `storage.ts`: persisted workspace/quick-access state.
- `OverlayApp.tsx`: floating overlay renderer.
- `GitPanel.tsx`: Git sidebar orchestration and Git UI composition.

When adding renderer behavior:

- Put app-wide state and cross-feature coordination in `App.tsx`.
- Put leaf UI in `components/*`.
- Put pure search/parsing/scoring/helper logic outside components.
- Keep xterm lifecycle helpers in `terminalHelpers.ts`.
- Keep layout mutations in `layout.ts`.
- Keep storage serialization in `storage.ts`.

## Git Panel

Git UI is split between orchestration and helpers.

- `GitPanel.tsx`: sidebar state, loading status/diff/history, user actions, composition.
- `git/diffParser.ts`: diff line parsing and line metadata.
- `git/syntaxHighlight.tsx`: Prism syntax highlighting.
- `git/historyGraph.tsx`: commit graph calculation, graph SVG cell, ref badge rendering.
- `git/types.ts`: Git panel local types.

When changing Git behavior:

- Main-process Git command behavior belongs in `src/main/git/registerGitIpcHandlers.ts`.
- Renderer Git display/parsing belongs in `src/renderer/src/git/*`.
- `GitPanel.tsx` should stay as orchestration; extract new large visual sections into `components` or `git/*`.

## Styles

`src/renderer/src/styles.css` is only an import barrel. Do not put feature CSS directly in it.

Style chunks:

- `styles/base-overlay.css`: global base and floating overlay styles.
- `styles/app-shell.css`: main app shell, sidebar, workspace list, topbar.
- `styles/quick-access.css`: Quick Access palette and manager.
- `styles/terminal.css`: split tree, pane toolbar, terminal host, pane search/editor.
- `styles/mcp-settings.css`: MCP settings modal.
- `styles/git-panel.css`: Git sidebar, changes tab, diff viewer, commit controls.
- `styles/git-history.css`: Git history table, graph, ref badges.

When adding CSS:

- Add rules to the feature file that matches the component.
- Keep `styles.css` as ordered imports only.
- Preserve import order if a later file intentionally overrides earlier shared styles.

## Verification

Run these after code changes:

```sh
npm run typecheck
npm run build
```

For UI or Electron behavior changes, also smoke test the relevant flow:

- terminal create/write/resize/close
- split panes and workspace switching
- pinned folder browse/path insert/image preview
- Quick Access palette and manager
- Git status/diff/stage/history
- browser open/focus bridge
- floating overlay pin/focus
- MCP settings save/load

## Refactor Rules

- Keep behavior-preserving refactors small and domain-scoped.
- Avoid adding new dependencies for file organization.
- Do not move code across main/preload/renderer boundaries unless ownership requires it.
- Do not duplicate IPC/type definitions; use `src/shared/ipcTypes.ts`.
- If a file grows past roughly 800 lines, look for a domain helper, leaf component, or style chunk to extract before adding more logic.
