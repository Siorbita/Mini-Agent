import { fileTools, fileChangeTracker } from './files.js';
import { searchTools } from './search.js';
import { commandTools } from './commands.js';
import { gitTools } from './git.js';
import { webTools } from './web.js';
import { browserTools } from './browser.js';

export { fileChangeTracker };
export const toolsImplementations = { ...fileTools, ...searchTools, ...commandTools, ...gitTools, ...webTools, ...browserTools };
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
  tool('request_files', 'Solicita uno o varios archivos del proyecto y los adjunta al siguiente turno del modelo como base64. Solo lectura.', {
    paths: { type: 'array', minItems: 1, maxItems: 5, items: stringProperty('Ruta relativa dentro del proyecto') },
  }),
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
  tool('browser_navigate', 'Abre una URL HTTP/HTTPS en un navegador Chromium controlado por Puppeteer. Puedes mostrar la ventana y elegir entre un perfil limpio o el perfil de Chrome del usuario.', { url: stringProperty('URL'), show_browser: { type: ['boolean', 'null'], description: 'true para mostrar la ventana del navegador al usuario; false para ejecutarlo sin interfaz; null conserva la configuración actual.' }, use_user_profile: { type: ['boolean', 'null'], description: 'true para usar las cookies, historial y sesión del perfil de Chrome del usuario; false para un perfil aislado; null conserva la configuración actual.' } }),
  tool('browser_click', 'Hace clic en un elemento de la página usando un selector CSS.', { selector: stringProperty('Selector CSS') }),
  tool('browser_type', 'Escribe texto en un campo del navegador y opcionalmente pulsa Enter.', { selector: stringProperty('Selector CSS'), text: stringProperty('Texto'), press_enter: { type: 'boolean' } }),
  tool('browser_screenshot', 'Toma una captura PNG y, opcionalmente, la guarda en una ruta relativa al proyecto para que el usuario pueda verla.', { full_page: { type: 'boolean' }, save_path: { type: ['string', 'null'], description: 'Ruta relativa del archivo PNG que se guardará; usa null para no guardarla.' } }),
  tool('browser_close', 'Cierra el navegador Puppeteer actual.', {}),
];