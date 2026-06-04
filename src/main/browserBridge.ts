import { BrowserWindow, shell as electronShell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { BrowserBridgeStatusEvent, OpenBrowserRequest } from '../shared/ipcTypes';

type BrowserDebugTarget = {
  id?: string;
  type?: string;
  url?: string;
};

type BrowserBridgeClient = {
  socket: Socket;
  buffer: Buffer;
};

type BrowserBridgeResponse = {
  id?: string;
  type?: string;
  handled?: boolean;
  enabled?: boolean;
  error?: string;
};

type BrowserBridgeCommandResult = 'handled' | 'disabled' | 'unhandled';

export const DEFAULT_BROWSER_URL = 'http://localhost:3000';

const DEFAULT_BROWSER_DEBUG_URL = 'http://127.0.0.1:9222';
const BROWSER_BRIDGE_PORT = 17321;
const BROWSER_BRIDGE_TIMEOUT_MS = 5000;

export function createBrowserBridge(getMainWindow: () => BrowserWindow | null) {
  const browserBridgeClients = new Set<BrowserBridgeClient>();
  const browserBridgePending = new Map<string, (result: BrowserBridgeCommandResult) => void>();
  let browserBridgeLastError: string | undefined;
  let browserBridgeEnabled = true;

  function createWebSocketAcceptKey(key: string): string {
    return createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
  }

  function createWebSocketTextFrame(data: string): Buffer {
    const payload = Buffer.from(data, 'utf8');

    if (payload.length < 126) {
      return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    }

    if (payload.length <= 0xffff) {
      const header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);

      return Buffer.concat([header, payload]);
    }

    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);

    return Buffer.concat([header, payload]);
  }

  function readWebSocketMessages(client: BrowserBridgeClient, chunk: Buffer): string[] {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    const messages: string[] = [];

    while (client.buffer.length >= 2) {
      const firstByte = client.buffer[0];
      const secondByte = client.buffer[1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (client.buffer.length < offset + 2) {
          break;
        }

        payloadLength = client.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (client.buffer.length < offset + 8) {
          break;
        }

        const bigLength = client.buffer.readBigUInt64BE(offset);

        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          client.socket.destroy();
          break;
        }

        payloadLength = Number(bigLength);
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      const frameLength = offset + maskLength + payloadLength;

      if (client.buffer.length < frameLength) {
        break;
      }

      if (opcode === 0x8) {
        client.socket.end();
        client.buffer = client.buffer.subarray(frameLength);
        continue;
      }

      if (opcode !== 0x1) {
        client.buffer = client.buffer.subarray(frameLength);
        continue;
      }

      const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
      offset += maskLength;

      const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLength));

      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      messages.push(payload.toString('utf8'));
      client.buffer = client.buffer.subarray(frameLength);
    }

    return messages;
  }

  function getStatus(): BrowserBridgeStatusEvent {
    return {
      connected: browserBridgeClients.size > 0,
      clientCount: browserBridgeClients.size,
      enabled: browserBridgeEnabled,
      lastError: browserBridgeLastError
    };
  }

  function sendStatus(): void {
    getMainWindow()?.webContents.send('browser:bridge-status', getStatus());
  }

  function handleBrowserBridgeMessage(message: string): void {
    let response: BrowserBridgeResponse;

    try {
      response = JSON.parse(message) as BrowserBridgeResponse;
    } catch {
      return;
    }

    if (response.type === 'hello' || response.type === 'ping') {
      if (typeof response.enabled === 'boolean') {
        browserBridgeEnabled = response.enabled;
      }

      browserBridgeLastError = undefined;
      sendStatus();
      return;
    }

    if (!response.id) {
      return;
    }

    const resolve = browserBridgePending.get(response.id);

    if (!resolve) {
      return;
    }

    browserBridgePending.delete(response.id);
    browserBridgeLastError = response.error;
    sendStatus();
    resolve(response.error === 'Extension disabled' ? 'disabled' : response.handled === true ? 'handled' : 'unhandled');
  }

  function start(): void {
    const server = createServer();

    server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
      const key = request.headers['sec-websocket-key'];

      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${createWebSocketAcceptKey(key)}`,
          '',
          ''
        ].join('\r\n')
      );

      const client: BrowserBridgeClient = { socket, buffer: Buffer.alloc(0) };
      browserBridgeClients.add(client);
      browserBridgeLastError = undefined;
      sendStatus();

      socket.on('data', (chunk) => {
        for (const message of readWebSocketMessages(client, chunk)) {
          handleBrowserBridgeMessage(message);
        }
      });

      socket.on('close', () => {
        browserBridgeClients.delete(client);
        sendStatus();
      });
      socket.on('error', () => {
        browserBridgeClients.delete(client);
        sendStatus();
      });
    });

    server.on('error', () => {
      // Another app instance may already own the bridge port. Browser opening still falls back normally.
    });

    server.listen(BROWSER_BRIDGE_PORT, '127.0.0.1');
  }

  function sendCommand(url: string): Promise<BrowserBridgeCommandResult> {
    if (browserBridgeClients.size === 0) {
      return Promise.resolve('unhandled');
    }

    const id = randomUUID();
    const payload = createWebSocketTextFrame(JSON.stringify({ id, type: 'openOrFocus', url }));

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        browserBridgePending.delete(id);
        resolve('unhandled');
      }, BROWSER_BRIDGE_TIMEOUT_MS);

      browserBridgePending.set(id, (handled) => {
        clearTimeout(timeout);
        resolve(handled);
      });

      for (const client of browserBridgeClients) {
        client.socket.write(payload);
      }
    });
  }

  async function openOrFocus(request: OpenBrowserRequest): Promise<void> {
    const targetUrl = normalizeBrowserUrl(request.url);
    const debugUrl = process.env.CAROGENT_BROWSER_DEBUG_URL || DEFAULT_BROWSER_DEBUG_URL;

    const bridgeResult = await sendCommand(targetUrl.href);

    if (bridgeResult === 'handled' || bridgeResult === 'disabled') {
      return;
    }

    try {
      const response = await fetch(`${debugUrl.replace(/\/$/, '')}/json/list`);

      if (response.ok) {
        const targets = (await response.json()) as BrowserDebugTarget[];
        const matchedTarget = targets.find(
          (target) => target.type === 'page' && target.id && target.url && shouldMatchBrowserTab(target.url, targetUrl)
        );

        if (matchedTarget?.id) {
          await fetch(`${debugUrl.replace(/\/$/, '')}/json/activate/${encodeURIComponent(matchedTarget.id)}`);
          return;
        }
      }
    } catch {
      // Browser remote debugging is optional. Fall back to opening the URL normally.
    }

    await electronShell.openExternal(targetUrl.href);
  }

  return {
    getStatus,
    openOrFocus,
    start
  };
}

function normalizeBrowserUrl(input?: string): URL {
  const value = input?.trim() || DEFAULT_BROWSER_URL;

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return new URL(value);
  }

  const host = value.split(/[/?#]/, 1)[0];
  const isLocal = host === 'localhost' || host.startsWith('localhost:') || /^[\d.:]+$/.test(host);
  const normalizedValue = !isLocal && host && !host.includes('.') && !host.includes(':')
    ? `${host}.com${value.slice(host.length)}`
    : value;

  return new URL(`${isLocal ? 'http' : 'https'}://${normalizedValue}`);
}

function normalizeBrowserHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function shouldMatchBrowserTab(targetUrl: string, requestedUrl: URL): boolean {
  let tabUrl: URL;

  try {
    tabUrl = new URL(targetUrl);
  } catch {
    return false;
  }

  if (normalizeBrowserHostname(tabUrl.hostname) !== normalizeBrowserHostname(requestedUrl.hostname)) {
    return false;
  }

  if (requestedUrl.port && tabUrl.port !== requestedUrl.port) {
    return false;
  }

  const hasSpecificPath = requestedUrl.pathname !== '/' || requestedUrl.search !== '' || requestedUrl.hash !== '';

  if (!hasSpecificPath) {
    return true;
  }

  return tabUrl.href.startsWith(requestedUrl.href);
}
