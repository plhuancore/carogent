import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export function registerGitIpcHandlers(): void {
  // Git Helper Functions and IPC Handlers
  const GIT_DIFF_PREVIEW_MAX_BYTES = 1024 * 1024;
  const GIT_DIFF_PREVIEW_MAX_LINES = 5000;
  const GIT_WATCH_DEBOUNCE_MS = 450;
  const GIT_WATCH_MAX_DIRECTORIES = 2000;
  const GIT_UNTRACKED_DIRECTORY_PREVIEW_LIMIT = 200;

  type GitWatchState = {
    cwd: string;
    watchers: FSWatcher[];
    timeout: NodeJS.Timeout | null;
  };

  const gitWatchers = new Map<number, GitWatchState>();

  function runGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trimEnd());
        } else {
          reject(new Error(stderr.trim() || `Git command failed with exit code ${code}`));
        }
      });
      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  function normalizeGitPath(pathValue: string): string {
    return pathValue.replace(/\\/g, '/').replace(/^"\s*/, '').replace(/\s*"$/, '');
  }

  function parsePorcelainPath(line: string): string {
    let filePath = normalizeGitPath(line.slice(3).trim());

    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop() || filePath;
    }

    return filePath;
  }

  async function getGitWorktrees(cwd: string) {
    try {
      await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
    } catch {
      return [];
    }

    try {
      const output = await runGitCommand(['worktree', 'list', '--porcelain'], cwd);
      const blocks = output.split('\n\n');
      const worktrees: any[] = [];
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        let path = '';
        let commit = '';
        let branch = '';

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            path = line.slice(9).trim();
          } else if (line.startsWith('commit ')) {
            commit = line.slice(7).trim();
          } else if (line.startsWith('branch ')) {
            const rawBranch = line.slice(7).trim();
            branch = rawBranch.startsWith('refs/heads/')
              ? rawBranch.slice(11)
              : rawBranch;
          }
        }

        if (path) {
          const normalizedPath = path.replace(/[/\\]$/, '');
          const normalizedCwd = cwd.replace(/[/\\]$/, '');
          const isCurrent = normalizedPath.toLowerCase() === normalizedCwd.toLowerCase();
          const name = path.split(/[/\\]/).pop() || 'worktree';

          worktrees.push({
            path,
            name,
            commit,
            branch,
            isCurrent
          });
        }
      }
      return worktrees;
    } catch (err) {
      console.error('Error listing git worktrees:', err);
      return [];
    }
  }

  async function getGitStatus(cwd: string) {
    try {
      await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
    } catch {
      return { isRepo: false };
    }

    try {
      let branch = '';
      let statusText = await runGitCommand(['status', '--porcelain=v1', '-b', '--untracked-files=all'], cwd);
      const statusLines = statusText.split('\n');
      const firstLine = statusLines[0] || '';
      if (firstLine.startsWith('## ')) {
        const branchText = firstLine.slice(3);
        branch = branchText.startsWith('No commits yet on ')
          ? branchText.slice('No commits yet on '.length)
          : branchText.split('...')[0].split(' ')[0] || 'HEAD';
        statusText = statusLines.slice(1).join('\n');
      }

      const repoBasename = cwd.split(/[/\\]/).pop() || 'Repository';
      const lines = statusText ? statusText.split('\n') : [];

      const staged: any[] = [];
      const unstaged: any[] = [];

      for (const line of lines) {
        if (!line || line.length < 4) continue;
        const x = line[0];
        const y = line[1];
        const filePath = parsePorcelainPath(line);

        const isDirectory = filePath.endsWith('/');
        const displayPath = isDirectory ? filePath.slice(0, -1) : filePath;
        const fileBasename = displayPath.split(/[/\\]/).pop() || displayPath;
        const fileDir = displayPath.substring(0, displayPath.length - fileBasename.length - 1) || '';
        const kind = isDirectory ? 'directory' : 'file';

        if (['M', 'A', 'D', 'R', 'C'].includes(x)) {
          staged.push({
            path: filePath,
            status: x,
            dir: fileDir,
            name: fileBasename,
            kind
          });
        }

        if (['M', 'D'].includes(y) || (x === '?' && y === '?')) {
          unstaged.push({
            path: filePath,
            status: x === '?' ? '?' : y,
            dir: fileDir,
            name: fileBasename,
            kind
          });
        }
      }

      return {
        isRepo: true,
        branch,
        repoName: repoBasename,
        staged,
        unstaged
      };
    } catch (err: any) {
      return {
        isRepo: true,
        error: err.message || String(err)
      };
    }
  }

  function createSkippedDiff(filePath: string, reason: string) {
    return [
      `diff --git a/${filePath} b/${filePath}`,
      `--- /dev/null`,
      `+++ b/${filePath}`,
      `@@ -0,0 +1 @@`,
      `+${reason}`
    ].join('\n');
  }

  async function createUntrackedDirectoryDiff(cwd: string, filePath: string) {
    const filesText = await runGitCommand(['ls-files', '--others', '--exclude-standard', '-z', '--', filePath], cwd);
    const files = filesText.split('\0').filter(Boolean);
    const visibleFiles = files.slice(0, GIT_UNTRACKED_DIRECTORY_PREVIEW_LIMIT);
    const hiddenCount = Math.max(0, files.length - visibleFiles.length);
    const diffLines = [
      `diff --git a/${filePath} b/${filePath}`,
      `new directory mode 040000`,
      `--- /dev/null`,
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${files.length || 1} @@`
    ];

    if (visibleFiles.length === 0) {
      diffLines.push('+No untracked files found in this directory.');
    } else {
      for (const file of visibleFiles) {
        diffLines.push(`+${file}`);
      }
      if (hiddenCount > 0) {
        diffLines.push(`+... Preview truncated: ${hiddenCount} more files not shown.`);
      }
    }

    return diffLines.join('\n');
  }

  function isLikelyBinary(buffer: Buffer): boolean {
    if (buffer.includes(0)) return true;
    const sampleLength = Math.min(buffer.length, 4096);
    let suspicious = 0;

    for (let i = 0; i < sampleLength; i += 1) {
      const byte = buffer[i];
      if (byte < 7 || (byte > 14 && byte < 32)) {
        suspicious += 1;
      }
    }

    return sampleLength > 0 && suspicious / sampleLength > 0.3;
  }

  async function getGitDiff(cwd: string, filePath: string, isStaged: boolean) {
    try {
      let diff = '';
      if (isStaged) {
        diff = await runGitCommand(['diff', '--cached', '--', filePath], cwd);
      } else {
        const statusText = await runGitCommand(['status', '--porcelain', '--', filePath], cwd);
        const isUntracked = statusText.startsWith('??');

        if (isUntracked) {
          try {
            const fullPath = join(cwd, filePath);
            const fileStat = await stat(fullPath);
            if (fileStat.isDirectory()) {
              diff = await createUntrackedDirectoryDiff(cwd, filePath);
              return { diff };
            }

            if (fileStat.size > GIT_DIFF_PREVIEW_MAX_BYTES) {
              diff = createSkippedDiff(filePath, `Preview skipped: file is larger than ${GIT_DIFF_PREVIEW_MAX_BYTES / 1024 / 1024} MB.`);
              return { diff };
            }

            const buffer = await readFile(fullPath);
            if (isLikelyBinary(buffer)) {
              diff = createSkippedDiff(filePath, 'Preview skipped: binary file.');
              return { diff };
            }

            const content = buffer.toString('utf8');
            const lines = content.split('\n');
            const visibleLines = lines.slice(0, GIT_DIFF_PREVIEW_MAX_LINES);
            const truncatedLineCount = Math.max(0, lines.length - visibleLines.length);
            const diffLines = [
              `diff --git a/${filePath} b/${filePath}`,
              `new file mode 100644`,
              `--- /dev/null`,
              `+++ b/${filePath}`,
              `@@ -0,0 +1,${lines.length} @@`
            ];

            for (const line of visibleLines) {
              diffLines.push(`+${line}`);
            }
            if (truncatedLineCount > 0) {
              diffLines.push(`+... Preview truncated: ${truncatedLineCount} more lines not shown.`);
            }
            diff = diffLines.join('\n');
          } catch {
            diff = 'Could not read untracked file content.';
          }
        } else {
          diff = await runGitCommand(['diff', '--', filePath], cwd);
        }
      }
      return { diff };
    } catch (err: any) {
      return { error: err.message || String(err) };
    }
  }

  function closeGitWatchState(webContentsId: number) {
    const state = gitWatchers.get(webContentsId);
    if (!state) return;

    for (const watcher of state.watchers) {
      try {
        watcher.close();
      } catch (err) {
        console.error('Error closing watcher:', err);
      }
    }

    if (state.timeout) {
      clearTimeout(state.timeout);
    }

    gitWatchers.delete(webContentsId);
  }

  function addWatchDirectory(directories: Set<string>, cwd: string, relativeDirectory: string) {
    const normalized = normalizeGitPath(relativeDirectory).replace(/\/$/, '');
    if (!normalized || normalized === '.') {
      directories.add(cwd);
      return;
    }
    const parts = normalized.split('/').filter(Boolean);
    let current = cwd;

    directories.add(cwd);
    for (const part of parts) {
      current = join(current, part);
      directories.add(current);
    }
  }

  async function getGitWatchDirectories(cwd: string) {
    const directories = new Set<string>([cwd]);

    try {
      await runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
    } catch {
      return Array.from(directories);
    }

    try {
      const filesText = await runGitCommand(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd);
      const files = filesText.split('\0').filter(Boolean);
      for (const file of files) {
        addWatchDirectory(directories, cwd, dirname(file));
        if (directories.size >= GIT_WATCH_MAX_DIRECTORIES) {
          console.warn(`Git watcher directory cap reached (${GIT_WATCH_MAX_DIRECTORIES}) for ${cwd}`);
          break;
        }
      }
    } catch (err) {
      console.error('Failed to enumerate git watch directories:', err);
    }

    const gitDirectory = join(cwd, '.git');
    const gitRefsDirectory = join(gitDirectory, 'refs');
    if (existsSync(gitDirectory)) {
      directories.add(gitDirectory);
    }
    if (existsSync(gitRefsDirectory)) {
      directories.add(gitRefsDirectory);
      await collectDirectories(gitRefsDirectory, directories);
    }

    return Array.from(directories).filter((directory) => existsSync(directory));
  }

  async function collectDirectories(parent: string, directories: Set<string>) {
    try {
      const entries = await readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const childPath = join(parent, entry.name);
        directories.add(childPath);
        await collectDirectories(childPath, directories);
      }
    } catch {
      // Refs can disappear while git updates them; next watcher restart will rescan.
    }
  }

  function shouldIgnoreWatchedPath(relativePath: string) {
    const normalized = normalizeGitPath(relativePath);
    if (!normalized) return false;

    if (normalized.startsWith('.git/')) {
      return !(
        normalized === '.git/HEAD' ||
        normalized === '.git/index' ||
        normalized.startsWith('.git/refs/')
      );
    }

    return normalized.split('/').some((part) => part.startsWith('.'));
  }

  ipcMain.handle('git:watch', async (event, { cwd }) => {
    const webContentsId = event.sender.id;
    closeGitWatchState(webContentsId);

    if (!cwd) return;

    const state: GitWatchState = {
      cwd,
      watchers: [],
      timeout: null
    };
    gitWatchers.set(webContentsId, state);
    event.sender.once('destroyed', () => {
      closeGitWatchState(webContentsId);
    });

    const sendChange = () => {
      if (state.timeout) clearTimeout(state.timeout);
      state.timeout = setTimeout(() => {
        if (!event.sender.isDestroyed() && gitWatchers.get(webContentsId) === state) {
          event.sender.send('git:change');
        }
      }, GIT_WATCH_DEBOUNCE_MS);
    };

    try {
      const directories = await getGitWatchDirectories(cwd);
      if (gitWatchers.get(webContentsId) !== state) return;

      for (const directory of directories) {
        try {
          const watcher = watch(directory, (eventType, filename) => {
            if (!filename) {
              sendChange();
              return;
            }

            const absolutePath = join(directory, filename.toString());
            const relativePath = relative(cwd, absolutePath);
            if (relativePath.startsWith('..') || shouldIgnoreWatchedPath(relativePath)) {
              return;
            }

            sendChange();
          });
          watcher.on('error', (err: any) => {
            console.error('Git watcher error:', err);
          });
          state.watchers.push(watcher);
        } catch (err) {
          console.error(`Failed to watch git directory ${directory}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to start git watcher:', err);
    }
  });

  ipcMain.handle('git:worktrees', (_event, { cwd }) => getGitWorktrees(cwd));
  ipcMain.handle('git:status', (_event, { cwd }) => getGitStatus(cwd));
  ipcMain.handle('git:diff', (_event, { cwd, filePath, isStaged }) => getGitDiff(cwd, filePath, isStaged));
  ipcMain.handle('git:stage', (_event, { cwd, filePath }) => runGitCommand(['add', filePath], cwd));
  ipcMain.handle('git:unstage', (_event, { cwd, filePath }) => runGitCommand(['reset', 'HEAD', '--', filePath], cwd));
  ipcMain.handle('git:stage-all', (_event, { cwd }) => runGitCommand(['add', '-A'], cwd));
  ipcMain.handle('git:unstage-all', (_event, { cwd }) => runGitCommand(['reset', 'HEAD'], cwd));
  ipcMain.handle('git:discard-all', async (_event, { cwd }) => {
    await runGitCommand(['checkout', '--', '.'], cwd);
    await runGitCommand(['clean', '-fd'], cwd);
  });
  ipcMain.handle('git:discard', async (_event, { cwd, filePath, isUntracked }) => {
    if (isUntracked) {
      const fullPath = join(cwd, filePath);
      const fileStat = await stat(fullPath);
      if (fileStat.isDirectory()) {
        await rm(fullPath, { recursive: true, force: true });
      } else {
        await unlink(fullPath);
      }
    } else {
      await runGitCommand(['checkout', '--', filePath], cwd);
    }
  });
  ipcMain.handle('git:commit', (_event, { cwd, message }) => runGitCommand(['commit', '-m', message], cwd));
  ipcMain.handle('git:history', (_event, { cwd }) => runGitCommand(['log', '--all', '--date-order', '--pretty=format:%H|%P|%d|%s|%an|%cr|%ct', '-n', '100'], cwd));
  ipcMain.handle('git:init', (_event, { cwd }) => runGitCommand(['init'], cwd));
  ipcMain.handle('git:undo-last-commit', async (_event, { cwd }) => {
    let message = '';
    try {
      message = await runGitCommand(['log', '-1', '--pretty=%B'], cwd);
    } catch (e) {
      // ignore
    }
    await runGitCommand(['reset', '--soft', 'HEAD~1'], cwd);
    return message;
  });
}
