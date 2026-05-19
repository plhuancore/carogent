import { createInitialLayout, isLayoutNode, LayoutNode } from './layout';

const STORAGE_KEY = 'carogent-terminal-layout';

export function loadLayout(): LayoutNode {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return createInitialLayout();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return isLayoutNode(parsed) ? parsed : createInitialLayout();
  } catch {
    return createInitialLayout();
  }
}

export function saveLayout(layout: LayoutNode): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}
