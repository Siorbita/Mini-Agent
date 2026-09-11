import path from 'node:path';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.mini-agent']);
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519']);

export function safePath(inputPath) {
  const target = path.resolve(PROJECT_ROOT, inputPath || '.');
  const relative = path.relative(PROJECT_ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La ruta debe permanecer dentro del directorio del proyecto.');
  if (relative.split(path.sep).some((part) => SENSITIVE_NAMES.has(part) || part === '.ssh' || part.endsWith('.pem') || part.endsWith('.key'))) throw new Error('Acceso bloqueado a un archivo o directorio sensible.');
  return target;
}

export function shouldIgnore(name) { return IGNORED_DIRS.has(name) || (name.startsWith('.') && name !== '.'); }
