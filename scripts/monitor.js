#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ANSI Color Helpers
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const cleanValue = (val) => {
  if (typeof val !== 'string') return val;
  let str = val.trim();
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.slice(1, -1);
  }
  return str.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
};

const cleanArgs = (args) => {
  if (!args) return {};
  const cleaned = {};
  for (const key in args) {
    cleaned[key] = cleanValue(args[key]);
  }
  return cleaned;
};

const mapToolName = (name, args) => {
  const cleaned = cleanArgs(args);
  if (name === 'call_mcp_tool') {
    const server = cleaned.ServerName || '';
    const tool = cleaned.ToolName || '';
    return `${server}/${tool}`;
  }
  const mapping = {
    'view_file': 'Read',
    'list_dir': 'ListDir',
    'run_command': 'Bash',
    'grep_search': 'Find',
    'send_message': 'SendMessage',
    'define_subagent': 'DefineSubagent',
    'invoke_subagent': 'InvokeSubagent'
  };
  return mapping[name] || name;
};

const getToolArg = (name, args) => {
  const cleaned = cleanArgs(args);
  if (name === 'call_mcp_tool') {
    let innerArgs = {};
    if (cleaned.Arguments) {
      try {
        innerArgs = typeof cleaned.Arguments === 'string' ? JSON.parse(cleaned.Arguments) : cleaned.Arguments;
        innerArgs = cleanArgs(innerArgs);
      } catch (e) {}
    }
    return cleaned.toolSummary || cleaned.toolAction || innerArgs.toolSummary || innerArgs.toolAction || '';
  }
  if (name === 'view_file') {
    return cleaned.AbsolutePath || cleaned.TargetFile || '';
  }
  if (name === 'list_dir') {
    return cleaned.DirectoryPath || '';
  }
  if (name === 'run_command') {
    return cleaned.CommandLine || '';
  }
  if (name === 'grep_search') {
    return cleaned.toolSummary || cleaned.Query || '';
  }
  if (name === 'send_message') {
    return `Message sent to "${cleaned.Recipient}".`;
  }
  return cleaned.toolSummary || JSON.stringify(cleaned);
};

const cleanPrompt = (content) => {
  if (!content) return '';
  return content.replace(/<[^>]+>/g, '').trim();
};

const formatThinking = (thinking, duration) => {
  if (!thinking) return '';
  let durStr = duration ? `${duration}s` : '1s';
  let output = `${colors.dim}> Thought for ${durStr}${colors.reset}\n`;
  
  const cleaned = cleanValue(thinking);
  const lines = cleaned.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('**') && !line.startsWith('##'));
  
  lines.forEach(line => {
    output += `  ${line}\n`;
  });
  return output;
};

const parentConvId = '0839252c-18af-40b5-945e-865915821f58';
const brainDir = '/Users/huanpham/.gemini/antigravity-cli/brain';

const getLatestSubagentId = () => {
  if (!fs.existsSync(brainDir)) return null;
  const items = fs.readdirSync(brainDir);
  const subagents = [];
  for (const item of items) {
    if (item === parentConvId || item === 'scratch' || item.startsWith('.')) continue;
    const fullPath = path.join(brainDir, item);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        subagents.push({ id: item, mtime: stat.mtimeMs });
      }
    } catch (e) {}
  }
  if (subagents.length === 0) return null;
  subagents.sort((a, b) => b.mtime - a.mtime);
  return subagents[0].id;
};

// Main execution
const main = () => {
  const args = process.argv.slice(2);
  let mode = 'auto';
  let targetLogPath = null;
  let targetConvId = '';

  if (args.length > 0 && args[0] !== 'auto') {
    mode = 'manual';
    targetConvId = args[0];
    if (targetConvId.endsWith('.jsonl')) {
      targetLogPath = targetConvId;
      targetConvId = path.basename(path.dirname(path.dirname(path.dirname(targetLogPath))));
    } else {
      targetLogPath = path.join(brainDir, targetConvId, '.system_generated', 'logs', 'transcript.jsonl');
    }
  }

  let activeWatcher = null;
  let activeFileInterval = null;
  let currentMonitoredId = null;

  const stopActiveMonitoring = () => {
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    if (activeFileInterval) {
      clearInterval(activeFileInterval);
      activeFileInterval = null;
    }
  };

  const startMonitoring = (logPath, convId) => {
    let steps = [];

    const drawDashboard = () => {
      process.stdout.write('\x1Bc');

      console.log(`ID: ${convId}`);
      console.log(`${colors.dim}------------------------------------------------------------${colors.reset}`);
      
      const firstStep = steps.find(s => s.type === 'USER_INPUT');
      const promptText = firstStep ? cleanPrompt(firstStep.content || '') : 'No prompt found';
      console.log(`${colors.bright}Prompt${colors.reset}`);
      console.log(promptText);
      console.log(`${colors.dim}------------------------------------------------------------${colors.reset}`);

      console.log(`${colors.bright}Tools${colors.reset}`);
      console.log(`${colors.dim}carogent/carogent_status, carogent/list_workspaces, carogent/list_panes, Read, ListDir, Bash, Find, SendMessage${colors.reset}`);
      console.log(`${colors.dim}------------------------------------------------------------${colors.reset}`);

      const validSteps = steps.filter(s => s.type !== 'USER_INPUT' && s.type !== 'CONVERSATION_HISTORY');
      console.log(`${colors.bright}Trajectory - carogent_developer (${validSteps.length} steps)${colors.reset}`);
      console.log(`${colors.dim}------------------------------------------------------------${colors.reset}\n`);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.type === 'USER_INPUT' || step.type === 'CONVERSATION_HISTORY') continue;

        let duration = 0;
        if (i > 0 && steps[i - 1].created_at && step.created_at) {
          duration = Math.round((new Date(step.created_at) - new Date(steps[i - 1].created_at)) / 1000);
        }

        if (step.type === 'PLANNER_RESPONSE') {
          const thinking = step.thinking || step.content;
          if (thinking) {
            process.stdout.write(formatThinking(thinking, duration));
          }
          if (step.tool_calls && step.tool_calls.length > 0) {
            step.tool_calls.forEach(tc => {
              const mappedName = mapToolName(tc.name, tc.args);
              const mappedArg = getToolArg(tc.name, tc.args);
              console.log(` ${colors.green}•${colors.reset} ${colors.yellow}${mappedName}${colors.reset}(${mappedArg}) ${colors.dim}(ctrl+o to expand)${colors.reset}`);
            });
          }
        } else if (step.type === 'SUBAGENT_RESPONSE' || step.type === 'TEXT') {
          console.log(step.content || '');
        }
      }
    };

    const processFile = () => {
      try {
        const content = fs.readFileSync(logPath, 'utf8');
        steps = content.split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
        
        drawDashboard();
      } catch (err) {}
    };

    const initWatch = () => {
      processFile();

      activeWatcher = fs.watch(logPath, (eventType) => {
        if (eventType === 'change') {
          processFile();
        }
      });
    };

    if (!fs.existsSync(logPath)) {
      console.log(`${colors.yellow}Waiting for log file to be created: ${convId}...${colors.reset}`);
      activeFileInterval = setInterval(() => {
        if (fs.existsSync(logPath)) {
          clearInterval(activeFileInterval);
          activeFileInterval = null;
          initWatch();
        }
      }, 500);
    } else {
      initWatch();
    }
  };

  if (mode === 'auto') {
    console.log(`${colors.yellow}${colors.bright}[Auto-Detect Mode] Monitoring brain folder for subagents...${colors.reset}`);
    
    const checkAndSwitch = () => {
      const latestId = getLatestSubagentId();
      if (latestId && latestId !== currentMonitoredId) {
        currentMonitoredId = latestId;
        const logPath = path.join(brainDir, latestId, '.system_generated', 'logs', 'transcript.jsonl');
        stopActiveMonitoring();
        startMonitoring(logPath, latestId);
      }
    };

    checkAndSwitch();

    fs.watch(brainDir, (eventType, filename) => {
      setTimeout(checkAndSwitch, 300);
    });
  } else {
    startMonitoring(targetLogPath, targetConvId);
  }
};

main();
