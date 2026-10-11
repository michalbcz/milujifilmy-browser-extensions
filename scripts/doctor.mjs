#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Check if terminal supports color
const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const colors = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : '',
  cyan: useColor ? '\x1b[36m' : '',
};

const symbols = {
  ok: `${colors.green}✔${colors.reset}`,
  warn: `${colors.yellow}⚠${colors.reset}`,
  fail: `${colors.red}✖${colors.reset}`,
  info: `${colors.cyan}ℹ${colors.reset}`,
};

const results = [];

function record({ name, status, message, details, required = true }) {
  results.push({ name, status, message, details, required });
  const sym = symbols[status] || '•';
  const tag = required ? '' : ` ${colors.dim}(optional)${colors.reset}`;
  console.log(`  ${sym} ${colors.bold}${name}${colors.reset}${tag}: ${message}`);
  if (details) {
    console.log(`    ${colors.dim}${details}${colors.reset}`);
  }
}

function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function commandExists(cmd) {
  const checkCmd = process.platform === 'win32' ? `where.exe ${cmd}` : `command -v ${cmd}`;
  return runCmd(checkCmd) !== null;
}

console.log(`\n${colors.bold}${colors.cyan}MilujuFilmy Doctor${colors.reset} — Checking prerequisites...\n`);

// 1. Operating System
const platformNames = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};
const osName = platformNames[process.platform] || process.platform;
record({
  name: 'Operating System',
  status: 'ok',
  message: `${osName} (${process.arch}) ${os.release()}`,
  required: false,
});

// 2. Node.js (Requirement: >= 22.0.0)
const nodeVer = process.version;
const majorNodeVer = parseInt(nodeVer.slice(1).split('.')[0], 10);
if (majorNodeVer >= 22) {
  record({
    name: 'Node.js',
    status: 'ok',
    message: `${nodeVer} (requirement: >= 22.0.0)`,
  });
} else {
  record({
    name: 'Node.js',
    status: 'fail',
    message: `${nodeVer} is outdated! Requires Node.js >= 22.0.0`,
    details: 'Please install or switch to Node.js 22 or newer via nvm, fnm, or official installer.',
    required: true,
  });
}

// 3. pnpm (Requirement: pnpm declared in package.json)
const pnpmVer = runCmd('pnpm --version');
if (pnpmVer) {
  record({
    name: 'pnpm',
    status: 'ok',
    message: `v${pnpmVer}`,
  });
} else {
  record({
    name: 'pnpm',
    status: 'fail',
    message: 'pnpm is not found in PATH',
    details: 'Enable corepack (`corepack enable && corepack prepare pnpm@12.4.2 --activate`) or install via `npm i -g pnpm`.',
    required: true,
  });
}

// 4. Git
const gitVer = runCmd('git --version');
if (gitVer) {
  record({
    name: 'Git',
    status: 'ok',
    message: gitVer,
  });
} else {
  record({
    name: 'Git',
    status: 'fail',
    message: 'Git is not found in PATH',
    details: 'Please install Git: https://git-scm.com/',
    required: true,
  });
}

// 5. Docker CLI & Docker Daemon (Requirement for local API)
const dockerVer = runCmd('docker --version');
if (dockerVer) {
  const daemonRunning = runCmd('docker info') !== null;
  if (daemonRunning) {
    record({
      name: 'Docker Engine',
      status: 'ok',
      message: `${dockerVer} (daemon is running)`,
    });
  } else {
    record({
      name: 'Docker Engine',
      status: 'warn',
      message: `${dockerVer} is installed, but daemon is not running`,
      details: 'Start Docker Desktop before running `just backend-up`.',
      required: false,
    });
  }
} else {
  record({
    name: 'Docker Engine',
    status: 'warn',
    message: 'Docker is not installed',
    details: 'Docker Desktop is required for the local API backend (`just backend-up`). https://www.docker.com/',
    required: false,
  });
}

// 6. Docker Compose
const composeVer = runCmd('docker compose version');
if (composeVer) {
  record({
    name: 'Docker Compose',
    status: 'ok',
    message: composeVer,
    required: false,
  });
} else {
  record({
    name: 'Docker Compose',
    status: 'warn',
    message: 'Docker Compose not detected',
    details: 'Docker Compose is needed for `just backend-up`. Included with Docker Desktop.',
    required: false,
  });
}

// 7. Supported Browser (Chrome or Edge in developer mode)
function findBrowsers() {
  const found = [];
  if (process.platform === 'darwin') {
    if (fs.existsSync('/Applications/Google Chrome.app')) found.push('Google Chrome');
    if (fs.existsSync('/Applications/Microsoft Edge.app')) found.push('Microsoft Edge');
    if (fs.existsSync('/Applications/Chromium.app')) found.push('Chromium');
  } else if (process.platform === 'win32') {
    const prefixes = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
    ].filter(Boolean);

    for (const prefix of prefixes) {
      if (fs.existsSync(path.join(prefix, 'Google', 'Chrome', 'Application', 'chrome.exe'))) {
        found.push('Google Chrome');
      }
      if (fs.existsSync(path.join(prefix, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))) {
        found.push('Microsoft Edge');
      }
    }
  } else {
    // Linux
    const candidates = [
      ['google-chrome', 'Google Chrome'],
      ['google-chrome-stable', 'Google Chrome'],
      ['microsoft-edge', 'Microsoft Edge'],
      ['microsoft-edge-stable', 'Microsoft Edge'],
      ['chromium', 'Chromium'],
      ['chromium-browser', 'Chromium'],
    ];
    for (const [bin, label] of candidates) {
      if (commandExists(bin) && !found.includes(label)) {
        found.push(label);
      }
    }
  }
  return found;
}

const browsers = findBrowsers();
if (browsers.length > 0) {
  record({
    name: 'Browser',
    status: 'ok',
    message: `Found ${browsers.join(', ')}`,
  });
} else {
  record({
    name: 'Browser',
    status: 'warn',
    message: 'No Chrome or Edge browser detected in standard locations',
    details: 'MilujuFilmy extension requires Chrome or Edge with Developer Mode enabled.',
    required: false,
  });
}

// 8. Playwright Chromium (For E2E tests)
function findPlaywrightChromium() {
  const home = os.homedir();
  let cacheDir = '';
  if (process.platform === 'darwin') {
    cacheDir = path.join(home, 'Library', 'Caches', 'ms-playwright');
  } else if (process.platform === 'win32') {
    cacheDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  } else {
    cacheDir = path.join(home, '.cache', 'ms-playwright');
  }

  if (fs.existsSync(cacheDir)) {
    try {
      const items = fs.readdirSync(cacheDir);
      return items.some((item) => item.startsWith('chromium'));
    } catch {
      return false;
    }
  }
  return false;
}

if (findPlaywrightChromium()) {
  record({
    name: 'Playwright Chromium',
    status: 'ok',
    message: 'Browser binaries installed for E2E tests',
    required: false,
  });
} else {
  record({
    name: 'Playwright Chromium',
    status: 'warn',
    message: 'Chromium binaries for Playwright not yet installed',
    details: 'Run `pnpm --filter @milujufilmy/extension exec playwright install chromium` if you plan to run `just test-e2e`.',
    required: false,
  });
}

// 9. Project Dependencies & Configuration
const nodeModulesExists = fs.existsSync(path.resolve('node_modules'));
if (nodeModulesExists) {
  record({
    name: 'Dependencies',
    status: 'ok',
    message: 'node_modules is present',
  });
} else {
  record({
    name: 'Dependencies',
    status: 'warn',
    message: 'node_modules is missing',
    details: 'Run `just setup` (or `pnpm install`) to install dependencies.',
    required: false,
  });
}

const pairingTokenExists = fs.existsSync(path.resolve('data', 'pairing-token.txt'));
if (pairingTokenExists) {
  record({
    name: 'Pairing Token',
    status: 'ok',
    message: 'data/pairing-token.txt exists',
    required: false,
  });
} else {
  record({
    name: 'Pairing Token',
    status: 'info',
    message: 'data/pairing-token.txt not found (created on first `just backend-up`)',
    required: false,
  });
}

// Summary
const failedRequired = results.filter((r) => r.required && r.status === 'fail');
const warnings = results.filter((r) => r.status === 'warn');

console.log('');
if (failedRequired.length === 0) {
  console.log(`${colors.green}${colors.bold}✔ All required prerequisites are met!${colors.reset}`);
  if (warnings.length > 0) {
    console.log(`${colors.dim}(There are ${warnings.length} warning(s) for optional tools or configuration.)${colors.reset}`);
  }
} else {
  console.log(`${colors.red}${colors.bold}✖ ${failedRequired.length} required prerequisite(s) missing or unsatisfied.${colors.reset}`);
  process.exit(1);
}
