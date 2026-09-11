import { fileTools, fileChangeTracker } from './files.js';
import { searchTools } from './search.js';
import { commandTools } from './commands.js';
import { gitTools } from './git.js';
import { webTools } from './web.js';

export { fileChangeTracker };
export const toolsImplementations = { ...fileTools, ...searchTools, ...commandTools, ...gitTools, ...webTools };
const stringProperty = (description) => ({ type: 'string', description });
const tool = (name, description, properties, required = []) => ({ type: 'function', name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, strict: true });
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
  tool('web_search', 'Busca información actual en Internet usando resultados web. Después puede usarse web_fetch para verificar fuentes.', { query: stringProperty('Consulta'), max_results: { type: 'integer' } }, ['query']),
  tool('web_fetch', 'Obtiene una página HTTP/HTTPS y extrae texto o enlaces para investigación. No ejecuta JavaScript.', { url: stringProperty('URL'), extract: { type: 'string', enum: ['text', 'links', 'html'] }, max_chars: { type: 'integer' } }, ['url']),
];
