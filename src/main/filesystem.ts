import { dirname, extname, join } from 'node:path';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type {
  DirectoryEntry,
  DirectoryListRequest,
  DirectoryListResult,
  ImagePreviewRequest,
  ImagePreviewResult,
  TextFileReadRequest,
  TextFileReadResult,
  TextFileWriteRequest,
  TextFileWriteResult
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
