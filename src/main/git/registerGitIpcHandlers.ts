import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export function registerGitIpcHandlers(): void {
  // Git Helper Functions and IPC Handlers
  const GIT_DIFF_PREVIEW_MAX_BYTES = 1024 * 1024;
  const GIT_DIFF_PREVIEW_MAX_LINES = 5000;
  const GIT_COMMIT_FILES_PREVIEW_LIMIT = 400;
  const GIT_WATCH_DEBOUNCE_MS = 450;
  const GIT_WATCH_MAX_DIRECTORIES = 2000;
  const GIT_UNTRACKED_DIRECTORY_PREVIEW_LIMIT = 200;

  type GitWatchState = {
    cwd: string;
    watchers: FSWatcher[];
    timeout: NodeJS.Timeout | null;
  };

  const gitWatchers = new Map<number, GitWatchState>();

  function runGitCommand(
    args: string[],
    cwd: string,
    options: { maxStdoutBytes?: number; truncatedMessage?: string } = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd });
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stdoutTruncated = false;
      child.stdout.on('data', (data) => {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (!options.maxStdoutBytes) {
          stdout += chunk.toString();
          return;
        }

        const remainingBytes = options.maxStdoutBytes - stdoutBytes;
        if (remainingBytes <= 0) {
          if (!stdoutTruncated) {
            stdoutTruncated = true;
            child.kill();
          }
          return;
        }

        const clippedChunk = chunk.subarray(0, remainingBytes);
        stdout += clippedChunk.toString();
        stdoutBytes += clippedChunk.length;
        if (clippedChunk.length < chunk.length) {
          if (!stdoutTruncated) {
            stdoutTruncated = true;
            child.kill();
          }
        }
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        if (code === 0 || stdoutTruncated) {
          const truncatedMessage = stdoutTruncated && options.truncatedMessage
            ? `\n\n${options.truncatedMessage}`
            : '';
          resolve(`${stdout.trimEnd()}${truncatedMessage}`);
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

  function getNewPathFromRename(path: string): string {
    if (!path.includes('=>')) return path;
    const match = path.match(/^(.*)\{(.*)\s*=>\s*(.*)\}(.*)$/);
    if (match) {
      const prefix = match[1];
      const newPart = match[3].trim();
      const suffix = match[4];
      return `${prefix}${newPart}${suffix}`.replace(/\/+/g, '/');
    }
    const parts = path.split('=>');
    return parts[parts.length - 1].trim();
  }

  function parseNumstatLine(line: string): { additions: number; deletions: number; path: string } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parts = trimmed.split('\t');
    if (parts.length < 3) return null;
    const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
    return { additions, deletions, path: parts[2] };
  }

  function getGitCommitFiles(cwd: string, hash: string): Promise<{ files: { additions: number; deletions: number; path: string }[]; hasMore: boolean }> {
    return new Promise<{ files: { additions: number; deletions: number; path: string }[]; hasMore: boolean }>((resolve, reject) => {
      const child = spawn('git', ['show', '--numstat', '--pretty=format:', hash], { cwd });
      const files: { additions: number; deletions: number; path: string }[] = [];
      let stderr = '';
      let pending = '';
      let hasMore = false;

      const parseCompleteLines = () => {
        let newlineIndex = pending.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = pending.slice(0, newlineIndex);
          pending = pending.slice(newlineIndex + 1);
          const parsed = parseNumstatLine(line);
          if (parsed) {
            if (files.length < GIT_COMMIT_FILES_PREVIEW_LIMIT) {
              files.push(parsed);
            } else {
              hasMore = true;
              child.kill();
              return;
            }
          }
          newlineIndex = pending.indexOf('\n');
        }
      };

      child.stdout.on('data', (data) => {
        if (hasMore) return;
        pending += data.toString();
        parseCompleteLines();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        if (!hasMore && pending) {
          const parsed = parseNumstatLine(pending);
          if (parsed) {
            if (files.length < GIT_COMMIT_FILES_PREVIEW_LIMIT) {
              files.push(parsed);
            } else {
              hasMore = true;
            }
          }
        }
        if (code === 0 || hasMore) {
          resolve({ files, hasMore });
        } else {
          reject(new Error(stderr.trim() || `Git command failed with exit code ${code}`));
        }
      });
      child.on('error', reject);
    }).catch((err: any) => {
      console.error('Failed to get commit files:', err);
      return { files: [], hasMore: false };
    });
  }

  async function getGitCommitFileDiff(cwd: string, hash: string, filePath: string) {
    try {
      const actualPath = getNewPathFromRename(filePath);
      const diff = await runGitCommand(
        ['show', '-m', '--pretty=format:', hash, '--', actualPath],
        cwd,
        {
          maxStdoutBytes: GIT_DIFF_PREVIEW_MAX_BYTES,
          truncatedMessage: '... Diff truncated: file diff is too large.'
        }
      );
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

    const isRecursiveSupported = process.platform === 'darwin' || process.platform === 'win32';

    if (isRecursiveSupported) {
      let gitDir: string;
      try {
        const gitDirRel = await runGitCommand(['rev-parse', '--git-dir'], cwd);
        gitDir = resolve(cwd, gitDirRel.trim());
      } catch {
        gitDir = join(cwd, '.git');
      }

      if (gitWatchers.get(webContentsId) !== state) return;

      // 1. Watch gitDir recursively for internal git status changes (HEAD, index, refs)
      if (existsSync(gitDir)) {
        try {
          const watcher = watch(gitDir, { recursive: true }, (eventType, filename) => {
            if (!filename) {
              sendChange();
              return;
            }
            const name = filename.toString().replace(/\\/g, '/');
            if (name === 'HEAD' || name === 'index' || name.startsWith('refs/')) {
              sendChange();
            }
          });
          watcher.on('error', (err: any) => {
            console.error(`Git folder watcher error for ${gitDir}:`, err);
          });
          state.watchers.push(watcher);
        } catch (err) {
          console.error(`Failed to watch gitDir ${gitDir}:`, err);
        }
      }

      if (gitWatchers.get(webContentsId) !== state) return;

      // 2. Watch cwd non-recursively for top-level additions/deletions/changes
      try {
        const watcher = watch(cwd, { recursive: false }, (eventType, filename) => {
          if (!filename) {
            sendChange();
            return;
          }
          const name = filename.toString();
          if (name !== 'node_modules' && name !== '.git' && name !== '.venv' && name !== 'venv' && !name.startsWith('.')) {
            sendChange();
          }
        });
        watcher.on('error', (err: any) => {
          console.error(`Cwd watcher error for ${cwd}:`, err);
        });
        state.watchers.push(watcher);
      } catch (err) {
        console.error(`Failed to watch cwd ${cwd}:`, err);
      }

      if (gitWatchers.get(webContentsId) !== state) return;

      // 3. Find git-tracked/untracked top-level directories to watch recursively (excluding ignored ones)
      const topLevelDirs = new Set<string>();
      try {
        const filesText = await runGitCommand(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd);
        if (gitWatchers.get(webContentsId) !== state) return;

        const files = filesText.split('\0').filter(Boolean);
        for (const file of files) {
          const normalized = file.replace(/\\/g, '/');
          if (!normalized.includes('/')) {
            continue;
          }
          const firstPart = normalized.split('/')[0];
          if (firstPart && firstPart !== 'node_modules' && firstPart !== '.git' && !firstPart.startsWith('.')) {
            topLevelDirs.add(firstPart);
          }
        }
      } catch (err) {
        console.error('Failed to get git-tracked top-level directories:', err);
        // Fallback: read all directories from filesystem
        if (gitWatchers.get(webContentsId) !== state) return;
        try {
          const entries = await readdir(cwd, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const name = entry.name;
              if (name !== 'node_modules' && name !== '.git' && name !== '.venv' && name !== 'venv' && !name.startsWith('.')) {
                topLevelDirs.add(name);
              }
            }
          }
        } catch {}
      }

      if (gitWatchers.get(webContentsId) !== state) return;

      // 4. Watch the resolved top-level directories recursively
      for (const dirName of topLevelDirs) {
        if (gitWatchers.get(webContentsId) !== state) break;
        const dirPath = join(cwd, dirName);
        try {
          const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
            if (!filename) {
              sendChange();
              return;
            }
            const absolutePath = join(dirPath, filename.toString());
            const relativePath = relative(cwd, absolutePath);
            if (shouldIgnoreWatchedPath(relativePath)) {
              return;
            }
            sendChange();
          });
          watcher.on('error', (err: any) => {
            console.error(`Recursive watcher error for ${dirPath}:`, err);
          });
          state.watchers.push(watcher);
        } catch (err) {
          console.error(`Failed to watch directory ${dirPath} recursively:`, err);
        }
      }
    } else {
      // Fallback for Linux or platforms where recursive watch is not natively supported
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
    }
  });

  ipcMain.handle('git:worktrees', (_event, { cwd }) => getGitWorktrees(cwd));
  ipcMain.handle('git:status', (_event, { cwd }) => getGitStatus(cwd));
  ipcMain.handle('git:diff', (_event, { cwd, filePath, isStaged }) => getGitDiff(cwd, filePath, isStaged));
  ipcMain.handle('git:commit-files', (_event, { cwd, hash }) => getGitCommitFiles(cwd, hash));
  ipcMain.handle('git:commit-file-diff', (_event, { cwd, hash, filePath }) => getGitCommitFileDiff(cwd, hash, filePath));
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
