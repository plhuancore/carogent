export type CommandPaletteIconType =
  | 'browser'
  | 'code'
  | 'quick-access'
  | 'agent-overlay'
  | 'git'
  | 'folder'
  | 'search';

export function SearchIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function MenuIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function ParentFolderIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m6.25 5.75-3 3 3 3" />
      <path d="M3.5 8.75h9" />
      <path d="M12.5 8.75V4.5H7.25" />
    </svg>
  );
}

export function FileTreeIcon({ type }: { type: 'file' | 'directory' }): JSX.Element {
  if (type === 'directory') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M1.75 5.25h12.5v7.25a1.25 1.25 0 0 1-1.25 1.25H3a1.25 1.25 0 0 1-1.25-1.25z" />
        <path d="M1.75 5.25V3.75A1.25 1.25 0 0 1 3 2.5h3l1.25 1.5H13a1.25 1.25 0 0 1 1.25 1.25" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4 2.25h5.25L12.5 5.5v8.25H4z" />
      <path d="M9.25 2.25V5.5h3.25" />
    </svg>
  );
}

export function SplitRightIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

export function SplitDownIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 15h18" />
    </svg>
  );
}

export function ShellIcon({ name }: { name: string }): JSX.Element {
  if (name === 'powershell') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <rect className="shell-icon-bg" x="1.75" y="3" width="12.5" height="10" rx="1.5" />
        <path d="m5 6 2 2-2 2" />
        <path d="M8.25 10h3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1" />
      <path d="m4.75 6.5 1.65 1.5-1.65 1.5" />
      <path d="M7.7 9.5h3.35" />
    </svg>
  );
}

export function ChevronDownIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

export function ChevronUpIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.5 9.75 3.5-3.5 3.5 3.5" />
    </svg>
  );
}

export function SettingsIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
      <path d="M18.2 13.3c.08-.42.12-.85.12-1.3s-.04-.88-.12-1.3l2.05-1.6-2-3.46-2.42.98a7.3 7.3 0 0 0-2.25-1.3L13.2 2.75h-4l-.38 2.57a7.3 7.3 0 0 0-2.25 1.3l-2.42-.98-2 3.46 2.05 1.6a7 7 0 0 0 0 2.6l-2.05 1.6 2 3.46 2.42-.98a7.3 7.3 0 0 0 2.25 1.3l.38 2.57h4l.38-2.57a7.3 7.3 0 0 0 2.25-1.3l2.42.98 2-3.46-2.05-1.6Z" />
    </svg>
  );
}

export function AgentOverlayIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <rect className="icon-accent" x="7.5" y="7.5" width="5" height="5" rx="1" />
    </svg>
  );
}

export function QuickAccessIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
      <path d="M4.75 6.25h4.5" />
      <path d="M4.75 8h6.5" />
      <path d="M4.75 9.75h3.5" />
    </svg>
  );
}

export function BrowserIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.75 8h10.5" />
      <path d="M8 2.25c1.5 1.55 2.25 3.47 2.25 5.75S9.5 12.2 8 13.75" />
      <path d="M8 2.25C6.5 3.8 5.75 5.72 5.75 8s.75 4.2 2.25 5.75" />
    </svg>
  );
}

export function CodeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m6.25 4.75-3 3.25 3 3.25" />
      <path d="m9.75 4.75 3 3.25-3 3.25" />
      <path d="m8.85 3.5-1.7 9" />
    </svg>
  );
}

export function GitIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <line x1="4" y1="6" x2="4" y2="10" />
      <path d="M12 6a6 6 0 0 1-6 6" />
      <circle cx="4" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="4" r="2" />
    </svg>
  );
}

export function CommandPaletteIcon({ type }: { type: CommandPaletteIconType }): JSX.Element {
  if (type === 'browser') {
    return <BrowserIcon />;
  }

  if (type === 'code') {
    return <CodeIcon />;
  }

  if (type === 'agent-overlay') {
    return <AgentOverlayIcon />;
  }

  if (type === 'git') {
    return <GitIcon />;
  }

  if (type === 'folder') {
    return <FileTreeIcon type="directory" />;
  }

  if (type === 'search') {
    return <SearchIcon />;
  }

  return <QuickAccessIcon />;
}

export function McpIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
      <line x1="6" y1="6" x2="6.01" y2="6"></line>
      <line x1="6" y1="18" x2="6.01" y2="18"></line>
    </svg>
  );
}

export function MaximizeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
    </svg>
  );
}

export function MinimizeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4.5 1.5v3h-3M11.5 1.5v3h3M11.5 14.5v-3h3M4.5 14.5v-3h-3" />
    </svg>
  );
}

export function RefreshIcon({ className }: { className?: string } = {}): JSX.Element {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 16 16">
      <path d="M13.5 10a6 6 0 1 1-1.5-6.5L15 6" />
      <path d="M15 2v4h-4" />
    </svg>
  );
}

export function NewFileIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M3.75 2.25h5.5L12.25 5.25v8.5h-8.5z" />
      <path d="M9.25 2.25v3h3" />
      <path d="M8 7.25v4" />
      <path d="M6 9.25h4" />
    </svg>
  );
}

export function NewFolderIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M1.75 5.25h12.5v7.25a1.25 1.25 0 0 1-1.25 1.25H3a1.25 1.25 0 0 1-1.25-1.25z" />
      <path d="M1.75 5.25V3.75A1.25 1.25 0 0 1 3 2.5h3l1.25 1.5H13a1.25 1.25 0 0 1 1.25 1.25" />
      <path d="M8 7.25v4" />
      <path d="M6 9.25h4" />
    </svg>
  );
}

export function CollapseAllIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M3.5 5.5h9" />
      <path d="m5 9.5 3-3 3 3" />
      <path d="M3.5 12.5h9" />
    </svg>
  );
}

export function WrenchIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
    </svg>
  );
}

export function OpenFileIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: '13px', height: '13px' }}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    </svg>
  );
}
