import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findPython, inspectPython } from '../scripts/python-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFile = path.join(os.homedir(), '.mini-agent', 'laya-python.json');
const serverFile = path.join(root, 'laya', 'laya_server.py');
let childProcess = null;
process.once('exit', () => {
  if (childProcess && childProcess.exitCode === null && childProcess.signalCode === null) childProcess.kill();
});

function getServerAddress() {
  const address = new URL(process.env.LAYA_SERVER_URL || 'http://127.0.0.1:18765');
  if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) {
    throw new Error('LAYA_SERVER_URL debe apuntar a un servidor HTTP de loopback.');
  }
  if (address.username || address.password || address.search || address.hash) {
    throw new Error('LAYA_SERVER_URL no puede incluir credenciales, query o fragmento.');
  }
  const port = Number(address.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El puerto de LAYA_SERVER_URL no es válido.');
  return {
    healthUrl: new URL('health', address.pathname.endsWith('/') ? address : new URL(`${address.href}/`)).href,
    port,
    host: address.hostname === '[::1]' ? '::1' : '127.0.0.1',
    pathPrefix: address.pathname.replace(/\/$/, ''),
  };
}

async function configuredPython() {
  if (process.env.LAYA_PYTHON) {
    const candidate = { command: process.env.LAYA_PYTHON, args: [] };
    if (inspectPython(candidate, true) === null) throw new Error('LAYA_PYTHON no puede importar el paquete laya. Ejecuta npm install o selecciona otro Python.');
    return candidate;
  }
  try {
    const config = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
    const candidate = { command: config.command, args: Array.isArray(config.args) ? config.args : [] };
    if (typeof candidate.command === 'string' && inspectPython(candidate, true) !== null) return candidate;
  } catch { /* buscar Python en PATH */ }
  const candidate = findPython(true);
  if (!candidate) throw new Error('No se encontró Python con Laya instalado. Ejecuta npm install para instalar las dependencias locales.');
  return { command: candidate.command, args: candidate.args };
}

async function findFreePort(host) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function probe(address) {
  try {
    const response = await fetch(address.healthUrl, { signal: AbortSignal.timeout(700) });
    if (response.ok) return 'healthy';
    const body = await response.text();
    // Compatibilidad con el servidor anterior: BaseHTTPRequestHandler responde 501 a GET.
    if (response.status === 501 && /Unsupported method/.test(body)) return 'legacy';
  } catch { /* el puerto aún no está disponible */ }
  return 'offline';
}

export async function ensureLayaServerStarted({ timeoutMs = 10_000, log = console.log } = {}) {
  const address = getServerAddress();
  const existing = await probe(address);
  if (existing === 'healthy') {
    log('Servidor Laya local ya disponible; se reutilizará el proceso existente.');
    return { started: false, reused: true };
  }
  if (existing === 'legacy') {
    if (process.env.LAYA_SERVER_URL) throw new Error('El servidor configurado usa una versión antigua y el puerto ya está ocupado. Detén ese proceso o configura otro LAYA_SERVER_URL.');
    const port = await findFreePort(address.host);
    process.env.LAYA_SERVER_URL = `http://${address.host === '::1' ? '[::1]' : address.host}:${port}`;
    log(`Se detectó un servidor Laya externo antiguo en el puerto ${address.port}; se iniciará el servidor incluido en el puerto local ${port}.`);
    return ensureLayaServerStarted({ timeoutMs, log });
  }

  const python = await configuredPython();
  childProcess = spawn(python.command, [...python.args, serverFile], {
    cwd: root,
    env: { ...process.env, LAYA_PORT: String(address.port), LAYA_HOST: address.host, LAYA_PATH_PREFIX: address.pathPrefix },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let output = '';
  const appendOutput = (chunk) => { output = `${output}${chunk}`.slice(-6000); };
  childProcess.stdout.setEncoding('utf8').on('data', appendOutput);
  childProcess.stderr.setEncoding('utf8').on('data', appendOutput);
  const currentChild = childProcess;
  let startupError = null;
  currentChild.once('error', (error) => { startupError = error.message; output += `\n${error.message}`; });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (startupError || currentChild.exitCode !== null || currentChild.signalCode !== null) {
      childProcess = null;
      throw new Error(`No se pudo iniciar el servidor Laya.${output ? `\n${output.trim()}` : ''}`);
    }
    if (await probe(address) === 'healthy') {
      log('Servidor Laya iniciado junto con el agente.');
      return { started: true, reused: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  currentChild.kill();
  childProcess = null;
  throw new Error(`El servidor Laya no respondió en ${timeoutMs} ms.${output ? `\n${output.trim()}` : ''}`);
}

export async function stopLayaServer() {
  const processToStop = childProcess;
  childProcess = null;
  if (!processToStop || processToStop.exitCode !== null || processToStop.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      processToStop.kill();
      resolve();
    }, 3_000);
    timer.unref?.();
    processToStop.once('exit', () => { clearTimeout(timer); resolve(); });
    processToStop.kill('SIGTERM');
  });
}
