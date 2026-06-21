import { dirname, extname, join } from 'node:path';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import type {
  DirectoryEntry,
  DirectoryListRequest,
  DirectoryListResult,
  ImagePreviewRequest,
  ImagePreviewResult,
  TextFileReadRequest,
  TextFileReadResult,
  TextFileWriteRequest,
  TextFileWriteResult,
  FileSearchRequest,
  FileSearchResult,
  FileSearchResultEntry,
  FileSearchResultMatch,
  FindFilesRequest,
  FindFilesResult,
  FindFilesResultEntry
} from '../shared/ipcTypes';

const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml']
]);

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

function expandHomePath(path: string): string {
  if (path === '~') {
    return os.homedir();
  }

  if (path.startsWith(`~${process.platform === 'win32' ? '\\' : '/'}`)) {
    return join(os.homedir(), path.slice(2));
  }

  return path;
}

export async function listDirectory(request: DirectoryListRequest): Promise<DirectoryListResult> {
  const directoryPath = expandHomePath(request.path.trim());

  if (!directoryPath) {
    throw new Error('Enter a folder path.');
  }

  const directoryStat = await stat(directoryPath);

  if (!directoryStat.isDirectory()) {
    throw new Error('Path is not a folder.');
  }

  const dirents = await readdir(directoryPath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .map(async (dirent): Promise<DirectoryEntry> => {
        const entryPath = join(directoryPath, dirent.name);
        const entryStat = await stat(entryPath);

        return {
          name: dirent.name,
          path: entryPath,
          type: dirent.isDirectory() ? 'directory' : 'file',
          size: entryStat.size,
          createdAt: entryStat.birthtimeMs,
          modifiedAt: entryStat.mtimeMs
        };
      })
  );

  entries.sort((first, second) => {
    if (first.type !== second.type) {
      return first.type === 'directory' ? -1 : 1;
    }

    const firstTime = first.createdAt || first.modifiedAt || 0;
    const secondTime = second.createdAt || second.modifiedAt || 0;

    if (firstTime !== secondTime) {
      return secondTime - firstTime;
    }

    return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
  });

  return {
    path: directoryPath,
    parentPath: dirname(directoryPath) !== directoryPath ? dirname(directoryPath) : undefined,
    entries
  };
}

export async function getImagePreview(request: ImagePreviewRequest): Promise<ImagePreviewResult> {
  const imagePath = expandHomePath(request.path.trim());
  const extension = extname(imagePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES.get(extension);

  if (!imagePath || !mimeType) {
    throw new Error('Preview unavailable.');
  }

  const imageStat = await stat(imagePath);

  if (!imageStat.isFile() || imageStat.size > MAX_PREVIEW_BYTES) {
    throw new Error('Preview unavailable.');
  }

  const data = await readFile(imagePath);

  return {
    dataUrl: `data:${mimeType};base64,${data.toString('base64')}`
  };
}

export async function readTextFile(request: TextFileReadRequest): Promise<TextFileReadResult> {
  const filePath = expandHomePath(request.path.trim());

  if (!filePath) {
    throw new Error('Enter a file path.');
  }

  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error('Path is not a file.');
  }

  if (fileStat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('File is too large to edit in Carogent.');
  }

  const data = await readFile(filePath);

  if (data.includes(0)) {
    throw new Error('Binary files are not supported.');
  }

  return {
    path: filePath,
    content: data.toString('utf8'),
    modifiedAt: fileStat.mtimeMs
  };
}

export async function writeTextFile(request: TextFileWriteRequest): Promise<TextFileWriteResult> {
  const filePath = expandHomePath(request.path.trim());

  if (!filePath) {
    throw new Error('Enter a file path.');
  }

  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error('Path is not a file.');
  }

  if (Buffer.byteLength(request.content, 'utf8') > MAX_TEXT_FILE_BYTES) {
    throw new Error('File is too large to edit in Carogent.');
  }

  if (request.content.includes('\0')) {
    throw new Error('Binary files are not supported.');
  }

  await writeFile(filePath, request.content, 'utf8');

  const nextStat = await stat(filePath);

  return {
    path: filePath,
    modifiedAt: nextStat.mtimeMs
  };
}

export async function searchFiles(request: FileSearchRequest): Promise<FileSearchResult> {
  const rootPath = expandHomePath(request.rootPath.trim());
  const query = request.query;

  if (!rootPath) {
    throw new Error('Enter a root path.');
  }
  if (!query) {
    return { results: [], totalResults: 0, totalFiles: 0 };
  }

  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error('Root path is not a directory.');
  }

  const caseSensitive = !!request.caseSensitive;
  const wholeWord = !!request.wholeWord;
  const useRegex = !!request.useRegex;

  // 1. Check if it's a git repository
  let isGitRepo = false;
  try {
    const { stdout: isGitStdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: rootPath });
    if (isGitStdout.trim() === 'true') {
      isGitRepo = true;
    }
  } catch {
    isGitRepo = false;
  }

  let stdout = '';
  if (isGitRepo) {
    const args = ['grep', '-n', '-I', '--untracked'];
    if (!caseSensitive) args.push('-i');
    if (wholeWord) args.push('-w');
    if (useRegex) {
      args.push('-E');
    } else {
      args.push('-F');
    }
    args.push('-e', query);

    try {
      const result = await execFileAsync('git', args, { cwd: rootPath, maxBuffer: 15 * 1024 * 1024 });
      stdout = result.stdout;
    } catch (err: any) {
      // If code is 1, it means no matches found (this is not an error)
      if (err.code !== 1) {
        isGitRepo = false;
      }
    }
  }

  let regex: RegExp | null = null;
  if (useRegex || wholeWord) {
    try {
      let flags = 'g';
      if (!caseSensitive) flags += 'i';
      let pattern = query;
      if (wholeWord) {
        const escaped = useRegex ? query : query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        pattern = `\\b${escaped}\\b`;
      } else if (!useRegex) {
        pattern = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      }
      regex = new RegExp(pattern, flags);
    } catch (e: any) {
      throw new Error(`Invalid regular expression: ${e.message}`);
    }
  }

  const results: FileSearchResultEntry[] = [];
  let totalResults = 0;
  let totalFiles = 0;

  if (isGitRepo) {
    const lines = stdout.split(/\r?\n/);
    const fileEntriesMap = new Map<string, FileSearchResultMatch[]>();

    for (const line of lines) {
      if (!line) continue;
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (!match) continue;

      const [, relPath, lineNumStr, lineContent] = match;
      const lineNumber = parseInt(lineNumStr, 10);
      const absPath = join(rootPath, relPath);

      const fileMatches = fileEntriesMap.get(absPath) || [];

      if (regex) {
        regex.lastIndex = 0;
        const matches = [...lineContent.matchAll(regex)];
        for (const m of matches) {
          if (m.index !== undefined) {
            fileMatches.push({
              lineNumber,
              lineContent,
              matchIndex: m.index,
              matchLength: m[0].length
            });
          }
        }
      } else {
        let pos = 0;
        const lowerLine = caseSensitive ? lineContent : lineContent.toLowerCase();
        const lowerQuery = caseSensitive ? query : query.toLowerCase();
        while (true) {
          const matchIdx = lowerLine.indexOf(lowerQuery, pos);
          if (matchIdx === -1) break;
          fileMatches.push({
            lineNumber,
            lineContent,
            matchIndex: matchIdx,
            matchLength: query.length
          });
          pos = matchIdx + query.length;
        }
      }

      if (fileMatches.length > 0) {
        fileEntriesMap.set(absPath, fileMatches);
      }
    }

    for (const [filePath, fileMatches] of fileEntriesMap.entries()) {
      let relativeFilePath = filePath.slice(rootPath.length);
      if (relativeFilePath.startsWith('/') || relativeFilePath.startsWith('\\')) {
        relativeFilePath = relativeFilePath.slice(1);
      }

      results.push({
        filePath,
        relativeFilePath,
        matches: fileMatches
      });

      totalResults += fileMatches.length;
      totalFiles++;
    }
  } else {
    // Manual search fallback
    const excludeDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
      '.next',
      '.nuxt',
      'bower_components',
      'tmp',
      'temp',
      '.DS_Store'
    ]);

    const files: string[] = [];
    const queue: string[] = [rootPath];

    while (queue.length > 0) {
      const currentDir = queue.shift()!;
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.gitignore') {
            if (entry.isDirectory() && entry.name === '.git') continue;
            if (entry.isDirectory() && entry.name.startsWith('.')) continue;
          }
          const fullPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (excludeDirs.has(entry.name)) {
              continue;
            }
            queue.push(fullPath);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      } catch {
        // Ignore folder read errors
      }
    }

    const CONCURRENCY_LIMIT = 50;
    for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
      const batch = files.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(
        batch.map(async (filePath) => {
          try {
            const fileStat = await stat(filePath);
            if (fileStat.size > MAX_TEXT_FILE_BYTES) return;

            const data = await readFile(filePath);
            if (data.includes(0)) return;

            const content = data.toString('utf8');
            const lines = content.split(/\r?\n/);
            const fileMatches: FileSearchResultMatch[] = [];

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
              const line = lines[lineIndex];

              if (regex) {
                regex.lastIndex = 0;
                const matches = [...line.matchAll(regex)];
                for (const m of matches) {
                  if (m.index !== undefined) {
                    fileMatches.push({
                      lineNumber: lineIndex + 1,
                      lineContent: line,
                      matchIndex: m.index,
                      matchLength: m[0].length
                    });
                  }
                }
              } else {
                let pos = 0;
                const lowerLine = caseSensitive ? line : line.toLowerCase();
                const lowerQuery = caseSensitive ? query : query.toLowerCase();
                while (true) {
                  const matchIdx = lowerLine.indexOf(lowerQuery, pos);
                  if (matchIdx === -1) break;
                  fileMatches.push({
                    lineNumber: lineIndex + 1,
                    lineContent: line,
                    matchIndex: matchIdx,
                    matchLength: query.length
                  });
                  pos = matchIdx + query.length;
                }
              }
            }

            if (fileMatches.length > 0) {
              let relativeFilePath = filePath.slice(rootPath.length);
              if (relativeFilePath.startsWith('/') || relativeFilePath.startsWith('\\')) {
                relativeFilePath = relativeFilePath.slice(1);
              }

              results.push({
                filePath,
                relativeFilePath,
                matches: fileMatches
              });

              totalResults += fileMatches.length;
              totalFiles++;
            }
          } catch {
            // Ignore file read errors
          }
        })
      );
    }
  }

  // Sort files by relative path
  results.sort((a, b) => a.relativeFilePath.localeCompare(b.relativeFilePath));

  return {
    results,
    totalResults,
    totalFiles
  };
}

function isSubsequence(needle: string, haystack: string): boolean {
  let needleIndex = 0;
  for (let i = 0; i < haystack.length; i++) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex++;
      if (needleIndex === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}

export async function findFiles(request: FindFilesRequest): Promise<FindFilesResult> {
  const rootPath = expandHomePath(request.rootPath.trim());
  let query = request.query.trim().toLowerCase();

  if (!rootPath) {
    throw new Error('Enter a root path.');
  }

  const normalizedRoot = rootPath.replace(/\\/g, '/').toLowerCase();
  const normalizedQuery = query.replace(/\\/g, '/');

  // Strip absolute root path if the query is an absolute path starting with it
  if (normalizedQuery.startsWith(normalizedRoot)) {
    query = normalizedQuery.slice(normalizedRoot.length);
    if (query.startsWith('/')) {
      query = query.slice(1);
    }
  }

  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error('Root path is not a directory.');
  }

  const excludeDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    'bower_components',
    'tmp',
    'temp',
    '.DS_Store'
  ]);

  const results: FindFilesResultEntry[] = [];
  const queue: string[] = [rootPath];
  const maxResults = 100;

  while (queue.length > 0 && results.length < maxResults) {
    const currentDir = queue.shift()!;
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;

        if (entry.name.startsWith('.') && entry.name !== '.gitignore') {
          if (entry.isDirectory() && entry.name === '.git') continue;
          if (entry.isDirectory() && entry.name.startsWith('.')) continue;
        }

        const fullPath = join(currentDir, entry.name);
        const nameLower = entry.name.toLowerCase();

        // Compute relative path
        let relativeFilePath = fullPath.slice(rootPath.length);
        if (relativeFilePath.startsWith('/') || relativeFilePath.startsWith('\\')) {
          relativeFilePath = relativeFilePath.slice(1);
        }

        const relativeLower = relativeFilePath.replace(/\\/g, '/').toLowerCase();

        if (entry.isDirectory()) {
          if (excludeDirs.has(entry.name)) {
            continue;
          }
          queue.push(fullPath);

          if (query) {
            const terms = query.split(/\s+/).filter(Boolean);
            const matchesAll = terms.every((term) => isSubsequence(term, relativeLower));
            if (matchesAll) {
              results.push({
                name: entry.name,
                path: fullPath,
                relativeFilePath,
                type: 'directory'
              });
            }
          }
        } else if (entry.isFile()) {
          const terms = query.split(/\s+/).filter(Boolean);
          const matchesAll = terms.every((term) => isSubsequence(term, relativeLower));
          if (matchesAll) {
            results.push({
              name: entry.name,
              path: fullPath,
              relativeFilePath,
              type: 'file'
            });
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Sort results by name, then by relative path length
  results.sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.relativeFilePath.localeCompare(b.relativeFilePath);
  });

  return { results };
}
