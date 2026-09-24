# Mini Agent CLI

Agente CLI autónomo para explorar, modificar y ejecutar tareas seguras dentro de un proyecto.

## Requisitos

- Node.js 18 o posterior.
- Una API key de OpenAI.
- Git opcional para las herramientas de control de versiones.

## Instalación

```bash
npm install
```

Para instalar el comando globalmente desde el proyecto:

```bash
npm link
```

## Configuración

Puedes definir la API key mediante variable de entorno:

```bash
# Linux/macOS
export OPENAI_API_KEY="tu-api-key"

# Windows PowerShell
$env:OPENAI_API_KEY="tu-api-key"
```

Si no existe la variable, la CLI la solicitará al iniciar y la guardará en:

```text
~/.mini-agent/config.json
```

La configuración persistente puede contener preferencias como:

```json
{
  "model": "gpt-6-luna",
  "color": true,
  "verbose": false,
  "confirmWrites": true
}
```

No compartas ese archivo ni lo incluyas en Git: puede contener credenciales.

## Uso

Modo interactivo:

```bash
npm start
```

Modo no interactivo:

```bash
node index.js --prompt "Revisa la estructura del proyecto y resume los problemas"
```

Opciones disponibles:

- `--prompt <texto>`: ejecuta una tarea y termina.
- `--model <modelo>`: selecciona el modelo configurado.
- `--no-color`: desactiva colores ANSI.
- `--verbose`: muestra información de uso, tokens y coste estimado.
- `--no`: activa las confirmaciones para escrituras, commits y ramas. Por defecto se omiten.
- `--yes` o `-y`: alias heredado; mantiene el modo sin confirmaciones.

## Comandos interactivos

- `/help`: muestra la ayuda.
- `/model [luna|terra|sol|astra]`: consulta o cambia el modelo. Los modelos nuevos están disponibles como `luna` (`gpt-6-luna`) y `sol` (`gpt-6-sol`); Luna es el modelo predeterminado del proyecto. `astra` usa `gpt-6-astra` ($10/1M tokens de entrada, $50/1M de salida).

El catálogo y los identificadores se contrastaron con la documentación oficial de modelos de OpenAI: <https://developers.openai.com/api/docs/models>. El precio registrado para Luna es $2.50/$10 por millón de tokens (entrada/salida) y para Sol $0.50/$2; se usa únicamente para las estimaciones de `/usage`.
- `/usage [today|month|modelo]`: consulta tokens, costes y errores registrados en SQLite.
- `/attach <archivo> [archivo2]`: adjunta imágenes PNG/JPG/WEBP o PDF del dispositivo al siguiente mensaje. Los archivos se codifican como `input_image` o `input_file` siguiendo Responses API y no se copian al proyecto.

El agente dispone además de `browser_navigate`, `browser_click`, `browser_type` y `browser_screenshot`; Puppeteer descarga/usa Chromium en la instalación y las capturas PNG se vuelven a enviar al modelo como `input_image`. `browser_navigate` acepta `show_browser` para mostrar u ocultar la ventana y `use_user_profile` para elegir entre un perfil aislado o el perfil de Chrome del usuario (cookies, historial y sesiones). El perfil del usuario puede requerir cerrar Chrome previamente; también puedes definir `CHROME_USER_DATA_DIR` si está en una ubicación distinta. `browser_screenshot` acepta `save_path` (una ruta relativa, por ejemplo `screenshots/inicio.png`) para guardar también la imagen dentro del proyecto; usa `null` si solo necesitas inspeccionarla.

Antes de cada nuevo input se muestra automáticamente un resumen del consumo desde la última interacción y del total de la sesión actual.

- `/status`: muestra el estado actual.
- `/config`: muestra las opciones activas.
- `/pwd`: muestra el directorio del proyecto.
- `/version`: muestra la versión.
- `/history`: lista sesiones guardadas.
- `/save <nombre>`: guarda la sesión.
- `/load <nombre>`: carga una sesión.
- `/new`: inicia una sesión nueva, reinicia el contexto, los adjuntos pendientes y el contador de uso de la sesión; conserva el modelo seleccionado y la configuración. Las sesiones guardadas no se modifican.
- `/clear` o `/reset`: reinicia la conversación sin reiniciar el contador de uso de la sesión.
- `exit`, `quit` o `salir`: finaliza la CLI.

Los comandos slash tienen autocompletado contextual con `Tab`: se sugieren comandos al escribir `/` y argumentos como los modelos disponibles después de `/model `. Las flechas permiten recorrer las sugerencias y `Enter` acepta la selección.

Para salir, usa `/exit`, `/quit` o `/salir`.

## Texto multilínea

Puedes pegar bloques Markdown delimitados por triple backtick. También puedes continuar una línea usando una barra invertida al final:

```text
Analiza este código:
```js
const value = 42;
```
```

La CLI muestra `…` mientras espera las líneas restantes y conserva los saltos de línea. En terminales compatibles también activa el modo *bracketed paste*: al pegar un bloque, muestra un aviso como `📋 Se han pegado 3 líneas` y espera una instrucción explícita. El bloque se envía como contexto de esa instrucción, sin ejecutar el contenido pegado ni sus líneas intermedias.

## Herramientas

Las herramientas están separadas para facilitar su mantenimiento:

- `tools/files.js`: lectura y escritura de archivos.
- `tools/search.js`: `glob` y `grep`.
- `tools/commands.js`: ejecución segura sin shell.
- `tools/command-runner.js`: ejecutor compartido con fallback transparente a `spawn` cuando el lanzamiento con `execFile` falla por problemas del sistema.
- `tools/git.js`: estado, diferencias, historial, commits y ramas.
- `tools/web.js`: búsqueda web y obtención de páginas HTTP/HTTPS con extracción de texto, enlaces o HTML limitado.
- `tools/browser.js`: navegación controlada con Puppeteer, interacción básica y capturas PNG que el modelo recibe como imágenes.
- `attachments.js`: convierte imágenes y PDF locales en `input_image`/`input_file` de Responses API.
- `request_files`: herramienta de solo lectura que permite al agente solicitar hasta cinco archivos del proyecto; se validan la ruta y el tamaño y se entregan al modelo como `input_file`/`input_image` con Data URL base64.
- `keep-awake.js`: evita temporalmente el reposo mientras el agente procesa una tarea, sin cambiar la configuración permanente de energía.
- `tools/security.js`: validación de rutas, archivos sensibles y exclusiones.
- `tools/index.js`: registro y esquemas expuestos al agente.

Por defecto, las operaciones de escritura, commits y creación de ramas se ejecutan sin confirmación. Usa `--no` para activar las preguntas de confirmación; `--yes` y `-y` se mantienen como alias explícitos del comportamiento predeterminado.

## Seguridad

- Las rutas se limitan al directorio actual del proyecto.
- Se bloquea el acceso a `.env`, `.ssh`, claves privadas y certificados sensibles.
- Los comandos se ejecutan sin shell y tienen un timeout máximo de 30 segundos.
- Se rechazan comandos destructivos conocidos.
- Las búsquedas omiten `node_modules`, `.git` y carpetas ocultas.

Cada solicitud se registra globalmente en SQLite mediante el módulo nativo `node:sqlite`, por defecto en `~/.mini-agent/usage.sqlite`. Puedes cambiar la ruta con `MINI_AGENT_USAGE_DB`. Se guardan modelo, tokens de entrada/salida, tokens totales, coste estimado y errores. Usa `/usage`, `/usage today`, `/usage month` o `/usage <modelo>` para consultar agregados.

Revisa siempre los cambios antes de confirmarlos en Git.

## Pruebas y lint

```bash
npm test
npm run lint
```
