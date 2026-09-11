import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './tools/command-runner.js';
const PROJECT_ROOT = path.resolve(process.cwd());
const IGNORED_DIRS = new Set(['node_modules', '.git', '.mini-agent']);
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519']);
const COMMAND_TIMEOUT = 30_000;
const MAX_RESULTS = 500;

export const fileChangeTracker = {
  changes: [],
  reset() { this.changes.length = 0; },
  record(change) { this.changes.push(change); },
  list() { return [...this.changes]; },
};

function safePath(inputPath) {
  const target = path.resolve(PROJECT_ROOT, inputPath || '.');
  const relative = path.relative(PROJECT_ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La ruta debe permanecer dentro del directorio del proyecto.');
  if (relative.split(path.sep).some((part) => SENSITIVE_NAMES.has(part) || part === '.ssh' || part.endsWith('.pem') || part.endsWith('.key'))) throw new Error('Acceso bloqueado a un archivo o directorio sensible.');
  return target;
}

function shouldIgnore(name) { return IGNORED_DIRS.has(name) || (name.startsWith('.') && name !== '.'); }

async function getFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await getFiles(resolved));
    else files.push(resolved);
  }
  return files;
}

function wildcardRegex(pattern) {
  const normalized = String(pattern || '').replaceAll('\\', '/');
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') { source += '.*'; index += 1; }
      else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += /[|\\^$+?.(){}\[\]]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`${source}$`, 'i');
}

function bounded(value, fallback = MAX_RESULTS) { return Math.max(1, Math.min(Number(value) || fallback, MAX_RESULTS)); }
async function runGit(args) { const { stdout, stderr } = await runCommand('git', args, { cwd: PROJECT_ROOT, timeout: COMMAND_TIMEOUT }); return JSON.stringify({ success: true, stdout: stdout.trim(), stderr: stderr.trim() }); }
function literalRegex(value) {
  const escaped = String(value).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
  return new RegExp(escaped, 'i');
}

export const toolsImplementations = {
  list_dir: async ({ dir_path = '.' }) => {
    try {
      const entries = await fs.readdir(safePath(dir_path), { withFileTypes: true });
      return JSON.stringify({ path: dir_path, contents: entries.filter((entry) => !shouldIgnore(entry.name)).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) });
    } catch (error) { return JSON.stringify({ error: error.message }); }
  },
  glob: async ({ pattern, search_dir = '.', max_results = MAX_RESULTS }) => {
    try {
      const regex = wildcardRegex(pattern);
      const limit = bounded(max_results);
      const matches = (await getFiles(safePath(search_dir))).map((file) => path.relative(PROJECT_ROOT, file).replaceAll(path.sep, '/')).filter((file) => regex.test(file) || regex.test(path.basename(file)) || (String(pattern).startsWith('**/') && wildcardRegex(String(pattern).slice(3)).test(path.basename(file)))).slice(0, limit);
      return JSON.stringify({ matches, count: matches.length, truncated: matches.length === limit });
    } catch (error) { return JSON.stringify({ error: error.message }); }
  },
  grep: async ({ query, search_dir = '.', file_pattern, max_results = MAX_RESULTS, context = 0 }) => {
    try {
      let searchRegex;
      try { searchRegex = new RegExp(String(query), 'i'); } catch { searchRegex = literalRegex(query); }
      const fileRegex = file_pattern ? wildcardRegex(file_pattern) : null;
      const limit = bounded(max_results);
      const contextLines = Math.max(0, Math.min(Number(context) || 0, 20));
      const results = [];
      for (const filePath of await getFiles(safePath(search_dir))) {
        const relative = path.relative(PROJECT_ROOT, filePath).replaceAll(path.sep, '/');
        if (fileRegex && !fileRegex.test(relative) && !fileRegex.test(path.basename(relative))) continue;
        let lines; try { lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/); } catch { continue; }
        for (const [index, line] of lines.entries()) {
          if (results.length >= limit) break;
          if (!searchRegex.test(line)) continue;
          const from = Math.max(0, index - contextLines); const to = Math.min(lines.length, index + contextLines + 1);
          results.push({ file: relative, line: index + 1, content: line.trim(), context: lines.slice(from, to).map((value, offset) => ({ line: from + offset + 1, content: value })) });
        }
        if (results.length >= limit) break;
      }
      return JSON.stringify({ matches: results, total_matches: results.length, truncated: results.length === limit });
    } catch (error) { return JSON.stringify({ error: `Búsqueda fallida: ${error.message}` }); }
  },
  read_file: async ({ path: filePath }) => { try { return JSON.stringify({ path: filePath, content: await fs.readFile(safePath(filePath), 'utf8') }); } catch (error) { return JSON.stringify({ error: error.message }); } },
  update_file: async ({ path: filePath, old_string, new_string }) => {
    try {
      const absolutePath = safePath(filePath); const content = await fs.readFile(absolutePath, 'utf8'); const occurrences = content.split(old_string).length - 1;
      if (!occurrences) return JSON.stringify({ success: false, error: 'No se encontró coincidencia exacta para old_string.' });
      if (occurrences > 1) return JSON.stringify({ success: false, error: `old_string coincide con ${occurrences} bloques. Debe ser único.` });
      await fs.writeFile(absolutePath, content.replace(old_string, new_string), 'utf8');
      fileChangeTracker.record({ path: filePath, action: 'modificado' });
      return JSON.stringify({ success: true, message: 'Archivo actualizado correctamente.', changed: filePath });
    } catch (error) { return JSON.stringify({ success: false, error: error.message }); }
  },
  write_file: async ({ path: filePath, content }) => { try { const absolutePath = safePath(filePath); await fs.mkdir(path.dirname(absolutePath), { recursive: true }); await fs.writeFile(absolutePath, content, 'utf8'); fileChangeTracker.record({ path: filePath, action: 'creado o sobrescrito' }); return JSON.stringify({ success: true, message: `Archivo escrito exitosamente en ${filePath}`, changed: filePath }); } catch (error) { return JSON.stringify({ success: false, error: error.message }); } },
  run_command: async ({ command, args = [], timeout = COMMAND_TIMEOUT }) => {
    try {
      if (!command || !/^[a-zA-Z0-9._-]+$/.test(command) || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('Comando o argumentos inválidos. Usa un ejecutable sin shell.');
      if (/(^|\s)(rm|del|format|shutdown|reboot|mkfs)(\s|$)/i.test([command, ...args].join(' '))) throw new Error('Comando potencialmente destructivo bloqueado.');
      const { stdout, stderr } = await runCommand(command, args, { cwd: PROJECT_ROOT, timeout });
      return JSON.stringify({ success: true, command: [command, ...args].join(' '), stdout: stdout.trim(), stderr: stderr.trim() });
    } catch (error) { return JSON.stringify({ success: false, error: error.message, stdout: error.stdout?.trim(), stderr: error.stderr?.trim() }); }
  },
  git_status: async () => { try { return await runGit(['status', '--short', '--branch']); } catch (error) { return JSON.stringify({ error: error.message }); } },
  git_diff: async ({ staged = false }) => { try { return await runGit(staged ? ['diff', '--cached'] : ['diff']); } catch (error) { return JSON.stringify({ error: error.message }); } },
  git_log: async ({ limit = 10 }) => { try { return await runGit(['log', `-${bounded(limit, 10)}`, '--oneline']); } catch (error) { return JSON.stringify({ error: error.message }); } },
  git_commit: async ({ message }) => { try { if (!message?.trim()) throw new Error('El mensaje del commit es obligatorio.'); return await runGit(['commit', '-am', message.trim()]); } catch (error) { return JSON.stringify({ error: error.message }); } },
  git_branch: async ({ name }) => { try { if (!/^[A-Za-z0-9._/-]+$/.test(name || '') || name.startsWith('-')) throw new Error('Nombre de rama inválido.'); return await runGit(['switch', '-c', name]); } catch (error) { return JSON.stringify({ error: error.message }); } },
};

const stringProperty = (description) => ({ type: 'string', description });
const tool = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const toolsSchema = [
  tool('list_dir', 'Lista archivos y carpetas del proyecto.', { dir_path: stringProperty('Ruta relativa') }),
  tool('glob', 'Busca archivos con patrones, incluyendo ** y *. Ignora node_modules, .git y carpetas ocultas.', { pattern: stringProperty('Patrón'), search_dir: stringProperty('Directorio base'), max_results: { type: 'integer' } }, ['pattern']),
  tool('grep', 'Busca texto o expresiones regulares; si la expresión es inválida la trata como texto literal.', { query: stringProperty('Texto o expresión regular'), search_dir: stringProperty('Directorio'), file_pattern: stringProperty('Filtro'), max_results: { type: 'integer' }, context: { type: 'integer' } }, ['query']),
  tool('read_file', 'Lee un archivo de texto.', { path: stringProperty('Ruta') }, ['path']),
  tool('update_file', 'Modifica un archivo. La CLI debe pedir confirmación antes de ejecutar esta herramienta.', { path: stringProperty('Ruta'), old_string: stringProperty('Texto original'), new_string: stringProperty('Texto nuevo') }, ['path', 'old_string', 'new_string']),
  tool('write_file', 'Crea o sobrescribe un archivo. La CLI debe pedir confirmación antes de ejecutar esta herramienta.', { path: stringProperty('Ruta'), content: stringProperty('Contenido') }, ['path', 'content']),
  tool('run_command', 'Ejecuta un comando no interactivo dentro del proyecto. No uses shell.', { command: stringProperty('Ejecutable'), args: { type: 'array', items: { type: 'string' } }, timeout: { type: 'integer' } }, ['command']),
  tool('git_status', 'Muestra el estado de Git.', {}), tool('git_diff', 'Muestra cambios de Git.', { staged: { type: 'boolean' } }), tool('git_log', 'Muestra commits recientes.', { limit: { type: 'integer' } }),
  tool('git_commit', 'Crea un commit de cambios rastreados. La CLI debe pedir confirmación.', { message: stringProperty('Mensaje') }, ['message']),
  tool('git_branch', 'Crea y cambia a una rama nueva. La CLI debe pedir confirmación.', { name: stringProperty('Nombre') }, ['name']),
];
