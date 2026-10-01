import { fileTools, fileChangeTracker } from './files.js';
import { searchTools } from './search.js';
import { commandTools } from './commands.js';
import { gitTools } from './git.js';
import { webTools } from './web.js';
import { browserTools } from './browser.js';
import { desktopTools } from './desktop.js';
import { layaTools, layaToolsSchema } from './laya.js';

export { fileChangeTracker };
export const toolsImplementations = { ...fileTools, ...searchTools, ...commandTools, ...gitTools, ...webTools, ...browserTools, ...desktopTools, ...layaTools };
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
  ...layaToolsSchema,
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
  tool('browser_navigate', 'Abre una URL HTTP/HTTPS en un navegador Chromium controlado por Puppeteer. Puedes mostrar la ventana y elegir entre un perfil aislado o el perfil de Chrome del usuario; el uso del perfil real requiere autorización explícita de la CLI y no queda autorizado por este argumento por sí solo.', { url: stringProperty('URL'), show_browser: { type: ['boolean', 'null'], description: 'true para mostrar la ventana del navegador al usuario; false para ejecutarlo sin interfaz; null conserva la configuración actual.' }, use_user_profile: { type: ['boolean', 'null'], description: 'true para usar las cookies, historial y sesión del perfil de Chrome del usuario; false para un perfil aislado; null conserva la configuración actual.' } }),
  tool('browser_click', 'Hace clic en un elemento de la página usando un selector CSS.', { selector: stringProperty('Selector CSS') }),
  tool('browser_type', 'Escribe texto en un campo del navegador y opcionalmente pulsa Enter.', { selector: stringProperty('Selector CSS'), text: stringProperty('Texto'), press_enter: { type: 'boolean' } }),
  tool('browser_screenshot', 'Toma una captura PNG y, opcionalmente, la guarda en una ruta relativa al proyecto para que el usuario pueda verla.', { full_page: { type: 'boolean' }, save_path: { type: ['string', 'null'], description: 'Ruta relativa del archivo PNG que se guardará; usa null para no guardarla.' } }),
  tool('computer_screenshot', 'Captura el viewport visible de Chromium para inspección visual; requiere iniciar el navegador con browser_navigate.', { save_path: { type: ['string', 'null'], description: 'Ruta relativa del archivo PNG que se guardará; usa null para no guardarla.' } }),
  tool('computer_click', 'Hace clic en coordenadas x/y dentro del viewport visible de Chromium.', { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'middle', 'right'] }, click_count: { type: 'integer' } }),
  tool('computer_type', 'Escribe texto en el elemento que tenga el foco en Chromium.', { text: stringProperty('Texto que se escribirá') }),
  tool('computer_keypress', 'Envía una tecla o combinación de teclas al viewport de Chromium (por ejemplo Enter, Tab o Control+A).', { key: stringProperty('Tecla o combinación') }),
  tool('computer_scroll', 'Desplaza la página en el punto indicado del viewport visible de Chromium.', { x: { type: 'number' }, y: { type: 'number' }, delta_y: { type: 'number' } }),
  tool('computer_move', 'Mueve el puntero a coordenadas del viewport visible de Chromium.', { x: { type: 'number' }, y: { type: 'number' } }),
  tool('desktop_screenshot', 'Captura la pantalla real del escritorio, incluidas aplicaciones y ventanas fuera del navegador. Para ahorrar tokens y acelerar la captura, puedes limitarla a una región; al actuar después, suma el origen x/y de capture_region a las coordenadas locales de la imagen. Pasa region=null para capturar la pantalla completa.', {
    save_path: { type: ['string', 'null'], description: 'Ruta relativa del PNG a guardar; null para no guardarlo.' },
    region: { type: ['object', 'null'], description: 'Rectángulo a capturar en coordenadas absolutas de pantalla; usa null para la pantalla completa.', properties: {
      x: { type: 'integer', description: 'Borde izquierdo en píxeles.' },
      y: { type: 'integer', description: 'Borde superior en píxeles.' },
      width: { type: 'integer', description: 'Ancho en píxeles.' },
      height: { type: 'integer', description: 'Alto en píxeles.' },
    }, required: ['x', 'y', 'width', 'height'], additionalProperties: false },
  }),
  tool('desktop_click', 'Hace clic con el ratón del sistema en coordenadas absolutas de la pantalla. Requiere autorización de sesión gestionada por la CLI.', { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'middle', 'right'] }, click_count: { type: 'integer' } }),
  tool('desktop_type', 'Escribe texto usando el teclado del sistema en la aplicación actualmente enfocada. Requiere autorización de sesión gestionada por la CLI.', { text: stringProperty('Texto que se escribirá') }),
  tool('desktop_keypress', 'Envía una tecla o combinación al teclado del sistema (por ejemplo Enter, Tab, Control+A o Alt+Tab). Requiere autorización de sesión gestionada por la CLI.', { key: stringProperty('Tecla o combinación') }),
  tool('desktop_scroll', 'Desplaza la ventana bajo el puntero usando el ratón del sistema. Requiere autorización de sesión gestionada por la CLI.', { x: { type: 'number' }, y: { type: 'number' }, delta_y: { type: 'number' } }),
  tool('desktop_sequence', 'Ejecuta hasta 25 acciones de escritorio nut.js en orden con una sola llamada. Las acciones posibles son move, click, keypress, type y scroll. Para los campos no usados en una acción, pasa null; para click, usa button=left|middle|right y click_count=1|2.', {
    actions: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', properties: {
      type: { type: 'string', enum: ['move', 'click', 'keypress', 'type', 'scroll'] },
      x: { type: ['number', 'null'] }, y: { type: ['number', 'null'] },
      button: { type: ['string', 'null'], enum: ['left', 'middle', 'right', null] },
      click_count: { type: ['integer', 'null'] }, key: { type: ['string', 'null'] },
      text: { type: ['string', 'null'] }, delta_y: { type: ['number', 'null'] },
    }, required: ['type', 'x', 'y', 'button', 'click_count', 'key', 'text', 'delta_y'], additionalProperties: false } },
  }),
  tool('browser_close', 'Cierra el navegador Puppeteer actual.', {}),
];