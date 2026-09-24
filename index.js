#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import OpenAI from 'openai';
import { fileChangeTracker, toolsImplementations, toolsSchema } from './tools/index.js';
import { renderMarkdown } from './renderer.js';
import { formatUsage } from './usage.js';
import { UsageStore } from './usage-store.js';
import { extractRequestedFiles, filesToInput } from './attachments.js';
import { startKeepAwake } from './keep-awake.js';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const YES_MODE = !hasFlag('--no');
const NO_COLOR = hasFlag('--no-color');
const VERBOSE = hasFlag('--verbose');
const VERSION = '1.1.0';
const promptFlagIndex = args.indexOf('--prompt');
const initialPrompt = promptFlagIndex >= 0 ? args[promptFlagIndex + 1] : args.find((arg) => !arg.startsWith('-'));

let openai;
const MODELS = { luna: 'gpt-6-luna', terra: 'gpt-5.6-terra', sol: 'gpt-6-sol', astra: 'gpt-6-astra' };
let currentModel = MODELS.luna;
let inputReader;
const pendingAttachments = [];
const usageStore = new UsageStore();
usageStore.startSession();
let lastInteractionAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
const SESSION_DIR = path.join(os.homedir(), '.mini-agent', 'sessions');

const conversationHistory = [{ role: 'system', content: `Eres un asistente CLI de desarrollo de software autónomo.
Puedes explorar, leer y modificar archivos, ejecutar comandos seguros y consultar Git.
Trabaja de forma autónoma y actúa directamente para cumplir la tarea: no pidas confirmación verbal antes de usar herramientas ni preguntes si el usuario quiere que realices una acción que ya está incluida en su solicitud. La CLI gestiona las confirmaciones de herramientas cuando sean necesarias.
Solo detente y solicita confirmación explícita antes de acciones claramente destructivas, irreversibles o de riesgo excepcional, como borrar datos importantes, destruir el repositorio o ejecutar comandos con efectos masivos; no trates las modificaciones normales del proyecto como acciones destructivas.
Si una herramienta devuelve una operación rechazada, explica el motivo y continúa con una alternativa segura cuando sea posible.
Aprovecha la ejecución paralela de herramientas cuando sea posible.
Cuando completes una tarea del plan.txt, actualiza su casilla a [x] en la misma operación y confirma qué tarea se completó. No marques tareas parcialmente realizadas.` }];

const color = (code, text) => NO_COLOR ? text : `\x1b[${code}m${text}\x1b[0m`;
function askConfirmation(message) {
  if (YES_MODE) return Promise.resolve(true);
  if (!inputReader) return Promise.resolve(false);
  return inputReader.question(`${color('33', `\n⚠️  ${message} ¿Continuar? (s/n): `)}`).then((answer) => ['s', 'si', 'sí', 'y', 'yes'].includes(answer.trim().toLowerCase()));
}

function renderToolBanner(toolName, toolArgs, status = 'START') {
  const start = status === 'START';
  console.log(color(start ? '33' : '32', `${start ? '⏳ [EJECUTANDO]' : '✅ [COMPLETADO]'} ${toolName} ${JSON.stringify(toolArgs)}`));
}

function sessionPath(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name || '')) throw new Error('Nombre de sesión inválido. Usa letras, números, guion o guion bajo.');
  return path.join(SESSION_DIR, `${name}.json`);
}

async function saveSession(name) {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  await fs.writeFile(sessionPath(name), JSON.stringify({ model: currentModel, messages: conversationHistory }, null, 2));
  console.log(color('32', `✅ Sesión guardada: ${name}`));
}

async function loadSession(name) {
  const saved = JSON.parse(await fs.readFile(sessionPath(name), 'utf8'));
  if (!Array.isArray(saved.messages) || saved.messages[0]?.role !== 'system') throw new Error('Formato de sesión inválido.');
  conversationHistory.splice(0, conversationHistory.length, ...saved.messages);
  if (saved.model && Object.values(MODELS).includes(saved.model)) currentModel = saved.model;
  console.log(color('32', `✅ Sesión cargada: ${name}`));
}

async function listSessions() {
  try {
    const files = (await fs.readdir(SESSION_DIR)).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
    console.log(files.length ? files.join('\\n') : 'No hay sesiones guardadas.');
  } catch { console.log('No hay sesiones guardadas.'); }
}

function printCostSummary() {
  const sinceLast = usageStore.summarySince(lastInteractionAt);
  const session = usageStore.sessionSummary();
  console.log(color('90', `\n💰 Desde la última interacción: ${usageStore.formatSummary(sinceLast)}`));
  console.log(color('90', `💰 Sesión actual: ${usageStore.formatSummary(session)}`));
}

function markInteraction() {
  lastInteractionAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function printWelcome() {
  console.log(color('35', '════════════════════════════════════════════════════════════'));
  console.log(color('1;35', `   Mini Agent - Modelo: [${currentModel}]`));
  console.log(color('90', '   Escribe tu orden.'));
  console.log(color('35', '════════════════════════════════════════════════════════════\n'));
}

async function addUserMessage(text) {
  const attachments = pendingAttachments.splice(0);
  conversationHistory.push(attachments.length
    ? { role: 'user', content: [{ type: 'input_text', text }, ...attachments] }
    : { role: 'user', content: text });
}

async function handleCommand(commandInput) {
  const [command, ...commandArgs] = commandInput.trim().split(/\s+/);
  switch (command.toLowerCase()) {
    case '/help':
      console.log('/model [luna|terra|sol|astra]  Cambiar modelo\n/usage [today|month|model] Mostrar consumo y costes\n/attach <archivo>        Adjuntar PNG, JPG, WEBP o PDF al siguiente mensaje\n/status                  Mostrar configuración\n/config                  Mostrar opciones activas\n/pwd                     Mostrar directorio actual\n/version                 Mostrar versión\n/history                 Listar sesiones guardadas\n/save <nombre>           Guardar sesión\n/load <nombre>           Cargar sesión\n/new                     Iniciar una sesión nueva\n/clear                   Limpiar conversación\n/help                    Mostrar ayuda');
      break;
    case '/attach':
      if (!commandArgs.length) console.log('Uso: /attach <archivo> [archivo2]');
      else {
        try {
          pendingAttachments.push(...await filesToInput(commandArgs));
          console.log(color('32', `✅ ${commandArgs.length} archivo(s) adjuntado(s) al siguiente mensaje.`));
        } catch (error) { console.log(color('31', `No se pudo adjuntar: ${error.message}`)); }
      }
      break;
    case '/usage': {
      const scope = commandArgs[0] || 'all';
      const summary = usageStore.summary(scope);
      console.log(`Uso (${scope}): ${summary.requests} solicitudes, ${summary.input_tokens} tokens de entrada, ${summary.output_tokens} de salida, ${summary.total_tokens} totales, coste estimado ${summary.cost_usd.toFixed(6)}, errores ${summary.errors}`);
      break;
    }
    case '/status':
      console.log(`Modelo: ${currentModel}\nConfirmaciones: ${YES_MODE ? 'desactivadas (por defecto; --no para activarlas)' : 'activadas (--no)'}\nDirectorio: ${process.cwd()}\nSesiones: ${SESSION_DIR}\nUso: ${usageStore.path}`);
      break;
    case '/pwd':
      console.log(process.cwd());
      break;
    case '/version':
      console.log(`mini-agent v${VERSION}`);
      break;
    case '/config':
      console.log(`Configuración:\n  modelo: ${currentModel}\n  confirmaciones: ${YES_MODE ? 'desactivadas (por defecto)' : 'activadas (--no)'}\n  color: ${NO_COLOR ? 'desactivado' : 'activado'}\n  verbose: ${VERBOSE ? 'activado' : 'desactivado'}`);
      break;
    case '/history':
      await listSessions();
      break;
    case '/save':
      if (!commandArgs[0]) console.log('Uso: /save <nombre>');
      else await saveSession(commandArgs[0]);
      break;
    case '/load':
      if (!commandArgs[0]) console.log('Uso: /load <nombre>');
      else await loadSession(commandArgs[0]);
      break;
    case '/new':
      if (commandArgs.length) console.log('Uso: /new');
      else {
        conversationHistory.splice(1);
        pendingAttachments.splice(0);
        usageStore.startSession();
        lastInteractionAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
        console.log(color('32', '✅ Nueva sesión iniciada. Se conservan el modelo y la configuración.'));
      }
      break;
    case '/clear':
    case '/reset':
      conversationHistory.splice(1);
      console.log(color('32', '✅ Conversación reiniciada.'));
      break;
    case '/model': {
      const selected = commandArgs[0]?.toLowerCase();
      if (!selected) console.log(`Modelo actual: ${currentModel}. Disponibles: ${Object.keys(MODELS).join(', ')}`);
      else if (commandArgs.length > 1 || !MODELS[selected]) console.log(color('31', `Modelo inválido. Disponibles: ${Object.keys(MODELS).join(', ')}`));
      else { currentModel = MODELS[selected]; console.log(color('32', `✅ Modelo cambiado a ${currentModel}`)); }
      break;
    }
    default: console.log(color('31', `Comando desconocido: ${command}. Usa /help.`));
  }
}

async function setupApiKey() {
  const configDir = path.join(os.homedir(), '.mini-agent');
  const configPath = path.join(configDir, 'config.json');
  try { const config = JSON.parse(await fs.readFile(configPath, 'utf8')); if (config.OPENAI_API_KEY) return config.OPENAI_API_KEY; } catch { /* solicitar */ }
  const apiKey = (await inputReader.question('OPENAI_API_KEY: ')).trim();
  if (!apiKey) throw new Error('La API Key no puede estar vacía.');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2));
  return apiKey;
}

async function confirmTool(name, toolArgs) {
  if (!['update_file', 'write_file', 'git_commit', 'git_branch'].includes(name)) return true;
  const target = toolArgs.path || toolArgs.name || '(operación Git)';
  const action = name === 'write_file' ? 'crear o sobrescribir' : name === 'update_file' ? 'modificar' : name === 'git_commit' ? `crear el commit «${toolArgs.message}»` : `crear la rama «${toolArgs.name}»`;
  return askConfirmation(`El agente quiere ${action} «${target}».`);
}

function printFileChangeSummary() {
  const changes = fileChangeTracker.list();
  if (!changes.length) return;
  const unique = [...new Map(changes.map((change) => [change.path, change])).values()];
  console.log(color('36', `\n📁 Archivos modificados (${unique.length}):`));
  for (const change of unique) console.log(`  - ${change.path} (${change.action})`);
  fileChangeTracker.reset();
}

async function processUserTaskWithoutKeepAwake() {
  fileChangeTracker.reset();
  while (true) {
    let response;
    try {
      response = await openai.responses.create({
        model: currentModel,
        input: conversationHistory,
        tools: toolsSchema,
        parallel_tool_calls: true,
        prompt_cache_key: 'mini-agent-shared',
        prompt_cache_retention: '24h',
      });
      usageStore.record({ model: currentModel, usage: response.usage, error: null });
    } catch (error) {
      usageStore.record({ model: currentModel, usage: null, error });
      throw error;
    }
    if (VERBOSE && response.usage) console.log(`\n${formatUsage(response, currentModel, { color: !NO_COLOR })}`);
    conversationHistory.push(...response.output);
    const toolCalls = response.output.filter((item) => item.type === 'function_call');
    if (!toolCalls.length) {
      if (response.output_text) console.log(`\n${color('36', `🤖 Agente (${currentModel}):`)}\n${renderMarkdown(response.output_text, { color: !NO_COLOR })}\n`);
      printFileChangeSummary();
      return;
    }
    const toolResults = await Promise.all(toolCalls.map(async (toolCall) => {
      let toolArgs;
      try { toolArgs = JSON.parse(toolCall.arguments || '{}'); } catch { toolArgs = null; }
      if (!toolArgs) return { type: 'function_call_output', call_id: toolCall.call_id, output: JSON.stringify({ error: 'Argumentos JSON inválidos.' }) };
      renderToolBanner(toolCall.name, toolArgs);
      const allowed = await confirmTool(toolCall.name, toolArgs);
      const result = !allowed ? JSON.stringify({ success: false, error: 'Operación cancelada por el usuario.' }) : toolsImplementations[toolCall.name] ? await toolsImplementations[toolCall.name](toolArgs) : JSON.stringify({ error: `Herramienta ${toolCall.name} no implementada.` });
      renderToolBanner(toolCall.name, toolArgs, 'END');
      return { type: 'function_call_output', call_id: toolCall.call_id, output: result };
    }));
    conversationHistory.push(...toolResults);
    // Las capturas no se envían como texto: se convierten en input_image para
    // que el modelo pueda verlas según el formato de Responses API.
    for (const toolResult of toolResults) {
      try {
        const requestedFiles = extractRequestedFiles(toolResult.output);
        if (requestedFiles) {
          toolResult.output = requestedFiles.output;
          conversationHistory.push({ role: 'user', content: requestedFiles.content });
          continue;
        }
        const payload = JSON.parse(toolResult.output);
        if (payload.image_data && payload.mime_type?.startsWith('image/')) {
          const imageData = payload.image_data;
          delete payload.image_data;
          toolResult.output = JSON.stringify(payload);
          conversationHistory.push({ role: 'user', content: [{ type: 'input_image', image_url: `data:${payload.mime_type};base64,${imageData}` }] });
        }
      } catch { /* una herramienta puede devolver texto no JSON */ }
    }
  }
}

async function processUserTask() {
  const stopKeepAwake = startKeepAwake();
  try {
    return await processUserTaskWithoutKeepAwake();
  } finally {
    stopKeepAwake();
  }
}

const COMMAND_COMPLETIONS = [
  { value: '/help', description: 'Mostrar ayuda' },
  { value: '/model', description: 'Consultar o cambiar el modelo' },
  { value: '/usage', description: 'Mostrar consumo y costes' },
  { value: '/status', description: 'Mostrar configuración y estado' },
  { value: '/config', description: 'Mostrar opciones activas' },
  { value: '/pwd', description: 'Mostrar directorio actual' },
  { value: '/version', description: 'Mostrar versión' },
  { value: '/history', description: 'Listar sesiones guardadas' },
  { value: '/save', description: 'Guardar sesión' },
  { value: '/load', description: 'Cargar sesión' },
  { value: '/new', description: 'Iniciar una sesión nueva' },
  { value: '/clear', description: 'Limpiar conversación' },
  { value: '/reset', description: 'Limpiar conversación' },
  { value: '/exit', description: 'Salir de la aplicación' },
  { value: '/quit', description: 'Salir de la aplicación' },
  { value: '/salir', description: 'Salir de la aplicación' },
];

const COMMAND_ARGUMENTS = {
  '/model': [
    { value: 'luna', description: 'Modelo Luna' },
    { value: 'terra', description: 'Modelo Terra' },
    { value: 'sol', description: 'Modelo Sol' },
    { value: 'astra', description: 'Modelo Astra' },
  ],
  '/usage': [
    { value: 'today', description: 'Uso de hoy' },
    { value: 'month', description: 'Uso del mes' },
    { value: 'model', description: 'Uso agrupado por modelo' },
  ],
};

function getCommandSuggestions(line) {
  const input = String(line ?? '').trimStart();
  if (!input.startsWith('/')) return [];

  // Keep an empty argument after a trailing space so `/model ` offers models.
  const parts = input.split(/\s+/);
  const commandPart = parts[0].toLowerCase();
  const hasTrailingSpace = /\s$/.test(input);

  if (parts.length === 1 && !hasTrailingSpace) {
    return COMMAND_COMPLETIONS
      .filter(({ value }) => value.startsWith(commandPart))
      .map(({ value }) => value);
  }

  const command = COMMAND_COMPLETIONS.find(({ value }) => value === commandPart)?.value;
  if (!command || !COMMAND_ARGUMENTS[command] || parts.length > 2) return [];

  const argument = hasTrailingSpace ? '' : (parts[1] || '');
  return COMMAND_ARGUMENTS[command]
    .filter(({ value }) => value.startsWith(argument.toLowerCase()))
    .map(({ value }) => `${command} ${value}`);
}

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

function unwrapBracketedPaste(value) {
  const text = String(value ?? '');
  const start = text.indexOf(BRACKETED_PASTE_START);
  if (start < 0) return null;
  const contentStart = start + BRACKETED_PASTE_START.length;
  const end = text.indexOf(BRACKETED_PASTE_END, contentStart);
  if (end < 0) return null;
  return text.slice(contentStart, end).replace(/\r\n?/g, '\n');
}

function printPasteNotice(text) {
  const lineCount = text ? text.split('\n').length : 0;
  console.log(color('90', `📋 Se han pegado ${lineCount} ${lineCount === 1 ? 'línea' : 'líneas'}. Escribe ahora las instrucciones para este contenido.`));
}

function combinePasteWithInstruction(pasted, instruction) {
  return `${instruction}\n\n--- Contenido pegado (${pasted.split('\n').length} ${pasted.split('\n').length === 1 ? 'línea' : 'líneas'}) ---\n${pasted}\n--- Fin del contenido pegado ---`;
}

function createInput() {
  let rl;
  let multilineBuffer = '';
  let bracketedPasteEnabled = false;
  const completer = (line) => {
    const suggestions = getCommandSuggestions(line);
    if (!suggestions.length) return [[], line];
    // readline usa este prefijo para sustituir únicamente la palabra actual.
    const prefix = line.trimStart().split(/\s+/).at(-1) || line;
    return [suggestions, prefix];
  };
  return {
    async init() {
      const readline = await import('node:readline/promises');
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer });
      // Activa el modo bracketed paste en terminales compatibles. Así el
      // terminal envía el bloque completo entre marcadores, en vez de tratar
      // cada salto de línea pegado como un Enter independiente.
      if (process.stdin.isTTY && process.stdout.isTTY) {
        process.stdout.write('\x1b[?2004h');
        bracketedPasteEnabled = true;
      }
      inputReader = this;
    },
    async question(prompt, { pasteAsContext = false } = {}) {
      const firstLine = await rl.question(prompt);
      let pasted = unwrapBracketedPaste(firstLine);
      let wasPaste = pasted !== null;
      // Node readline normalmente quita los marcadores de pegado al entregar la
      // línea, pero conserva el salto de línea. En ese caso sigue siendo un
      // pegado válido aunque ya no podamos ver los marcadores.
      if (pasted === null && firstLine.includes('\n')) {
        pasted = firstLine.replace(/\r\n?/g, '\n');
        wasPaste = true;
      }
      if (wasPaste && pasteAsContext) {
        printPasteNotice(pasted);
        // No devolvemos el pegado como una orden: esperamos una instrucción
        // explícita. Así pegar código, logs o un plan nunca dispara al agente
        // accidentalmente.
        let instruction;
        do {
          instruction = await rl.question(color('1;34', '> Instrucciones sobre lo pegado: '));
        } while (!instruction.trim());
        return combinePasteWithInstruction(pasted, instruction.trim());
      }
      if (wasPaste) return pasted;
      if (!firstLine.includes('```') && !firstLine.endsWith('\\')) return firstLine;

      multilineBuffer = firstLine.endsWith('\\') ? firstLine.slice(0, -1) : firstLine;
      let inFence = (multilineBuffer.match(/```/g) || []).length % 2 === 1;
      let continued = firstLine.endsWith('\\');
      while (inFence || continued) {
        const nextLine = await rl.question(color('90', '… '));
        continued = nextLine.endsWith('\\');
        multilineBuffer += `\\n${continued ? nextLine.slice(0, -1) : nextLine}`;
        inFence = (multilineBuffer.match(/```/g) || []).length % 2 === 1;
      }
      return multilineBuffer;
    },
    close() {
      if (bracketedPasteEnabled) process.stdout.write('\x1b[?2004l');
      rl?.close();
    },
  };
}

async function startAgentCLI() {
  inputReader = createInput();
  await inputReader.init();
  try {
    openai = new OpenAI({ apiKey: await setupApiKey() });
    if (!initialPrompt) printWelcome();
    if (initialPrompt) { await addUserMessage(initialPrompt); await processUserTask(); markInteraction(); return; }
    while (true) {
      printCostSummary();
      const userInput = (await inputReader.question(color('1;34', '> '), { pasteAsContext: true })).trim();
      if (!userInput) continue;
      if (['/exit', '/quit', '/salir'].includes(userInput.toLowerCase())) break;
      if (userInput.startsWith('/')) await handleCommand(userInput);
      else { await addUserMessage(userInput); await processUserTask(); }
      markInteraction();
    }
  } catch (error) { console.error(color('31', `Error: ${error.message}`)); }
  finally { inputReader.close(); }
}

startAgentCLI();
