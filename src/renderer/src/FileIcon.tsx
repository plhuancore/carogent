import React from 'react';

interface FileIconProps {
  filename: string;
  isDirectory?: boolean;
  className?: string;
  size?: number;
}

export const FileIcon: React.FC<FileIconProps> = ({
  filename,
  isDirectory = false,
  className = '',
  size = 16
}) => {
  if (isDirectory) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M1.75 4.75V12.25C1.75 12.8023 2.19772 13.25 2.75 13.25H13.25C13.8023 13.25 14.25 12.8023 14.25 12.25V4.75C14.25 4.19772 13.8023 3.75 13.25 3.75H8.25L6.75 2.25H2.75C2.19772 2.25 1.75 2.69772 1.75 3.25V4.75Z"
          fill="#E0A92E"
        />
        <path
          d="M1.75 5.75H14.25V12.25C14.25 12.8023 13.8023 13.25 13.25 13.25H2.75C2.19772 13.25 1.75 12.8023 1.75 12.25V5.75Z"
          fill="#F4C042"
        />
      </svg>
    );
  }

  const nameLower = filename.toLowerCase();

  // Custom icon for GEMINI.md
  if (nameLower.includes('gemini')) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1.5c.15 2 .7 3.5 2.2 4.3C8.7 6.6 8.15 8 8 14.5c-.15-6.5-.7-7.9-2.2-8.7C7.3 5 7.85 3.5 8 1.5z" fill="#58a6ff" />
        <path d="M12.5 3.5c.07 1 .33 1.75 1.1 2.15-.77.4-1.03 1.15-1.1 2.15-.07-1-.33-1.75-1.1-2.15.77-.4 1.03-1.15 1.1-2.15z" fill="#58a6ff" />
      </svg>
    );
  }

  if (nameLower === 'package.json' || nameLower === 'package-lock.json') {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1.5l5.2 3v6.6l-5.2 3.4L2.8 11.1V4.5L8 1.5z" fill="#83CD29" />
        <path d="M5 6.5h6v3H9.5v-2H8.5v2H5v-3z" fill="white" />
      </svg>
    );
  }

  if (nameLower.startsWith('.git')) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.8 6.5L9.5 2.2c-.3-.3-.8-.3-1.1 0L4.1 6.5c-.3.3-.3.8 0 1.1l4.3 4.3c.3.3.8.3 1.1 0l4.3-4.3c.3-.3.3-.8 0-1.1z" fill="#F05032" />
        <circle cx="7.5" cy="7.5" r="1.1" fill="white" />
        <circle cx="10" cy="7.5" r="1.1" fill="white" />
        <circle cx="7.5" cy="10" r="1.1" fill="white" />
        <path d="M7.5 7.5v2.5M7.5 7.5H10" stroke="white" strokeWidth="0.9" />
      </svg>
    );
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'ts':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#3178C6" />
          <text x="2" y="11.5" fill="white" fontSize="9" fontWeight="800" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-0.5">TS</text>
        </svg>
      );
    case 'tsx':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="8" cy="8" rx="6.5" ry="2.2" stroke="#00d8ff" strokeWidth="1.2" transform="rotate(30 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.2" stroke="#00d8ff" strokeWidth="1.2" transform="rotate(90 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.2" stroke="#00d8ff" strokeWidth="1.2" transform="rotate(150 8 8)" />
          <circle cx="8" cy="8" r="1.2" fill="#00d8ff" />
        </svg>
      );
    case 'js':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#F7DF1E" />
          <text x="2.5" y="11.5" fill="#303030" fontSize="9.5" fontWeight="800" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-0.5">JS</text>
        </svg>
      );
    case 'jsx':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="8" cy="8" rx="6.5" ry="2.2" stroke="#f7df1e" strokeWidth="1.2" transform="rotate(30 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.2" stroke="#f7df1e" strokeWidth="1.2" transform="rotate(90 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.2" stroke="#f7df1e" strokeWidth="1.2" transform="rotate(150 8 8)" />
          <circle cx="8" cy="8" r="1.2" fill="#f7df1e" />
        </svg>
      );
    case 'css':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12" stroke="#c59ee7" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'json':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.5 2.5c-1 0-1.5.5-1.5 1.5v3c0 .5-.5 1-1 1 .5 0 1 .5 1 1v3c0 1 .5 1.5 1.5 1.5M10.5 2.5c1 0 1.5.5 1.5 1.5v3c0 .5.5 1 1 1-.5 0-1 .5-1 1v3c0 1-.5 1.5-1.5 1.5" stroke="#f4c042" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'md':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.5 1.5h11C14 1.5 14.5 2 14.5 2.5v11c0 .5-.5 1-1 1h-11c-.5 0-1-.5-1-1v-11c0-.5.5-1 1-1z" fill="#007acc" />
          <path d="M4 5.5h1.5l1 1.3 1-1.3H9v5H7.8V7.5L6.8 8.7l-1-1.2v3H4v-5zM11 5.5H12V8h1.2l-1.7 2.2L9.8 8H11V5.5z" fill="white" />
        </svg>
      );
    case 'html':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1.5 1.5l1.2 11.5 5.3 1.5 5.3-1.5 1.2-11.5H1.5z" fill="#E34F26" />
          <path d="M8 2.7v9.8l4-.8.9-8.5H8z" fill="#EF652A" />
          <path d="M8 5.7h2.2l-.2 1.8H8v1.3h2l-.2 2-1.8.5V9.8l.9-.2.2-1.8H8V5.7z M8 5.7H5.8l-.1 1.8H8v-1.8z" fill="white" />
          <path d="M8 8.8H6.1l.1.8.2.8 1.6-.4v-1.2z" fill="#E1E1E1" />
        </svg>
      );
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.5 1.5h11C14 1.5 14.5 2 14.5 2.5v11c0 .5-.5 1-1 1h-11c-.5 0-1-.5-1-1v-11c0-.5.5-1 1-1z" fill="#15A2B8" />
          <circle cx="5.5" cy="5.5" r="1.5" fill="white" />
          <path d="M3.2 12.5l3.3-4.5 2.8 2.7 1.4-1.4 2.1 3.2H3.2z" fill="white" />
        </svg>
      );
    case 'yml':
    case 'yaml':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#CB171E" />
          <path d="M5 5.5L6.5 7.5V10.5H7.5V7.5L9 5.5H7.8L7 6.8L6.2 5.5H5z" fill="white" />
        </svg>
      );
    default:
      return (
        <svg
          className={className}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 2.5C3 1.94772 3.44772 1.5 4 1.5H9.5L13 5V13.5C13 14.0523 12.5523 14.5 12 14.5H4C3.44772 14.5 3 14.0523 3 13.5V2.5Z"
            fill="#7B8A99"
          />
          <path d="M9.5 1.5V5H13L9.5 1.5Z" fill="#506070" />
        </svg>
      );
  }
};
