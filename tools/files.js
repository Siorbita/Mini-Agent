import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath, shouldIgnore } from './security.js';

const MAX_REQUEST_FILE_BYTES = 20 * 1024 * 1024;
const REQUEST_FILE_TYPES = {
  '.png': ['image/png', 'input_image'], '.jpg': ['image/jpeg', 'input_image'],
  '.jpeg': ['image/jpeg', 'input_image'], '.gif': ['image/gif', 'input_image'],
  '.webp': ['image/webp', 'input_image'], '.pdf': ['application/pdf', 'input_file'],
  '.txt': ['text/plain', 'input_file'], '.md': ['text/markdown', 'input_file'],
  '.csv': ['text/csv', 'input_file'], '.json': ['application/json', 'input_file'],
};

async function requestFile(filePath) {
  const absolute = safePath(filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`${filePath} no es un archivo.`);
  if (stat.size > MAX_REQUEST_FILE_BYTES) throw new Error(`${filePath} supera el límite de 20 MB.`);
  const type = REQUEST_FILE_TYPES[path.extname(absolute).toLowerCase()];
  if (!type) throw new Error(`Tipo no compatible: ${path.extname(absolute) || '(sin extensión)'}.`);
  return { path: filePath, filename: path.basename(absolute), mime_type: type[0], input_type: type[1], data: (await fs.readFile(absolute)).toString('base64') };
}

export const fileChangeTracker = {
  changes: [],
  reset() { this.changes.length = 0; },
  record(change) { this.changes.push(change); },
  list() { return [...this.changes]; }
};

export const fileTools = {
  request_files: async ({ paths }) => {
    try {
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > 5) throw new Error('Indica entre 1 y 5 rutas.');
      const files = await Promise.all(paths.map(requestFile));
      return JSON.stringify({ success: true, message: 'Archivos disponibles como adjuntos para el modelo.', files });
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  list_dir: async ({ dir_path = '.' }) => {
    try {
      const entries = await fs.readdir(safePath(dir_path), { withFileTypes: true });
      return JSON.stringify({
        path: dir_path,
        contents: entries.filter((entry) => !shouldIgnore(entry.name)).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }))
      });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  },
  read_file: async ({ path: filePath }) => {
    try {
      return JSON.stringify({ path: filePath, content: await fs.readFile(safePath(filePath), 'utf8') });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  },
  update_file: async ({ path: filePath, old_string, new_string }) => {
    try {
      const absolutePath = safePath(filePath);
      const content = await fs.readFile(absolutePath, 'utf8');
      const occurrences = content.split(old_string).length - 1;
      if (!occurrences) return JSON.stringify({ success: false, error: 'No se encontró coincidencia exacta para old_string.' });
      if (occurrences > 1) return JSON.stringify({ success: false, error: `old_string coincide con ${occurrences} bloques. Debe ser único.` });
      await fs.writeFile(absolutePath, content.replace(old_string, new_string), 'utf8');
      fileChangeTracker.record({ path: filePath, action: 'modificado' });
      return JSON.stringify({ success: true, message: 'Archivo actualizado correctamente.', changed: filePath });
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  write_file: async ({ path: filePath, content }) => {
    try {
      const absolutePath = safePath(filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
      fileChangeTracker.record({ path: filePath, action: 'creado o sobrescrito' });
      return JSON.stringify({ success: true, message: `Archivo escrito exitosamente en ${filePath}`, changed: filePath });
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
};

// Generador auxiliar con extracción automática de 'required'
const stringProperty = (description) => ({ type: 'string', description });
const tool = (name, description, properties = {}) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    }
  }
});

export const fileToolsSchemas = [
  tool('request_files', 'Solicita uno o varios archivos del proyecto y los adjunta al siguiente turno del modelo como base64. Solo lectura.', {
    paths: { type: 'array', minItems: 1, maxItems: 5, items: stringProperty('Ruta relativa dentro del proyecto') }
  }),
  tool('list_dir', 'Lista archivos y carpetas del proyecto.', {
    dir_path: stringProperty('Ruta relativa')
  }),
  tool('read_file', 'Lee un archivo de texto.', {
    path: stringProperty('Ruta')
  }),
  tool('update_file', 'Modifica un archivo. La CLI debe pedir confirmación antes de ejecutar esta herramienta.', {
    path: stringProperty('Ruta'),
    old_string: stringProperty('Texto original'),
    new_string: stringProperty('Texto nuevo')
  }),
  tool('write_file', 'Crea o sobrescribe un archivo. La CLI debe pedir confirmación antes de ejecutar esta herramienta.', {
    path: stringProperty('Ruta'),
    content: stringProperty('Contenido')
  })
];