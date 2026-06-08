---
name: carogent-done
description: Toggle automatic Carogent notification on prompt completion.
---

# Toggle Auto-Notify Carogent Done

## Purpose
Use this skill when you run `/carogent-done`. It toggles the automatic execution of the `notify_done` hook when prompts finish.

## Instructions
When the user runs this skill:
1. Locate the state file at `/Users/huanpham/.gemini/antigravity-cli/scratch/carogent-notify-done-state.json`.
2. Read the current toggle state. If the file doesn't exist or is invalid, assume it was disabled (false).
3. If it was enabled (true), write `{"enabled": false}` to the state file to disable it.
4. If it was disabled (false), write `{"enabled": true}` to the state file to enable it.
5. Answer the user clearly indicating whether the auto-notify-done feature is now **ENABLED** or **DISABLED**.
6. If the feature is now enabled, call the `carogent/notify_done` MCP tool to show a success confirmation on their floating bar. If it is disabled, do not call it.
