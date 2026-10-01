import 'dotenv/config';
import OpenAI from 'openai';
import { toolsImplementations } from './tools/index.js';
import { recordUsage } from './usage-store.js';
import { executeToolCallsSequentially, processToolResults, requiresChromeProfileConsent } from './tools/agent-tool-flow.js';
import { getAvailableToolSchema, McpToolManager } from './tools/mcp.js';
import { compactConversation, MAX_OUTPUT_TOKENS, shouldCompactConversation } from './conversation-compaction.js';


const SYSTEM_PROMPT = 'Eres un asistente de desarrollo de software. Puedes explorar y leer archivos, ejecutar comandos seguros y modificar archivos. Usa las herramientas MCP con nombres mcp__servidor__herramienta cuando sean adecuadas; las integraciones web y browser de Mini Agent se publican como mcp__mini_agent__*. Las herramientas computer_* y desktop_* siguen disponibles directamente. También puedes usar Chromium como una computadora visual: mcp__mini_agent__browser_navigate abre páginas, computer_screenshot captura el viewport y computer_click/computer_type/computer_keypress/computer_scroll/computer_move permiten interactuar con él usando coordenadas. Inspecciona una captura después de cada acción relevante. Las herramientas computer_* operan dentro de Chromium y no requieren autorización por acción; no controlan otras aplicaciones del escritorio. Las herramientas desktop_* controlan la pantalla real automáticamente; reserva confirmaciones para acciones claramente irreversibles o de alto impacto. Las capturas se envían una vez al modelo y luego se retiran del historial para no volver a consumir tokens. Para clasificaciones, enrutamiento, señales binarias o puntuaciones estructuradas sobre texto, usa laya_predict: es un decisor local rápido, no un generador de texto. Pasa en state el texto y contexto pertinente; formula preguntas concretas y agrupa preguntas independientes. Usa choice con 2-20 opciones claras y una categoría residual si procede, score para niveles ordenados, y noul para sí/no. Interpreta las respuestas/probabilidades tal cual: no inventes explicaciones ni asumas que la confianza garantiza acierto; para decisiones de alto impacto, valida con evidencia y reserva el modelo principal para razonamiento o texto abierto. El servidor Laya se configura con LAYA_SERVER_URL (por defecto http://127.0.0.1:18765); la CLI lo inicia y detiene automáticamente junto con el agente. Antes de modificar archivos debes solicitar confirmación. Usa herramientas en paralelo cuando sea posible. Para búsquedas, investigaciones o información actual, usa web_search y luego web_fetch sobre fuentes relevantes; contrasta varias fuentes cuando sea importante y cita las URLs en la respuesta. Al terminar una tarea, informa claramente qué cambió; no marques plan.txt como completado salvo que la tarea correspondiente esté realmente terminada.';

function parseToolArguments(item) {
  try { return JSON.parse(item.arguments || '{}'); } catch { return null; }
}

async function executeToolCall(item, { confirm, onTool, mcpManager }) {
  const args = parseToolArguments(item);
  if (!args) return { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ error: 'Argumentos JSON inválidos.' }) };
  onTool(item.name, args, 'start');
  const originalName = mcpManager?.getOriginalToolName(item.name) || item.name;
  const requiresConfirmation = ['update_file', 'write_file', 'git_commit', 'git_branch'].includes(originalName)
    || requiresChromeProfileConsent(originalName, args)
    || mcpManager?.requiresConfirmation(item.name);
  const allowed = !requiresConfirmation || await confirm(originalName, args);
  const result = !allowed
    ? JSON.stringify({ success: false, error: 'Operación cancelada por el usuario.' })
    : mcpManager?.tools.some((tool) => tool.name === item.name)
      ? await mcpManager.call(item.name, args)
      : toolsImplementations[item.name]
      ? await toolsImplementations[item.name](args)
      : JSON.stringify({ error: `Herramienta ${item.name} no encontrada.` });
  onTool(item.name, args, 'end', result);
  return { type: 'function_call_output', call_id: item.call_id, output: result };
}

export async function runAgent(userPrompt, {
  model = process.env.OPENAI_MODEL || 'gpt-6-luna',
  apiKey = process.env.OPENAI_API_KEY,
  confirm = async () => false,
  onTool = () => {},
} = {}) {
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY.');
  const openai = new OpenAI({ apiKey });
  let input = [
    { role: 'developer', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
    { role: 'user', content: userPrompt },
  ];

  const mcpManager = new McpToolManager();
  await mcpManager.start();
  try {
  while (true) {
    const tools = getAvailableToolSchema(mcpManager.tools);
    const contextStatus = shouldCompactConversation({ messages: input, tools, model });
    if (contextStatus.shouldCompact) {
      const compactModel = process.env.MINI_AGENT_COMPACT_MODEL || model;
      const compacted = await compactConversation({ openai, model: compactModel, messages: input });
      if (!compacted.compacted) throw new Error(`No se pudo compactar el contexto (${compacted.reason}).`);
    }

    if (requestStatus.contextTokens > requestStatus.requestInputBudget) {
      throw new Error(`El contexto supera el presupuesto preventivo de ${requestStatus.requestInputBudget} tokens de entrada; reduce el mensaje o los adjuntos.`);
    }
    let response;
    try {
      response = await openai.responses.create({
        model,
        input,
        tools,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        parallel_tool_calls: true,
        prompt_cache_key: 'mini-agent-shared',
        prompt_cache_retention: '24h',
      });
      recordUsage({ model, usage: response.usage });
    } catch (error) {
      recordUsage({ model, error });
      throw error;
    }

    const calls = response.output.filter((item) => item.type === 'function_call');
    if (!calls.length) return response.output_text || '';
    // Calls from one response may form a dependent browser interaction sequence.
    const executedToolResults = await executeToolCallsSequentially(calls, { confirm, onTool, mcpManager }, executeToolCall);
    const { toolResults, requestedContent } = processToolResults(executedToolResults);
    input = [...response.output, ...toolResults];
    if (requestedContent.length) input.push({ role: 'user', content: requestedContent });
  }
  } finally {
    await mcpManager.close();
  }
}
