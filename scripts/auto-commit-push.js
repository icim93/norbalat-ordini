const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const ignoredNames = new Set(['.git', 'node_modules']);
const ignoredExactPaths = new Set([
  path.resolve(repoRoot, '.git'),
  path.resolve(repoRoot, 'node_modules'),
]);

const debounceMs = 2500;
let commitTimer = null;
let syncRunning = false;
let syncQueued = false;
let watchers = [];
const watchedPaths = new Set();

function isIgnoredPath(targetPath) {
  const normalized = path.resolve(targetPath);
  if (ignoredExactPaths.has(normalized)) return true;
  return normalized.split(path.sep).some(part => ignoredNames.has(part));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`);
      err.stdout = stdout;
      err.stderr = stderr;
      err.code = code;
      reject(err);
    });
  });
}

async function getCurrentBranch() {
  const { stdout } = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

async function hasPendingChanges() {
  const { stdout } = await runCommand('git', ['status', '--porcelain']);
  return stdout.trim().length > 0;
}

function timestampLabel() {
  const d = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function performSync() {
  if (syncRunning) {
    syncQueued = true;
    return;
  }
  syncRunning = true;
  try {
    if (!await hasPendingChanges()) return;
    const branch = await getCurrentBranch();
    const message = `auto: update ${timestampLabel()}`;
    console.log(`[autopush] commit in corso su ${branch}`);
    await runCommand('git', ['add', '-A']);
    await runCommand('git', ['commit', '-m', message]);
    await runCommand('git', ['push', 'origin', branch]);
    console.log(`[autopush] push completato: ${message}`);
  } catch (error) {
    console.error('[autopush] errore durante sync automatico');
    console.error(error.message || error);
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      scheduleSync();
    }
  }
}

function scheduleSync() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    performSync().catch(error => {
      console.error('[autopush] errore non gestito');
      console.error(error.message || error);
    });
  }, debounceMs);
}

function watchDirectory(dirPath) {
  const resolvedDir = path.resolve(dirPath);
  if (isIgnoredPath(resolvedDir)) return;
  if (watchedPaths.has(resolvedDir)) return;
  let watcher;
  try {
    watcher = fs.watch(resolvedDir, (eventType, filename) => {
      if (!filename) {
        scheduleSync();
        return;
      }
      const target = path.resolve(resolvedDir, filename.toString());
      if (isIgnoredPath(target)) return;
      scheduleSync();
      tryRegisterNestedWatch(target);
    });
    watchedPaths.add(resolvedDir);
    watchers.push(watcher);
  } catch (_) {
    return;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  entries.forEach(entry => {
    if (!entry.isDirectory()) return;
    const child = path.join(resolvedDir, entry.name);
    watchDirectory(child);
  });
}

function tryRegisterNestedWatch(targetPath) {
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (_) {
    return;
  }
  if (!stat.isDirectory()) return;
  if (isIgnoredPath(targetPath)) return;
  watchDirectory(targetPath);
}

function closeWatchers() {
  watchers.forEach(watcher => {
    try { watcher.close(); } catch (_) {}
  });
  watchers = [];
  watchedPaths.clear();
}

console.log('[autopush] watcher avviato');
console.log(`[autopush] repo: ${repoRoot}`);
console.log(`[autopush] debounce: ${debounceMs} ms`);
watchDirectory(repoRoot);

process.on('SIGINT', () => {
  clearTimeout(commitTimer);
  closeWatchers();
  console.log('\n[autopush] arrestato');
  process.exit(0);
});
