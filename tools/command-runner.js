import { execFile, spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';
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

// En algunas imágenes de Node `npm` está instalado, pero su lanzador no es
// ejecutable (por ejemplo, falta el intérprete de su shebang). En ese caso
// `execFile('npm')` y `spawn('npm')` producen ENOENT aunque Node y npm estén
// presentes. Ejecutar el CLI con el mismo Node evita depender de ese shebang.
function npmCliPath() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    // Instalación oficial de Node en Windows.
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    // Instalaciones Unix y gestores como nvm.
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => {
    try {
      accessSync(candidate, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function resolveCommand(command, args) {
  if (command === 'npm' || command === 'npm.cmd') {
    const cli = npmCliPath();
    if (cli) return { command: process.execPath, args: [cli, ...args] };
  }
  return { command, args };
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

export async function runCommand(command, args = [], { cwd, timeout = COMMAND_TIMEOUT, signal } = {}) {
  if (signal?.aborted) throw new DOMException('La ejecución fue cancelada.', 'AbortError');
  const effectiveTimeout = limitTimeout(timeout);
  const options = { cwd, timeout: effectiveTimeout, maxBuffer: MAX_BUFFER, signal };
  const resolved = resolveCommand(command, args);
  try {
    return await execFileAsync(resolved.command, resolved.args, options);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return spawnCommand(resolved.command, resolved.args, { cwd, timeout: effectiveTimeout, signal });
  }
}
