import React, { useEffect, useState, useRef } from 'react';
import { ThemeId, THEMES, applyTheme } from '../theme';

interface ThemeSelectorModalProps {
  activeTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
  onClose: () => void;
  onThemePreview?: (themeId: ThemeId) => void;
}

export function ThemeSelectorModal({
  activeTheme,
  onSelectTheme,
  onClose,
  onThemePreview
}: ThemeSelectorModalProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(
    THEMES.findIndex((t) => t.id === activeTheme)
  );

  const modalRef = useRef<HTMLDivElement>(null);

  // Capture global key events while the modal is active
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Restore original theme and close
        applyTheme(activeTheme);
        if (onThemePreview) {
          onThemePreview(activeTheme);
        }
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % THEMES.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + THEMES.length) % THEMES.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = THEMES[selectedIndex];
        if (selected) {
          onSelectTheme(selected.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedIndex, activeTheme, onSelectTheme, onClose, onThemePreview]);

  // Preview theme on index changes (keyboard navigation or mouse hover)
  useEffect(() => {
    const current = THEMES[selectedIndex];
    if (current) {
      applyTheme(current.id);
      if (onThemePreview) {
        onThemePreview(current.id);
      }
    }
  }, [selectedIndex, onThemePreview]);

  const handleSelect = (id: ThemeId): void => {
    onSelectTheme(id);
  };

  const handleHover = (index: number): void => {
    setSelectedIndex(index);
  };

  return (
    <div
      className="theme-selector-overlay"
      onMouseDown={() => {
        // Restore original theme and close on click outside
        applyTheme(activeTheme);
        if (onThemePreview) {
          onThemePreview(activeTheme);
        }
        onClose();
      }}
    >
      <div
        className="theme-selector-palette"
        ref={modalRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="theme-selector-header">
          <span className="theme-selector-title">Select Color Theme</span>
          <span className="theme-selector-hint">
            Use ↑↓ keys to preview, Enter to select, Esc to cancel
          </span>
        </div>
        <div className="theme-selector-list">
          {THEMES.map((theme, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                key={theme.id}
                className={`theme-selector-item ${isSelected ? 'is-selected' : ''}`}
                type="button"
                onMouseEnter={() => handleHover(index)}
                onClick={() => handleSelect(theme.id)}
              >
                <span className="theme-selector-item-indicator">
                  {theme.id === activeTheme ? '●' : ''}
                </span>
                <span className="theme-selector-item-name">{theme.name}</span>
                <span className="theme-selector-item-badge">
                  {theme.isDark ? 'Dark' : 'Light'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
