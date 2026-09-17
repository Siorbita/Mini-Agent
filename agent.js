import 'dotenv/config';
import OpenAI from 'openai';
import { toolsImplementations, toolsSchema } from './tools/index.js';
import { recordUsage } from './usage-store.js';
import { extractRequestedFiles } from './attachments.js';


const SYSTEM_PROMPT = 'Eres un asistente de desarrollo de software. Puedes explorar y leer archivos, ejecutar comandos seguros y modificar archivos. También puedes navegar con Puppeteer: usa browser_navigate, browser_click y browser_type, y browser_screenshot cuando necesites inspeccionar una pantalla. Las capturas se entregan como imágenes. Antes de modificar archivos debes solicitar confirmación. Usa herramientas en paralelo cuando sea posible. Para búsquedas, investigaciones o información actual, usa web_search y luego web_fetch sobre fuentes relevantes; contrasta varias fuentes cuando sea importante y cita las URLs en la respuesta. Al terminar una tarea, informa claramente qué cambió; no marques plan.txt como completado salvo que la tarea correspondiente esté realmente terminada.';

function parseToolArguments(item) {
  try { return JSON.parse(item.arguments || '{}'); } catch { return null; }
}

async function executeToolCall(item, { confirm, onTool }) {
  const args = parseToolArguments(item);
  if (!args) return { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ error: 'Argumentos JSON inválidos.' }) };
  onTool(item.name, args, 'start');
  const mutating = ['update_file', 'write_file', 'git_commit', 'git_branch'].includes(item.name);
  const allowed = !mutating || await confirm(item.name, args);
  const result = !allowed
    ? JSON.stringify({ success: false, error: 'Operación cancelada por el usuario.' })
    : toolsImplementations[item.name]
      ? await toolsImplementations[item.name](args)
      : JSON.stringify({ error: `Herramienta ${item.name} no encontrada.` });
  onTool(item.name, args, 'end', result);
  return { type: 'function_call_output', call_id: item.call_id, output: result };
}

export async function runAgent(userPrompt, {
  model = process.env.OPENAI_MODEL || 'gpt-5.6-luna',
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

  while (true) {
    let response;
    try {
      response = await openai.responses.create({
        model,
        input,
        tools: toolsSchema,
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
    const toolResults = await Promise.all(calls.map((call) => executeToolCall(call, { confirm, onTool })));
    const requestedContent = [];
    for (const toolResult of toolResults) {
      const requestedFiles = extractRequestedFiles(toolResult.output);
      if (requestedFiles) {
        toolResult.output = requestedFiles.output;
        requestedContent.push(...requestedFiles.content);
      }
    }
    input = [...response.output, ...toolResults];
    if (requestedContent.length) input.push({ role: 'user', content: requestedContent });
  }
}
