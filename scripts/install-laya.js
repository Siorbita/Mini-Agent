import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPython, inspectPython } from './python-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requirements = path.join(root, 'laya', 'requirements.txt');
const runtimeDirectory = path.join(os.homedir(), '.mini-agent');
const runtimeFile = path.join(runtimeDirectory, 'laya-python.json');
const venvDirectory = path.join(runtimeDirectory, 'laya-venv');
const venvPython = path.join(venvDirectory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  return result.status === 0;
}

async function saveRuntime(command, args = []) {
  await fs.mkdir(runtimeDirectory, { recursive: true });
  await fs.writeFile(runtimeFile, JSON.stringify({ command, args }, null, 2));
}

async function main() {
  const ready = findPython(true);
  if (ready) {
    await saveRuntime(ready.command, ready.args);
    console.log(`Laya ya está instalado en Python (${ready.output}).`);
    return;
  }

  const python = findPython(false);
  if (!python) {
    throw new Error('No se encontró Python. Instala Python 3.10 o posterior, o define LAYA_PYTHON, y vuelve a ejecutar npm install.');
  }

  console.log('Instalando el servidor local y el paquete Laya de Python (puede descargar dependencias grandes como PyTorch)...');
  const pipArgs = [...python.args, '-m', 'pip', 'install'];
  if (!process.env.VIRTUAL_ENV) pipArgs.push('--user');
  pipArgs.push('-r', requirements);

  if (run(python.command, pipArgs) && inspectPython(python, true) !== null) {
    await saveRuntime(python.command, python.args);
    return;
  }

  console.warn('La instalación en el Python seleccionado no funcionó; se probará en un entorno virtual aislado de ~/.mini-agent/laya-venv.');
  if (!run(python.command, [...python.args, '-m', 'venv', venvDirectory])) {
    throw new Error('No se pudo crear el entorno virtual de Laya. Comprueba que Python incluye el módulo venv.');
  }
  if (!run(venvPython, ['-m', 'pip', 'install', '-r', requirements]) || inspectPython({ command: venvPython, args: [] }, true) === null) {
    throw new Error('No se pudo instalar laya en el entorno virtual. Revisa la salida de pip y vuelve a ejecutar npm install.');
  }
  await saveRuntime(venvPython);
}

main().catch((error) => {
  console.error(`Error configurando Laya: ${error.message}`);
  process.exitCode = 1;
});
