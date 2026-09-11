import { fileTools, fileChangeTracker } from './files.js';
import { searchTools } from './search.js';
import { commandTools } from './commands.js';
import { gitTools } from './git.js';
import { webTools } from './web.js';

export { fileChangeTracker };
export const toolsImplementations = { ...fileTools, ...searchTools, ...commandTools, ...gitTools, ...webTools };
// ./tools/index.js

const stringProperty = (description) => ({ type: 'string', description });

// Función helper corregida para OpenAI Responses API
const tool = (name, description, properties = {}) => ({
  type: 'function',
  name,
  description,
  parameters: {
    type: 'object',
    properties,
    required: Object.keys(properties), // Genera automáticamente ['dir_path'], ['path'], etc.
    additionalProperties: false,
  },
  strict: true,
});

export const toolsSchema = [
  tool('list_dir', 'Lista archivos y carpetas del proyecto.', { dir_path: stringProperty('Ruta relativa') }),
  tool('glob', 'Busca archivos con patrones, incluyendo ** y *.', { pattern: stringProperty('Patrón'), search_dir: stringProperty('Directorio base'), max_results: { type: 'integer' } }),
  tool('grep', 'Busca texto o expresiones regulares.', { query: stringProperty('Texto o expresión regular'), search_dir: stringProperty('Directorio'), file_pattern: stringProperty('Filtro'), max_results: { type: 'integer' }, context: { type: 'integer' } }),
  tool('read_file', 'Lee un archivo de texto.', { path: stringProperty('Ruta') }),
  tool('update_file', 'Modifica un archivo.', { path: stringProperty('Ruta'), old_string: stringProperty('Texto original'), new_string: stringProperty('Texto nuevo') }),
  tool('write_file', 'Crea o sobrescribe un archivo.', { path: stringProperty('Ruta'), content: stringProperty('Contenido') }),
  tool('run_command', 'Ejecuta un comando no interactivo.', { command: stringProperty('Ejecutable'), args: { type: 'array', items: { type: 'string' } }, timeout: { type: 'integer' } }),
  tool('git_status', 'Muestra el estado de Git.', {}),
  tool('git_diff', 'Muestra cambios de Git.', { staged: { type: 'boolean' } }),
  tool('git_log', 'Muestra commits recientes.', { limit: { type: 'integer' } }),
  tool('git_commit', 'Crea un commit de cambios rastreados.', { message: stringProperty('Mensaje') }),
  tool('git_branch', 'Crea y cambia a una rama nueva.', { name: stringProperty('Nombre') }),
  tool('web_search', 'Busca información actual en Internet.', { query: stringProperty('Consulta'), max_results: { type: 'integer' } }),
  tool('web_fetch', 'Obtiene una página HTTP/HTTPS.', { url: stringProperty('URL'), extract: { type: 'string', enum: ['text', 'links', 'html'] }, max_chars: { type: 'integer' } }),
];