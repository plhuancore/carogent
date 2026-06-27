# Release v0.1.0 - The Initial Launch of Carogent Terminal 🚀

Welcome to the initial release of **Carogent Terminal**! 

Carogent Terminal is a modern, high-performance, split-pane terminal workspace and lightweight developer environment built with Electron, React, and TypeScript. It is designed to combine terminal control, file editing, version control, and AI-agent integrations into a single fluid workspace.

Here is a complete guide to everything supported in this initial release:

---

## Key Features & Supports 🌟

### 1. 🪟 Advanced Split-Pane Terminal Workspace
- **Multi-Shell Support**: Run native command prompts dynamically (Command Prompt, Windows PowerShell on Windows; zsh, bash on macOS/Linux).
- **Flexible Layouts**: Split any pane horizontally (`Ctrl+Shift+-` or Split Down button) or vertically (`Ctrl+\` or Split Right button).
- **Drag & Drop Reordering**: Drag and drop pane headers to dock, swap, or resize terminal panes using live drag-zone previews.
- **Maximized View**: Focus on a single pane with Fullscreen Terminal mode (`Ctrl+Shift+Enter`).

### 2. 📝 Embedded Code Editor & Diff Viewer
- Powered by **Monaco Editor** (the core editor of VS Code) for high-performance file editing directly within the workspace.
- **Rich Syntax Highlighting**: Full language support for JavaScript, TypeScript, HTML, CSS, JSON, Python, Go, and more.
- **Visual Diff Editor**: Double-click any modified file in the Git panel to open a side-by-side/inline comparison of changes.
- **Crisp Typography**: Optimised font rendering with modern coding fonts (`Cascadia Mono`, `Consolas`, `Menlo`, `Monaco`).

### 🌿 Git Version Control Integration
- **Changes Panel**: View staged and unstaged file modifications instantly.
- **Detailed History Log**: Open commits to view commit ID, author, date, message, and the exact diffs.
- **Quick Operations**:
  - Soft-reset staged changes.
  - "Git: Undo Last Commit" helper to roll back the latest commit while preserving local changes.

### 4. 📂 Workspace File Explorer & Global Search
- **Workspace Tree View**: Browse, create, rename, or delete files and folders inside your workspace directory.
- **Quick Actions**: Pin frequently used folders to the sidebar for fast switching.
- **Global Search (Grep)**: Search file contents across the entire workspace using text, match case, or Regular Expressions (Regex).

### 5. ⚡ Quick Access & Command Palette
- Press **`Ctrl+Shift+P`** (Mac: `Cmd+Shift+P`) to open the **Command Palette**.
- Search and run editor commands, switch workspaces, toggle sidebars, or locate files by typing their names (fuzzy search support).

### 6. 🤖 Model Context Protocol (MCP) AI Integration
- Built-in **MCP Server** exposing direct terminal control APIs to AI agents (like Claude/Gemini coding assistants).
- **Bridge Status Overlay**: A visual floating bar showing active bridge connectivity and background task state.
- **Automated Hooks**: Auto-notifies the host bar when a long-running command finishes.

### 7. ⌨️ Customizable Keyboard Shortcuts
- Complete keyboard accessibility.
- Interactive shortcuts settings page to customize triggers for panel toggles, search, and shell spawning:
  - Default **`Ctrl+Shift+1`**: Spawn Command Prompt (zsh on macOS).
  - Default **`Ctrl+Shift+2`**: Spawn Windows PowerShell (bash on macOS).

---

## Installation & Setup 💻

### System Requirements:
- Windows 10/11 (x64)
- macOS Big Sur or newer (Intel / Apple Silicon)

### How to Install:
- **Windows**: Download and run [Carogent Terminal Setup 0.1.0.exe](file:///c:/Projects/carogent/dist/Carogent%20Terminal%20Setup%200.1.0.exe).
- **macOS**: Drag `Carogent Terminal.app` to your `Applications` folder from the generated `.dmg` image.
