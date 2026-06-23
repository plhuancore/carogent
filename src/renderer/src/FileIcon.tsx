import React from 'react';

function iconPath(name: string): string {
  try {
    // Resolve relative to window.location.href (which points to index.html's location).
    // This handles both http://localhost:5173/ in dev and file:///.../out/renderer/index.html in prod,
    // avoiding the issue where '/icons/...' resolves to the filesystem root 'file:///icons/...' on file://.
    return new URL(`icons/${name}`, window.location.href).href;
  } catch {
    return `/icons/${name}`;
  }
}

interface FileIconProps {
  filename: string;
  isDirectory?: boolean;
  isOpen?: boolean;
  className?: string;
  size?: number;
}

export const FileIcon: React.FC<FileIconProps> = ({
  filename,
  isDirectory = false,
  isOpen = false,
  className = '',
  size = 16
}) => {
  const nameLower = filename.toLowerCase();

  if (isDirectory) {
    // Map folder names to specific folder icons in Material Icon Theme
    let folderIconName = 'folder';
    
    // Check common folder names
    if (nameLower === 'src') {
      folderIconName = 'folder-src';
    } else if (nameLower === 'components') {
      folderIconName = 'folder-components';
    } else if (nameLower === 'git' || nameLower === '.git') {
      folderIconName = 'folder-git';
    } else if (nameLower === 'node_modules') {
      folderIconName = 'folder-node';
    } else if (nameLower === 'public') {
      folderIconName = 'folder-public';
    } else if (nameLower === 'assets') {
      folderIconName = 'folder-images';
    } else if (nameLower === 'dist' || nameLower === 'build' || nameLower === 'out') {
      folderIconName = 'folder-dist';
    } else if (nameLower === 'styles' || nameLower === 'css') {
      folderIconName = 'folder-css';
    } else if (nameLower === 'test' || nameLower === 'tests' || nameLower === '__tests__') {
      folderIconName = 'folder-test';
    } else if (nameLower === 'scripts') {
      folderIconName = 'folder-scripts';
    } else if (nameLower === 'vscode' || nameLower === '.vscode') {
      folderIconName = 'folder-vscode';
    } else if (nameLower === 'routes' || nameLower === 'pages') {
      folderIconName = 'folder-routes';
    } else if (nameLower === 'views') {
      folderIconName = 'folder-views';
    } else if (nameLower === 'layout') {
      folderIconName = 'folder-layout';
    } else if (nameLower === 'utils' || nameLower === 'helpers') {
      folderIconName = 'folder-utils';
    } else if (nameLower === 'config' || nameLower === '.github') {
      folderIconName = 'folder-config';
    } else if (nameLower === 'electron') {
      folderIconName = 'folder-electron';
    }

    const suffix = isOpen ? '-open' : '';
    const srcPath = iconPath(`${folderIconName}${suffix}.svg`);

    return (
      <img
        src={srcPath}
        alt="folder icon"
        className={className}
        width={size}
        height={size}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    );
  }

  // File icons
  let fileIconName = 'file';

  // Check specific filenames first
  if (nameLower === 'package.json') {
    fileIconName = 'nodejs';
  } else if (nameLower === 'package-lock.json') {
    fileIconName = 'nodejs';
  } else if (nameLower === 'tsconfig.json') {
    fileIconName = 'tsconfig';
  } else if (nameLower === 'jsconfig.json') {
    fileIconName = 'jsconfig';
  } else if (nameLower === 'vite.config.ts' || nameLower === 'vite.config.js') {
    fileIconName = 'vite';
  } else if (nameLower === 'webpack.config.js' || nameLower === 'webpack.config.ts') {
    fileIconName = 'webpack';
  } else if (nameLower === 'gitignore' || nameLower === '.gitignore' || nameLower === '.gitattributes') {
    fileIconName = 'git';
  } else if (nameLower === 'gemini.md' || nameLower === 'gemini.json') {
    fileIconName = 'gemini';
  } else if (nameLower === 'agents.md' || nameLower === 'agagents.md') {
    fileIconName = 'copilot';
  } else if (nameLower === 'license' || nameLower === 'license.txt' || nameLower === 'license.md') {
    fileIconName = 'license';
  } else if (nameLower === 'readme.md') {
    fileIconName = 'readme';
  } else if (nameLower === 'changelog.md') {
    fileIconName = 'changelog';
  } else {
    // Check by extension
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'ts':
        fileIconName = 'typescript';
        break;
      case 'tsx':
        fileIconName = 'react_ts';
        break;
      case 'js':
        fileIconName = 'javascript';
        break;
      case 'jsx':
        fileIconName = 'react';
        break;
      case 'css':
        fileIconName = 'css';
        break;
      case 'scss':
      case 'sass':
        fileIconName = 'sass';
        break;
      case 'less':
        fileIconName = 'less';
        break;
      case 'json':
        fileIconName = 'json';
        break;
      case 'md':
      case 'markdown':
        fileIconName = 'markdown';
        break;
      case 'html':
        fileIconName = 'html';
        break;
      case 'py':
        fileIconName = 'python';
        break;
      case 'go':
        fileIconName = 'go';
        break;
      case 'rs':
        fileIconName = 'rust';
        break;
      case 'sh':
      case 'bash':
      case 'zsh':
        fileIconName = 'console';
        break;
      case 'yml':
      case 'yaml':
        fileIconName = 'yaml';
        break;
      case 'xml':
        fileIconName = 'xml';
        break;
      case 'sql':
        fileIconName = 'database';
        break;
      case 'java':
        fileIconName = 'java';
        break;
      case 'rb':
        fileIconName = 'ruby';
        break;
      case 'php':
        fileIconName = 'php';
        break;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'webp':
      case 'ico':
        fileIconName = 'image';
        break;
      case 'pdf':
        fileIconName = 'pdf';
        break;
      case 'zip':
      case 'tar':
      case 'gz':
      case 'rar':
      case '7z':
        fileIconName = 'zip';
        break;
      case 'txt':
        fileIconName = 'document';
        break;
      default:
        fileIconName = 'file';
        break;
    }
  }

  const srcPath = iconPath(`${fileIconName}.svg`);

  return (
    <img
      src={srcPath}
      alt="file icon"
      className={className}
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
};
