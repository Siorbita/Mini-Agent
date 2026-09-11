import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const COMMAND_TIMEOUT = 30_000;
export const MAX_BUFFER = 2 * 1024 * 1024;

const execFileAsync = promisify(execFile);
const LAUNCH_ERRORS = new Set(['ENOENT', 'EACCES', 'EPERM', 'UNKNOWN']);

function limitTimeout(timeout) {
  return Math.min(Number(timeout) || COMMAND_TIMEOUT, COMMAND_TIMEOUT);
}

function shouldFallback(error) {
  return LAUNCH_ERRORS.has(error?.code) || error?.syscall === 'spawn';
}

function spawnCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error(`El comando excedió el tiempo límite de ${options.timeout} ms.`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, options.timeout);

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code, signal) => {
      if (code !== 0) {
        const error = new Error(`El comando terminó con código ${code}${signal ? ` (${signal})` : ''}.`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        finish(reject, error);
      } else finish(resolve, { stdout, stderr });
    });
  });
}

export async function runCommand(command, args = [], { cwd, timeout = COMMAND_TIMEOUT } = {}) {
  const effectiveTimeout = limitTimeout(timeout);
  const options = { cwd, timeout: effectiveTimeout, maxBuffer: MAX_BUFFER };
  try {
    return await execFileAsync(command, args, options);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return spawnCommand(command, args, { cwd, timeout: effectiveTimeout });
  }
}
