const BRIDGE_URL = 'ws://127.0.0.1:17321';
const INITIAL_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 20000;

let socket = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;

function normalizeUrl(input) {
  const value = String(input || '').trim() || 'http://localhost:3000';
  const url = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;

  return new URL(url);
}

function matchesRequestedUrl(tabUrl, requestedUrl) {
  let parsedTabUrl;

  try {
    parsedTabUrl = new URL(tabUrl);
  } catch {
    return false;
  }

  if (parsedTabUrl.origin !== requestedUrl.origin) {
    return false;
  }

  const hasSpecificPath = requestedUrl.pathname !== '/' || requestedUrl.search !== '' || requestedUrl.hash !== '';

  if (!hasSpecificPath) {
    return true;
  }

  return parsedTabUrl.href.startsWith(requestedUrl.href);
}

function sendResponse(id, handled) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ id, handled }));
}

function sendBridgeMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function stopHeartbeat() {
  if (heartbeatTimer === null) {
    return;
  }

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function startHeartbeat() {
  stopHeartbeat();
  sendBridgeMessage({ type: 'hello' });
  heartbeatTimer = setInterval(() => {
    sendBridgeMessage({ type: 'ping' });
  }, HEARTBEAT_INTERVAL_MS);
}

async function openOrFocus(url) {
  const requestedUrl = normalizeUrl(url);
  const tabs = await chrome.tabs.query({});
  const matchedTab = tabs.find((tab) => tab.id !== undefined && tab.url && matchesRequestedUrl(tab.url, requestedUrl));

  if (matchedTab?.id !== undefined) {
    await chrome.tabs.update(matchedTab.id, { active: true });

    if (matchedTab.windowId !== undefined) {
      await chrome.windows.update(matchedTab.windowId, { focused: true });
    }

    return;
  }

  await chrome.tabs.create({ url: requestedUrl.href });
}

async function handleMessage(rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (message.type !== 'openOrFocus' || typeof message.id !== 'string') {
    return;
  }

  try {
    await openOrFocus(message.url);
    sendResponse(message.id, true);
  } catch (error) {
    sendBridgeMessage({
      id: message.id,
      handled: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    connect();
  }, reconnectDelayMs);
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch {
    socket = null;
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    startHeartbeat();
  };

  socket.onmessage = (event) => {
    void handleMessage(event.data);
  };

  socket.onclose = () => {
    stopHeartbeat();
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

connect();
