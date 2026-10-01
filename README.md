# Mini Agent CLI

Agente CLI autónomo para explorar, modificar y ejecutar tareas seguras dentro de un proyecto.

## Requisitos

- Node.js 18 o posterior.
- Python 3.10 o posterior y pip (Laya y sus dependencias se instalan automáticamente durante `npm install`).
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
- `--no-goal`: desactiva el modo goal, que está activado por defecto.
- `--no`: activa las confirmaciones para escrituras, commits y ramas. Por defecto se omiten.
- `--yes` o `-y`: alias heredado; mantiene el modo sin confirmaciones para escrituras habituales. No omite la autorización del perfil real de Chrome.
- `--allow-chrome-profile`: autoriza explícitamente el acceso al perfil real de Chrome durante esta ejecución. Sin esta opción, se pide consentimiento interactivo; en modo no interactivo el acceso se rechaza.

La CLI limita por defecto cada solicitud a un máximo preventivo de 160.000 tokens (incluida una reserva de hasta 8.000 tokens de salida) y compacta el historial al acercarse al 80 % del presupuesto de entrada, o al 75 % de la ventana de contexto del modelo si ese umbral es menor. Esto evita enviar prompts desmesurados como el de 254.050 tokens que puede superar un límite TPM de 200.000. La compactación conserva literalmente el mensaje más reciente del usuario y resume el historial anterior; si el contenido actual por sí solo excede el presupuesto, la CLI detiene la solicitud en vez de enviarla sin límite. Como la cuota TPM es compartida y por minuto, otras solicitudes de la organización pueden consumirla y ningún límite local garantiza evitar todos los 429. Ajusta el máximo con `MINI_AGENT_MAX_REQUEST_TOKENS` solo si el límite de tu organización lo permite. Las ventanas predeterminadas son 1.000.000 tokens para `gpt-6-luna` y `gpt-6-astra`, 1.050.000 para `gpt-6.1-sol` y 400.000 para `gpt-5.6-terra`. Puedes declarar otras capacidades con `MINI_AGENT_CONTEXT_WINDOWS`, un objeto JSON cuyas claves son los identificadores de modelo y cuyos valores son sus ventanas en tokens, por ejemplo `{"gpt-6-luna":1000000,"gpt-5.6-terra":200000}`. `MINI_AGENT_CONTEXT_WINDOW_TOKENS` fuerza una capacidad global y `MINI_AGENT_COMPACT_MODEL` permite elegir otro modelo de compactación.

## Comandos interactivos

- `/help`: muestra la ayuda.
- `/goal [on|off]`: activa o desactiva la revisión automática e independiente de los cambios (activada por defecto). Al terminar una tarea con archivos modificados, un revisor comprueba la evidencia; si encuentra problemas, los devuelve al agente principal para corregirlos. Hay hasta tres rondas de corrección. Si el revisor falla o persisten problemas, el CLI indica que el cambio queda sin verificar. Define `MINI_AGENT_REVIEW_MODEL` para usar otro modelo en la revisión; por defecto usa el modelo actual.
- `/model [luna|terra|sol|astra]`: consulta o cambia el modelo. Los modelos nuevos están disponibles como `luna` (`gpt-6-luna`) y `sol` (`gpt-6.1-sol`); Luna es el modelo predeterminado del proyecto. `sol` usa GPT-6.1 Sol ($2/1M tokens de entrada, $10/1M de salida según la documentación de OpenAI). `astra` usa `gpt-6-astra` ($10/1M tokens de entrada, $50/1M de salida).

Los identificadores, la ventana de contexto y los precios de GPT-6.1 Sol se contrastaron con la [documentación oficial del modelo](https://developers.openai.com/api/docs/models/gpt-6.1-sol). El precio estándar publicado para GPT-6.1 Sol es $2/$10 por millón de tokens (entrada/salida); `/usage` muestra estimaciones simplificadas y no incluye tarifas especiales, caché ni recargos.
- `/usage [today|month|modelo]`: consulta tokens, costes y errores registrados en SQLite.
- `/attach <archivo> [archivo2]`: adjunta imágenes PNG/JPG/WEBP o PDF del dispositivo al siguiente mensaje. Los archivos se codifican como `input_image` o `input_file` siguiendo Responses API y no se copian al proyecto.

La búsqueda web y la navegación Puppeteer se publican como herramientas MCP con nombres `mcp__mini_agent__web_search`, `mcp__mini_agent__web_fetch` y `mcp__mini_agent__browser_*`; el agente descubre sus esquemas al iniciar. El control visual de Chromium sigue disponible como herramientas directas (`computer_screenshot`, `computer_click`, `computer_type`, `computer_keypress`, `computer_scroll`, `computer_move`) y el control nut.js del escritorio sigue siendo directo (`desktop_*`). Browser MCP también opera dentro de Chromium, no controla aplicaciones nativas ni otras ventanas. Las capturas se envían al modelo como `input_image` una sola vez y, tras una respuesta correcta, se eliminan del historial retenido (también al guardar/cargar una sesión), dejando un marcador de texto pequeño. Para automatización visual, usa `mcp__mini_agent__browser_navigate` con `show_browser: true`, toma `computer_screenshot`, actúa con coordenadas relativas a esa captura y vuelve a inspeccionar después de cada acción importante. La navegación MCP conserva la autorización independiente para el perfil real de Chrome (`use_user_profile: true`), salvo que se inicie con `--allow-chrome-profile`. El perfil del usuario puede requerir cerrar Chrome previamente; también puedes definir `CHROME_USER_DATA_DIR` si está en una ubicación distinta. `mcp__mini_agent__browser_screenshot` acepta `save_path` (una ruta relativa, por ejemplo `screenshots/inicio.png`) para guardar también la imagen dentro del proyecto; usa `null` si solo necesitas inspeccionarla.

Las herramientas `desktop_*` actúan sobre la pantalla real y otras aplicaciones, fuera de Chromium, y se ejecutan automáticamente sin confirmación por herramienta. El sistema operativo puede requerir permisos propios para captura de pantalla/control de accesibilidad. En Windows también están disponibles `desktop_inspect` y `desktop_click_element`, basadas en `System.Windows.Automation`: inspeccionan los controles accesibles de la ventana activa e invocan el elemento por nombre (o usan nut.js con su rectángulo cuando no ofrece `InvokePattern`). Esta información puede ser incompleta en aplicaciones con interfaces personalizadas; si no aparece un control o hay ambigüedad, el agente debe recurrir a la captura visual. Estas dos herramientas no se registran ni se anuncian en macOS/Linux. Esto no concede acceso al perfil real de Chrome, que mantiene su autorización independiente.

### MCP y servidores externos

La CLI inicia un servidor MCP local por stdio junto con el agente, descubre sus herramientas con el SDK oficial y las presenta al modelo como funciones `mcp__servidor__herramienta`. Las herramientas web y de Puppeteer de Mini Agent se exponen así; archivos, Git, comandos seguros, Laya, `desktop_*` y el control visual `computer_*` permanecen como tools nativas porque necesitan las políticas y el flujo local de la CLI. Las capturas MCP se convierten en imágenes para el modelo, no en base64 dentro del texto.

Para compartir las integraciones web/navegador con otra aplicación MCP, configura un servidor `stdio` con el comando `node` y el archivo `tools/mcp-server.js` de esta instalación; también puedes ejecutarlo manualmente con `npm run mcp`. El servidor exporta las herramientas MCP de búsqueda web y navegador; por seguridad, las instancias MCP independientes solo usan perfiles aislados y rechazan `use_user_profile: true`. En la CLI integrada se conserva la confirmación separada para el perfil real de Chrome.

Puedes añadir MCPs `stdio` externos en `~/.mini-agent/mcp.json` (o indicar otro archivo con `MINI_AGENT_MCP_CONFIG`):

```json
{
  "mcpServers": {
    "filesystem-extra": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/ruta/permitida"]
    }
  }
}
```

Cada entrada admite `command`, `args`, `cwd` y un mapa opcional `env`; se inicia sin shell. Añade únicamente servidores de confianza: el programa ejecutable expone sus propias capacidades al agente. Evita guardar secretos en el JSON; declara solo las variables necesarias para ese servidor en `env` y protege ese archivo. Los servidores no disponibles se informan como avisos y las demás herramientas siguen funcionando. Los MCP externos se descubren al principio de cada ejecución y se cierran al salir; las herramientas anotadas como destructivas (o con nombres de acción claramente irreversible) pasan por la confirmación de la CLI cuando se usa `--no`.

### Optimización de nut.js

Las operaciones de escritorio `desktop_*` utilizan nut.js: velocidad del puntero `3000 px/s`, sin pausa entre operaciones del ratón y escritura con `10 ms` entre teclas para conservar fiabilidad. En Windows, `desktop_inspect` y `desktop_click_element` añaden la capa UI Automation; los clics semánticos usan `InvokePattern` cuando está disponible y nut.js como alternativa por coordenadas. `desktop_sequence` agrupa hasta 25 movimientos, clics, atajos, escritura o scroll en una sola llamada, reduciendo rondas agente/herramienta durante navegación repetitiva. Puedes ajustar las preferencias con `MINI_AGENT_NUT_MOUSE_SPEED` (100–20 000), `MINI_AGENT_NUT_MOUSE_DELAY_MS` (0–1000) y `MINI_AGENT_NUT_KEYBOARD_DELAY_MS` (0–1000); si el destino pierde teclas, incrementa la pausa del teclado. La documentación consultada describe estas opciones y la búsqueda por región, que es más rápida que buscar toda la pantalla: [configuración](https://nutjs.dev/docs/configuration), [control de ratón](https://nutjs.dev/docs/mouse), [teclado](https://nutjs.dev/docs/keyboard) y [pantalla/regiones](https://nutjs.dev/docs/screen).

### Modelo local Laya

La herramienta `laya_predict` usa el servidor incluido en `laya/laya_server.py` (`POST /predict` en `http://127.0.0.1:18765`). Al ejecutar `npm install`, un hook de Node detecta Python e instala `laya==0.3.20` con pip; si no puede instalarlo en el Python elegido, intenta un entorno aislado en `~/.mini-agent/laya-venv`. La CLI inicia el servidor al arrancar y lo detiene al salir; no hace falta iniciar un proceso Python a mano. Si el puerto predeterminado ya está ocupado por el servidor antiguo, inicia el incluido en un puerto local libre. La primera inferencia puede tardar mientras Laya carga o descarga sus checkpoints. Después de cada llamada, la CLI muestra las respuestas, las distribuciones de probabilidad como porcentajes, las puntuaciones ordinales, la confianza calibrada/no calibrada y los datos de enrutamiento/uso que devuelva Laya. No requiere una API key para el propio modelo local. Opcionalmente define `LAYA_PYTHON` para elegir el ejecutable de Python o `LAYA_SERVER_URL` para cambiar el servidor (solo `localhost`, `127.0.0.1` o `::1`).

Laya no es un chat/LLM generativo: responde preguntas tipadas y puede contestar varias sobre el mismo `state` en una sola llamada. Usa `choice` para elegir entre 2-20 categorías definidas claramente (añade una opción residual, como `otro`, si tiene sentido), `score` para una escala ordinal descrita de menor a mayor, y `noul` para una pregunta sí/no cuya respuesta positiva esté definida explícitamente. El agente recibe las respuestas y probabilidades del modelo; debe tratarlo como una señal rápida, no como certeza ni como fuente de explicaciones. Para tareas abiertas, razonamiento extenso o decisiones de alto impacto, utiliza el modelo principal y valida la evidencia.

Ejemplo de intención: clasificar un ticket en soporte/facturación/otro y puntuar su urgencia en la misma llamada, pasando el texto del ticket como `state`. El `Router` de Laya selecciona automáticamente el checkpoint según el idioma. Documentación del proyecto Laya: <https://github.com/NandhaKishorM/laya> y <https://pypi.org/project/laya/>.

Mientras el agente está procesando una respuesta o esperando resultados de herramientas, pulsa `Esc` para descartarla y enviar un nuevo mensaje dentro de la conversación. Si había herramientas en ejecución, la conversación recibe una salida indicando que la ejecución fue cancelada y el mensaje escrito después de `Esc`.

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
- `tools/web.js`: búsqueda web y obtención de páginas HTTP/HTTPS con extracción de texto, enlaces o HTML limitado; se sirven por el MCP integrado.
- `tools/browser.js`: navegación Puppeteer, interacción básica y capturas PNG, publicadas al agente como tools MCP locales.
- `tools/mcp.js` y `tools/mcp-server.js`: servidor MCP stdio propio, descubrimiento/llamadas MCP locales y conexión a servidores MCP externos configurados.
- `tools/desktop.js`: control nut.js del escritorio, incluidas secuencias agrupadas para automatización más rápida.
- `tools/windows-uia.js`: inspección UI Automation y clics semánticos disponibles solo en Windows.
- `laya/`: servidor HTTP local de Laya y requisitos Python; `laya/server-manager.js` inicia y detiene el proceso junto con la CLI.
- `scripts/install-laya.js`: instala/verifica el paquete Python Laya durante `npm install`.
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
