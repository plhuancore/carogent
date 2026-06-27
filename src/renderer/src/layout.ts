export type SplitDirection = 'row' | 'column';

export type PaneNode = {
  type: 'pane';
  paneId: string;
  cwd?: string;
  shell?: string;
  browserUrl?: string;
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

export function createPane(cwd?: string, shell?: string, browserUrl?: string): PaneNode {
  return {
    type: 'pane',
    paneId: crypto.randomUUID(),
    cwd,
    shell,
    browserUrl,
    title: shell?.replace(/\.exe$/i, '') || 'terminal'
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
  direction: SplitDirection,
  shell?: string
): { layout: LayoutNode; newPaneId: string } {
  const sourcePane = findPane(node, paneId);
  const newPane = createPane(sourcePane?.cwd, shell, sourcePane?.browserUrl);

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
      (node.browserUrl === undefined || typeof node.browserUrl === 'string') &&
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

export function swapPanes(node: LayoutNode, id1: string, id2: string): LayoutNode {
  if (node.type === 'pane') {
    return node;
  }

  const pane1 = findPane(node, id1);
  const pane2 = findPane(node, id2);

  if (!pane1 || !pane2) {
    return node;
  }

  function replacePane(current: LayoutNode, targetId: string, replacement: PaneNode): LayoutNode {
    if (current.type === 'pane') {
      if (current.paneId === targetId) {
        return {
          ...replacement
        };
      }
      return current;
    }

    return {
      ...current,
      children: [
        replacePane(current.children[0], targetId, replacement),
        replacePane(current.children[1], targetId, replacement)
      ] as [LayoutNode, LayoutNode]
    };
  }

  const tempId = 'temp-swap-id';
  const tempPane: PaneNode = { ...pane2, paneId: tempId };

  let result = replacePane(node, id1, tempPane);
  result = replacePane(result, id2, pane1);
  result = replacePane(result, tempId, pane2);

  return result;
}

export function findParentSplit(
  root: LayoutNode,
  childId: string
): { parent: SplitNode; childIndex: 0 | 1 } | null {
  if (root.type === 'pane') {
    return null;
  }

  const [left, right] = root.children;
  if (left.type === 'pane' && left.paneId === childId) {
    return { parent: root, childIndex: 0 };
  }
  if (right.type === 'pane' && right.paneId === childId) {
    return { parent: root, childIndex: 1 };
  }

  const leftResult = findParentSplit(left, childId);
  if (leftResult) return leftResult;

  return findParentSplit(right, childId);
}

export function dockPane(
  node: LayoutNode,
  draggedId: string,
  targetId: string,
  position: 'top' | 'bottom' | 'left' | 'right' | 'swap' | 'parent-top' | 'parent-bottom' | 'parent-left' | 'parent-right'
): LayoutNode {
  if (draggedId === targetId) {
    return node;
  }

  if (position === 'swap') {
    return swapPanes(node, draggedId, targetId);
  }

  const draggedPane = findPane(node, draggedId);
  const targetPane = findPane(node, targetId);

  if (!draggedPane || !targetPane) {
    return node;
  }

  const layoutWithoutDragged = closePane(node, draggedId);
  const parentSplitInfo = findParentSplit(layoutWithoutDragged, targetId);

  function insertAndSplit(current: LayoutNode): LayoutNode {
    // Check if we are splitting the parent container of the target pane (e.g. splitting the row/column group)
    if (parentSplitInfo && current === parentSplitInfo.parent) {
      if (
        position === 'parent-top' ||
        position === 'parent-bottom' ||
        position === 'parent-left' ||
        position === 'parent-right'
      ) {
        const isVertical = position === 'parent-top' || position === 'parent-bottom';
        const isFirst = position === 'parent-top' || position === 'parent-left';
        return {
          type: 'split',
          direction: isVertical ? 'column' : 'row',
          sizes: [50, 50],
          children: isFirst ? [draggedPane!, current] : [current, draggedPane!]
        };
      }
    }

    if (current.type === 'pane') {
      if (current.paneId === targetId) {
        const isVertical =
          position === 'top' ||
          position === 'bottom' ||
          position === 'parent-top' ||
          position === 'parent-bottom';
        const isFirst =
          position === 'top' ||
          position === 'left' ||
          position === 'parent-top' ||
          position === 'parent-left';

        return {
          type: 'split',
          direction: isVertical ? 'column' : 'row',
          sizes: [50, 50],
          children: isFirst ? [draggedPane!, current] : [current, draggedPane!]
        };
      }
      return current;
    }

    return {
      ...current,
      children: [
        insertAndSplit(current.children[0]),
        insertAndSplit(current.children[1])
      ] as [LayoutNode, LayoutNode]
    };
  }

  return insertAndSplit(layoutWithoutDragged);
}

export function insertBetweenPanes(
  node: LayoutNode,
  draggedId: string,
  leftPaneId: string,
  rightPaneId: string
): LayoutNode {
  if (draggedId === leftPaneId || draggedId === rightPaneId) {
    return node;
  }

  const draggedPane = findPane(node, draggedId);
  if (!draggedPane) {
    return node;
  }

  const layoutWithoutDragged = closePane(node, draggedId);

  // Helper to find the split node that divides leftPaneId and rightPaneId
  function visit(current: LayoutNode): LayoutNode {
    if (current.type === 'pane') {
      return current;
    }

    const hasLeft1 = findPane(current.children[0], leftPaneId) !== null;
    const hasRight1 = findPane(current.children[1], leftPaneId) !== null;
    const hasLeft2 = findPane(current.children[0], rightPaneId) !== null;
    const hasRight2 = findPane(current.children[1], rightPaneId) !== null;

    if ((hasLeft1 && hasRight2) || (hasRight1 && hasLeft2)) {
      // Found the split node where leftPaneId and rightPaneId split!
      // We insert draggedPane in between.
      // If hasLeft1 is true, leftPaneId is in children[0] and rightPaneId is in children[1].
      // We replace children[1] with a split of [draggedPane, children[1]]
      // If hasRight1 is true, leftPaneId is in children[1] and rightPaneId is in children[0].
      // We replace children[0] with a split of [draggedPane, children[0]]
      const direction = current.direction;
      if (hasLeft1) {
        return {
          ...current,
          children: [
            current.children[0],
            {
              type: 'split',
              direction,
              sizes: [50, 50],
              children: [draggedPane!, current.children[1]]
            }
          ]
        };
      } else {
        return {
          ...current,
          children: [
            {
              type: 'split',
              direction,
              sizes: [50, 50],
              children: [draggedPane!, current.children[0]]
            },
            current.children[1]
          ]
        };
      }
    }

    return {
      ...current,
      children: [visit(current.children[0]), visit(current.children[1])]
    };
  }

  return visit(layoutWithoutDragged);
}
