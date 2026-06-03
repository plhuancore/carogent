#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const bridgeStatePath = process.env.CAROGENT_BRIDGE_STATE_PATH || '/tmp/carogent-agent-bridge.json';
const defaultPaneId = process.env.CAROGENT_PANE_ID || '';

function getBridgeConfig() {
  let bridgeState = {};

  try {
    bridgeState = JSON.parse(readFileSync(bridgeStatePath, 'utf8'));
  } catch {
    bridgeState = {};
  }

  return {
    bridgeUrl: String(
      process.env.CAROGENT_BRIDGE_URL || bridgeState.bridgeUrl || 'http://127.0.0.1:17322'
    ).replace(/\/$/, ''),
    agentToken: process.env.CAROGENT_AGENT_TOKEN || bridgeState.agentToken || ''
  };
}

const tools = [
  {
    name: 'carogent_status',
    description: 'Check Carogent bridge status and active workspace/pane.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'list_workspaces',
    description: 'List Carogent workspaces.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'list_panes',
    description: 'List Carogent terminal panes with metadata.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'insert_text',
    description: 'Insert text into a Carogent pane without pressing Enter.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string' },
        paneId: { type: 'string' }
      }
    }
  },
  {
    name: 'focus_pane',
    description: 'Focus Carogent and activate a pane.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paneId: { type: 'string' },
        workspaceId: { type: 'string' }
      }
    }
  },
  {
    name: 'notify_done',
    description: 'Pin/update a pane in the Carogent floating bar.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paneId: { type: 'string' },
        workspaceId: { type: 'string' }
      }
    }
  },
  {
    name: 'open_browser',
    description: 'Open or focus a browser URL, defaulting to the pane browser URL.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        paneId: { type: 'string' }
      }
    }
  },
  {
    name: 'open_vscode',
    description: 'Open VS Code at a pane cwd.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paneId: { type: 'string' }
      }
    }
  },
  {
    name: 'split_pane',
    description: 'Split a terminal pane (defaults to right/row) and optionally assign a title.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paneId: { type: 'string', description: 'The pane ID to split. Defaults to active pane.' },
        direction: { type: 'string', enum: ['row', 'column'], description: 'Split direction: row (right) or column (down). Defaults to row.' },
        title: { type: 'string', description: 'The title/name for the newly created pane.' }
      }
    }
  }
];

function bridgeActionForTool(name) {
  return {
    carogent_status: 'status',
    list_workspaces: 'list_workspaces',
    list_panes: 'list_panes',
    insert_text: 'insert_text',
    focus_pane: 'focus_pane',
    notify_done: 'notify_done',
    open_browser: 'open_browser',
    open_vscode: 'open_vscode',
    split_pane: 'split_pane'
  }[name];
}

async function callBridge(action, args = {}) {
  const { bridgeUrl, agentToken } = getBridgeConfig();

  if (!agentToken) {
    throw new Error('Missing Carogent bridge token. Start or restart Carogent first.');
  }

  const body = { action, ...args };

  if (
    !body.paneId &&
    defaultPaneId &&
    ['insert_text', 'focus_pane', 'notify_done', 'open_browser', 'open_vscode', 'split_pane'].includes(action)
  ) {
    body.paneId = defaultPaneId;
  }

  const response = await fetch(`${bridgeUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Carogent bridge returned HTTP ${response.status}`);
  }

  return payload.result;
}

function makeResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleMessage(message) {
  const id = message.id;

  try {
    if (message.method === 'initialize') {
      return makeResponse(id, {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'carogent-mcp', version: '0.1.0' }
      });
    }

    if (message.method === 'tools/list') {
      return makeResponse(id, { tools });
    }

    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const action = bridgeActionForTool(name);

      if (!action) {
        return makeError(id, -32602, `Unknown tool: ${name}`);
      }

      const result = await callBridge(action, message.params?.arguments || {});

      return makeResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    }

    if (message.method?.startsWith('notifications/')) {
      return null;
    }

    return makeError(id, -32601, `Unknown method: ${message.method}`);
  } catch (error) {
    return makeError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function writeMessage(message) {
  if (!message) {
    return;
  }

  const body = Buffer.from(JSON.stringify(message), 'utf8');

  if (framingMode === 'line') {
    process.stdout.write(`${body.toString('utf8')}\n`);
    return;
  }

  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

let buffer = Buffer.alloc(0);
let framingMode = 'headers';

function findHeaderBoundary(input) {
  const crlfIndex = input.indexOf('\r\n\r\n');

  if (crlfIndex !== -1) {
    return { index: crlfIndex, length: 4 };
  }

  const lfIndex = input.indexOf('\n\n');

  if (lfIndex !== -1) {
    return { index: lfIndex, length: 2 };
  }

  return null;
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const boundary = findHeaderBoundary(buffer);

    if (!boundary) {
      if (buffer[0] === 0x7b) {
        const newlineIndex = buffer.indexOf('\n');

        if (newlineIndex === -1) {
          return;
        }

        const rawLine = buffer.subarray(0, newlineIndex).toString('utf8').trim();
        buffer = buffer.subarray(newlineIndex + 1);

        if (!rawLine) {
          continue;
        }

        framingMode = 'line';
        void Promise.resolve()
          .then(() => handleMessage(JSON.parse(rawLine)))
          .then(writeMessage)
          .catch((error) => writeMessage(makeError(null, -32700, String(error))));
        continue;
      }

      return;
    }

    framingMode = 'headers';
    const header = buffer.subarray(0, boundary.index).toString('utf8');
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);

    if (!lengthMatch) {
      buffer = buffer.subarray(boundary.index + boundary.length);
      continue;
    }

    const bodyLength = Number(lengthMatch[1]);
    const bodyStart = boundary.index + boundary.length;
    const bodyEnd = bodyStart + bodyLength;

    if (buffer.length < bodyEnd) {
      return;
    }

    const rawBody = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
    buffer = buffer.subarray(bodyEnd);

    void Promise.resolve()
      .then(() => handleMessage(JSON.parse(rawBody)))
      .then(writeMessage)
      .catch((error) => writeMessage(makeError(null, -32700, String(error))));
  }
});

process.stdin.resume();
