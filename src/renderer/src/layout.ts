export type SplitDirection = 'row' | 'column';

export type PaneNode = {
  type: 'pane';
  paneId: string;
  cwd?: string;
  shell?: string;
  title: string;
  customTitle?: string;
  headerColor?: string;
};

export type SplitNode = {
  type: 'split';
  direction: SplitDirection;
  sizes: [number, number];
  children: [LayoutNode, LayoutNode];
};

export type LayoutNode = PaneNode | SplitNode;

export function createPane(cwd?: string, shell = 'cmd.exe'): PaneNode {
  return {
    type: 'pane',
    paneId: crypto.randomUUID(),
    cwd,
    shell,
    title: shell.replace(/\.exe$/i, '')
  };
}

export function createInitialLayout(): LayoutNode {
  return createPane();
}

export function getFirstPaneId(node: LayoutNode): string {
  if (node.type === 'pane') {
    return node.paneId;
  }

  return getFirstPaneId(node.children[0]);
}

export function countPanes(node: LayoutNode): number {
  if (node.type === 'pane') {
    return 1;
  }

  return countPanes(node.children[0]) + countPanes(node.children[1]);
}

export function findPane(node: LayoutNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') {
    return node.paneId === paneId ? node : null;
  }

  return findPane(node.children[0], paneId) || findPane(node.children[1], paneId);
}

export function updatePane(
  node: LayoutNode,
  paneId: string,
  updater: (pane: PaneNode) => PaneNode
): LayoutNode {
  if (node.type === 'pane') {
    return node.paneId === paneId ? updater(node) : node;
  }

  return {
    ...node,
    children: [
      updatePane(node.children[0], paneId, updater),
      updatePane(node.children[1], paneId, updater)
    ]
  };
}

export function splitPane(
  node: LayoutNode,
  paneId: string,
  direction: SplitDirection
): { layout: LayoutNode; newPaneId: string } {
  const sourcePane = findPane(node, paneId);
  const newPane = createPane(sourcePane?.cwd, sourcePane?.shell);

  function visit(current: LayoutNode): LayoutNode {
    if (current.type === 'pane' && current.paneId === paneId) {
      return {
        type: 'split',
        direction,
        sizes: [50, 50],
        children: [current, newPane]
      };
    }

    if (current.type === 'split') {
      return {
        ...current,
        children: [visit(current.children[0]), visit(current.children[1])]
      };
    }

    return current;
  }

  return { layout: visit(node), newPaneId: newPane.paneId };
}

export function closePane(node: LayoutNode, paneId: string): LayoutNode {
  if (node.type === 'pane') {
    return node;
  }

  const [first, second] = node.children;

  if (first.type === 'pane' && first.paneId === paneId) {
    return second;
  }

  if (second.type === 'pane' && second.paneId === paneId) {
    return first;
  }

  return {
    ...node,
    children: [closePane(first, paneId), closePane(second, paneId)]
  };
}

export function resizeSplit(
  node: LayoutNode,
  path: string,
  firstSize: number
): LayoutNode {
  if (node.type !== 'split') {
    return node;
  }

  if (path === '') {
    const clamped = Math.min(85, Math.max(15, firstSize));

    return {
      ...node,
      sizes: [clamped, 100 - clamped]
    };
  }

  const side = Number(path[0]);
  const rest = path.slice(1);

  return {
    ...node,
    children: [
      side === 0 ? resizeSplit(node.children[0], rest, firstSize) : node.children[0],
      side === 1 ? resizeSplit(node.children[1], rest, firstSize) : node.children[1]
    ]
  };
}

export function listPaneIds(node: LayoutNode): string[] {
  if (node.type === 'pane') {
    return [node.paneId];
  }

  return [...listPaneIds(node.children[0]), ...listPaneIds(node.children[1])];
}

export function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const node = value as LayoutNode;

  if (node.type === 'pane') {
    return (
      typeof node.paneId === 'string' &&
      typeof node.title === 'string' &&
      (node.shell === undefined || typeof node.shell === 'string') &&
      (node.customTitle === undefined || typeof node.customTitle === 'string') &&
      (node.headerColor === undefined || typeof node.headerColor === 'string')
    );
  }

  return (
    node.type === 'split' &&
    (node.direction === 'row' || node.direction === 'column') &&
    Array.isArray(node.sizes) &&
    node.sizes.length === 2 &&
    Array.isArray(node.children) &&
    node.children.length === 2 &&
    isLayoutNode(node.children[0]) &&
    isLayoutNode(node.children[1])
  );
}
