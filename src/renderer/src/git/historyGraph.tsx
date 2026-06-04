import React from 'react';
import type { CommitHistoryItem } from './types';

const TRACK_COLORS = [
  '#ec4899', // Pink
  '#10b981', // Green
  '#f59e0b', // Orange
  '#8b5cf6', // Purple
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#3b82f6'  // Blue
];

const hashColors = new Map<string, string>();
let colorCounter = 0;

function getColorForHash(hash: string): string {
  if (!hash || hash === 'uncommitted' || hash === 'unstaged' || hash === 'staged') return '#8b949e';
  if (!hashColors.has(hash)) {
    const color = TRACK_COLORS[colorCounter % TRACK_COLORS.length];
    hashColors.set(hash, color);
    colorCounter++;
  }
  return hashColors.get(hash)!;
}

function getColorForCol(colIndex: number): string {
  return TRACK_COLORS[colIndex % TRACK_COLORS.length];
}

interface RefDecoration {
  name: string;
  type: 'head' | 'remote' | 'tag' | 'stash' | 'other';
}

interface MergedRefDecoration {
  name: string;
  type: 'head' | 'remote' | 'tag' | 'stash' | 'other';
  isHEAD: boolean;
  remoteNames?: string[];
}

function parseDecorations(decorationStr: string): RefDecoration[] {
  if (!decorationStr) return [];
  let clean = decorationStr.trim();
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = clean.slice(1, -1);
  }

  const parts = clean.split(', ');
  const decorations: RefDecoration[] = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    let name = part;
    let type: RefDecoration['type'] = 'head';

    if (name.includes('HEAD -> ')) {
      name = name.replace('HEAD -> ', '');
      type = 'head';
    } else if (name.startsWith('tag: ')) {
      name = name.replace('tag: ', '');
      type = 'tag';
    } else if (name.startsWith('origin/')) {
      type = 'remote';
    } else if (name.startsWith('refs/stash') || name.includes('stash')) {
      type = 'stash';
      name = 'stash';
    } else {
      type = 'other';
    }

    decorations.push({ name, type });
  }

  return decorations;
}

function getMergedDecorations(decorationStr: string): MergedRefDecoration[] {
  if (!decorationStr) return [];
  let clean = decorationStr.trim();
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = clean.slice(1, -1);
  }

  const parts = clean.split(', ');
  const items: {
    raw: string;
    type: 'head-pointer' | 'local-branch' | 'remote-branch' | 'tag' | 'stash' | 'other';
    name: string;
    isHEAD: boolean;
    remoteName?: string;
    branchName?: string;
  }[] = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    if (part.startsWith('HEAD -> ')) {
      const name = part.replace('HEAD -> ', '');
      items.push({
        raw: part,
        type: 'local-branch',
        name,
        isHEAD: true
      });
    } else if (part === 'HEAD') {
      items.push({
        raw: part,
        type: 'head-pointer',
        name: 'HEAD',
        isHEAD: true
      });
    } else if (part.startsWith('tag: ')) {
      items.push({
        raw: part,
        type: 'tag',
        name: part.replace('tag: ', ''),
        isHEAD: false
      });
    } else if (part === 'refs/stash' || part.includes('stash')) {
      items.push({
        raw: part,
        type: 'stash',
        name: 'stash',
        isHEAD: false
      });
    } else {
      const match = part.match(/^([^/]+)\/(.+)$/);
      const knownRemotes = ['origin', 'upstream', 'github', 'gitlab', 'heroku'];
      if (match && (knownRemotes.includes(match[1]) || part.startsWith('origin/') || part.startsWith('upstream/'))) {
        items.push({
          raw: part,
          type: 'remote-branch',
          name: part,
          isHEAD: false,
          remoteName: match[1],
          branchName: match[2]
        });
      } else {
        items.push({
          raw: part,
          type: 'local-branch',
          name: part,
          isHEAD: false
        });
      }
    }
  }

  const merged: MergedRefDecoration[] = [];
  const processedRemoteRaws = new Set<string>();

  const localBranches = items.filter(item => item.type === 'local-branch');
  for (const local of localBranches) {
    const matchingRemotes = items.filter(
      item => item.type === 'remote-branch' && item.branchName === local.name
    );

    const remoteNames: string[] = [];
    for (const rem of matchingRemotes) {
      if (rem.remoteName) {
        remoteNames.push(rem.remoteName);
        processedRemoteRaws.add(rem.raw);
      }
    }

    merged.push({
      name: local.name,
      type: local.isHEAD ? 'head' : 'other',
      isHEAD: local.isHEAD,
      remoteNames: remoteNames.length > 0 ? remoteNames : undefined
    });
  }

  const headPointers = items.filter(item => item.type === 'head-pointer');
  for (const hp of headPointers) {
    merged.push({
      name: hp.name,
      type: 'head',
      isHEAD: true
    });
  }

  const remoteBranches = items.filter(
    item => item.type === 'remote-branch' && !processedRemoteRaws.has(item.raw)
  );
  for (const rem of remoteBranches) {
    merged.push({
      name: rem.name,
      type: 'remote',
      isHEAD: false
    });
  }

  const tags = items.filter(item => item.type === 'tag');
  for (const tag of tags) {
    merged.push({
      name: tag.name,
      type: 'tag',
      isHEAD: false
    });
  }

  const stashes = items.filter(item => item.type === 'stash');
  for (const stash of stashes) {
    merged.push({
      name: stash.name,
      type: 'stash',
      isHEAD: false
    });
  }

  return merged;
}

export const renderRefBadges = (decorationStr: string) => {
  const decs = getMergedDecorations(decorationStr);
  if (decs.length === 0) return null;

  return (
    <div style={{ display: 'inline-flex', gap: '4px', marginRight: '6px', flexWrap: 'nowrap', flexShrink: 0 }}>
      {decs.map((dec) => {
        let badgeClass = 'git-badge-other';
        const nameLower = dec.name.toLowerCase();
        let icon = null;

        if (dec.type === 'head') {
          if (dec.isHEAD) {
            badgeClass = 'git-badge-head-active';
          } else {
            if (nameLower.includes('fix') || nameLower.includes('bug')) {
              badgeClass = 'git-badge-head-fix';
            } else if (nameLower.includes('feat') || nameLower.includes('improve')) {
              badgeClass = 'git-badge-head-feat';
            } else {
              badgeClass = 'git-badge-head-other';
            }
          }
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          );
        } else if (dec.type === 'remote') {
          if (nameLower.includes('main') || nameLower.includes('master') || nameLower.includes('head')) {
            badgeClass = 'git-badge-remote-main';
          } else if (nameLower.includes('develop') || nameLower.includes('dev')) {
            badgeClass = 'git-badge-remote-dev';
          } else {
            badgeClass = 'git-badge-remote-other';
          }
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          );
        } else if (dec.type === 'stash') {
          badgeClass = 'git-badge-stash';
        } else if (dec.type === 'tag') {
          badgeClass = 'git-badge-tag';
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
              <line x1="7" y1="7" x2="7.01" y2="7"></line>
            </svg>
          );
        } else {
          if (nameLower.includes('fix') || nameLower.includes('bug')) {
            badgeClass = 'git-badge-head-fix';
          } else if (nameLower.includes('feat') || nameLower.includes('improve')) {
            badgeClass = 'git-badge-head-feat';
          } else {
            badgeClass = 'git-badge-head-other';
          }
          icon = (
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '4px', flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          );
        }

        return (
          <span key={dec.name} className={`git-ref-badge ${badgeClass}`}>
            {icon}
            <span className="git-branch-name">{dec.name}</span>
            {dec.remoteNames && dec.remoteNames.length > 0 && (
              <>
                <span className="git-badge-divider" />
                <span className="git-badge-remote-names">
                  {dec.remoteNames.join(', ')}
                </span>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
};

export function computeGraphData(commits: CommitHistoryItem[]) {
  const activeTracks: string[] = [];
  const rows: {
    commit: CommitHistoryItem;
    col: number;
    incomingTracks: string[];
    outgoingTracks: string[];
    isBranchHead: boolean;
  }[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const incomingTracks = [...activeTracks];

    let isBranchHead = false;
    let col = activeTracks.indexOf(commit.hash);
    if (col === -1) {
      activeTracks.push(commit.hash);
      col = activeTracks.length - 1;
      incomingTracks.push(commit.hash);
      isBranchHead = true;
    }

    const outgoingTracks = activeTracks.filter((h) => h !== commit.hash);

    const parents = commit.parents || [];
    for (let pIdx = 0; pIdx < parents.length; pIdx++) {
      const parent = parents[pIdx];
      if (parent) {
        if (pIdx === 0) {
          outgoingTracks.splice(col, 0, parent);
        } else {
          outgoingTracks.push(parent);
        }
      }
    }

    rows.push({
      commit,
      col,
      incomingTracks,
      outgoingTracks: [...outgoingTracks],
      isBranchHead
    });

    activeTracks.length = 0;
    activeTracks.push(...outgoingTracks);
  }

  return rows;
}

interface GraphCellProps {
  col: number;
  incomingTracks: string[];
  outgoingTracks: string[];
  isBranchHead: boolean;
  commit: CommitHistoryItem;
  graphWidth: number;
  rowHeight: number;
  colWidth: number;
  paddingX: number;
  rowIdx: number;
  hashToIndexMap: Map<string, { index: number; isHEAD: boolean }>;
}

export const GraphCell = React.memo<GraphCellProps>(({
  col,
  incomingTracks,
  outgoingTracks,
  isBranchHead,
  commit,
  graphWidth,
  rowHeight,
  colWidth,
  paddingX,
  rowIdx,
  hashToIndexMap
}) => {
  const yMid = rowHeight / 2;
  const xDot = col * colWidth + paddingX;
  const dotColor = commit.isUncommitted ? '#8b949e' : getColorForCol(col);
  const isStashCommit = commit.decorations.includes('refs/stash') || commit.subject.startsWith('WIP on ');
  const stashColor = dotColor;
  const nodeRadius = commit.isUncommitted || commit.isHEAD ? 5 : 4.5;
  const branchStartY = yMid + nodeRadius;
  const branchBendY = yMid + 7;
  const nextNodeTopY = rowHeight + yMid - nodeRadius;
  const nextBranchStartY = yMid + 8;
  const nextBranchControlY = nextNodeTopY - 6;

  const paths: React.ReactNode[] = [];
  const parents = commit.parents || [];

  // Compute remaining tracks count without allocating an array
  let remainingCount = 0;
  for (let i = 0; i < incomingTracks.length; i++) {
    if (incomingTracks[i] !== commit.hash) {
      remainingCount++;
    }
  }

  incomingTracks.forEach((hash, idx) => {
    const xStart = idx * colWidth + paddingX;
    
    // Determine if this incoming track is part of the uncommitted segments above the HEAD commit
    const lookup = hashToIndexMap.get(hash);
    const commitIdx = lookup ? lookup.index : -1;
    const isHEAD = lookup ? lookup.isHEAD : false;
    const isUncommittedHeadSegment = hashToIndexMap.has('uncommitted') && isHEAD && rowIdx <= commitIdx;

    const color = (hash === 'unstaged' || hash === 'staged' || hash === 'uncommitted')
      ? '#8b949e'
      : (commitIdx !== -1 && isUncommittedHeadSegment)
        ? '#8b949e'
        : getColorForCol(idx);

    if (hash === commit.hash) {
      if (idx === col) {
        if (!isBranchHead) {
          paths.push(
            <line
              key={`in-commit-${idx}`}
              x1={xStart}
              y1={0}
              x2={xStart}
              y2={yMid}
              stroke={color}
              strokeWidth={color === '#8b949e' ? 1.5 : 2}
              strokeLinecap="round"
            />
          );
        }
      } else {
        // This is a branch track that terminates and merges into the node at col
        const xEnd = col * colWidth + paddingX;
        paths.push(
          <path
            key={`in-merge-${idx}-${col}`}
            d={`M ${xStart} 0 C ${xStart} ${yMid - 6}, ${xEnd} ${yMid - 6}, ${xEnd} ${yMid}`}
            stroke={color}
            fill="none"
            strokeWidth={color === '#8b949e' ? 1.5 : 2}
            strokeLinecap="round"
          />
        );
      }
    } else {
      // Compute outIdx on the fly without Map or array allocation
      let outIdx = 0;
      for (let i = 0; i < idx; i++) {
        if (incomingTracks[i] !== commit.hash) {
          outIdx++;
        }
      }
      if (parents.length > 0 && parents[0] && col <= outIdx) {
        outIdx++;
      }

      const xEnd = outIdx * colWidth + paddingX;
      const cpY = xStart < xEnd ? yMid - 7 : yMid;
      paths.push(
        <path
          key={`in-pass-${idx}-${outIdx}`}
          d={xStart > xEnd
            ? `M ${xStart} 0 L ${xStart} ${nextBranchStartY} C ${xStart} ${nextBranchControlY}, ${xEnd} ${nextBranchControlY}, ${xEnd} ${nextNodeTopY}`
            : `M ${xStart} 0 C ${xStart} ${cpY}, ${xEnd} ${cpY}, ${xEnd} ${rowHeight}`}
          stroke={color}
          fill="none"
          strokeWidth={color === '#8b949e' ? 1.5 : 2}
          strokeLinecap="round"
        />
      );
    }
  });

  parents.forEach((parentHash, pIdx) => {
    let outIdx = -1;
    if (pIdx === 0) {
      if (parents[0]) {
        outIdx = col;
      }
    } else {
      if (parents[pIdx]) {
        outIdx = remainingCount + (parents[0] ? 1 : 0) + (pIdx - 1);
      }
    }

    if (outIdx !== -1) {
      const xEnd = outIdx * colWidth + paddingX;
      
      // Determine parent connection line color: if the commit itself is uncommitted, the link to its parent is grey
      const color = commit.isUncommitted
        ? '#8b949e'
        : getColorForCol(parents.length > 1 ? outIdx : col);

      paths.push(
        <path
          key={`out-parent-${pIdx}-${outIdx}`}
          d={xEnd === xDot
            ? `M ${xDot} ${yMid} L ${xEnd} ${rowHeight}`
            : `M ${xDot} ${branchStartY} C ${xDot} ${branchBendY}, ${xEnd} ${branchBendY}, ${xEnd} ${rowHeight}`}
          stroke={color}
          fill="none"
          strokeWidth={color === '#8b949e' ? 1.5 : 2.2}
          strokeLinecap="round"
        />
      );
    }
  });

  return (
    <svg width={graphWidth} height={rowHeight} style={{ display: 'block', overflow: 'visible' }}>
      {paths}
      {commit.isUncommitted ? (
        <circle
          cx={xDot}
          cy={yMid}
          r={5}
          fill="#080a0d"
          stroke="#8b949e"
          strokeWidth={2.5}
        />
      ) : commit.isHEAD ? (
        <circle
          cx={xDot}
          cy={yMid}
          className="git-graph-node-head"
          stroke={dotColor}
          strokeWidth={3}
          r={5}
        />
      ) : isStashCommit ? (
        <>
          <circle
            cx={xDot}
            cy={yMid}
            className="git-graph-node-stash"
            stroke={stashColor}
            strokeWidth={2}
            r={4.5}
          />
          <circle
            cx={xDot}
            cy={yMid}
            r={1.5}
            fill={stashColor}
          />
        </>
      ) : (
        <circle
          cx={xDot}
          cy={yMid}
          r={4.5}
          fill={dotColor}
        />
      )}
    </svg>
  );
});
GraphCell.displayName = 'GraphCell';

