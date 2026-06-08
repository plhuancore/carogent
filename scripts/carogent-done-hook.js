#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const statePath = '/Users/huanpham/.gemini/antigravity-cli/scratch/carogent-notify-done-state.json';

// 1. Check toggle state
let isEnabled = false;
try {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  isEnabled = !!state.enabled;
} catch {
  // If no state file, default to false (not enabled)
  isEnabled = false;
}

if (!isEnabled) {
  process.exit(0);
}

// 2. Load Bridge config
const bridgeStatePath = process.env.CAROGENT_BRIDGE_STATE_PATH || join(tmpdir(), 'carogent-agent-bridge.json');

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

const { bridgeUrl, agentToken } = getBridgeConfig();

if (!agentToken) {
  console.error('[carogent-done-hook] Missing agent token.');
  process.exit(1);
}

// 3. Resolve active pane
let paneId = process.env.CAROGENT_PANE_ID || '';

async function run() {
  try {
    if (!paneId) {
      // Fallback: fetch active pane from bridge status
      const statusRes = await fetch(`${bridgeUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'status' })
      });
      if (statusRes.ok) {
        const payload = await statusRes.json();
        if (payload && payload.result && payload.result.activePaneId) {
          paneId = payload.result.activePaneId;
        }
      }
    }

    if (!paneId) {
      console.error('[carogent-done-hook] Could not resolve paneId.');
      process.exit(1);
    }

    // 4. Call notify_done
    const response = await fetch(`${bridgeUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'notify_done', paneId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[carogent-done-hook] Bridge returned error: ${response.status} - ${errorText}`);
      process.exit(1);
    }

    const payload = await response.json();
    if (payload.ok === false) {
      console.error(`[carogent-done-hook] Bridge error: ${payload.error}`);
      process.exit(1);
    }

    console.log(`[carogent-done-hook] Successfully notified done for pane ${paneId}`);
  } catch (error) {
    console.error('[carogent-done-hook] Hook error:', error);
    process.exit(1);
  }
}

run();
