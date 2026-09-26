import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactConversation,
  estimateConversationTokens,
  getContextWindowTokens,
  shouldCompactConversation,
} from '../conversation-compaction.js';

test('el umbral de compactación es el 75 % y considera el uso informado por la API', () => {
  const messages = [{ role: 'system', content: 's' }, { role: 'user', content: 'hola' }];
  const atThreshold = shouldCompactConversation({ messages, contextWindowTokens: 1_000, lastUsage: { input_tokens: 700, output_tokens: 50 } });
  assert.equal(atThreshold.shouldCompact, true);
  assert.equal(atThreshold.contextTokens, 750);
  const belowThreshold = shouldCompactConversation({ messages, contextWindowTokens: 1_000, lastUsage: { input_tokens: 700, output_tokens: 49 } });
  assert.equal(belowThreshold.shouldCompact, false);
});

test('se configura una capacidad distinta por modelo y admite un fallback global', () => {
  const env = {
    MINI_AGENT_CONTEXT_WINDOWS: '{"gpt-6-luna":1000000,"gpt-5.6-terra":200000}',
    MINI_AGENT_CONTEXT_WINDOW_TOKENS: '800000',
  };
  assert.equal(getContextWindowTokens('gpt-6-luna', env), 1_000_000);
  assert.equal(getContextWindowTokens('gpt-5.6-terra', env), 200_000);
  assert.equal(getContextWindowTokens('modelo-no-configurado', env), 800_000);
  assert.equal(getContextWindowTokens('modelo-no-configurado', { MINI_AGENT_CONTEXT_WINDOW_TOKENS: 'inválido' }), 1_000_000);
});

test('modelos conocidos usan su capacidad predeterminada sin variables de entorno', () => {
  const messages = [{ role: 'system', content: 's' }, { role: 'user', content: 'hola' }];
  const terraWindow = getContextWindowTokens('gpt-5.6-terra', {});
  const lunaWindow = getContextWindowTokens('gpt-6-luna', {});
  assert.equal(terraWindow, 400_000);
  assert.equal(lunaWindow, 1_000_000);
  const usage = { input_tokens: 320_000, output_tokens: 0 };
  assert.equal(shouldCompactConversation({ messages, lastUsage: usage, model: 'gpt-5.6-terra', contextWindowTokens: terraWindow }).shouldCompact, true);
  assert.equal(shouldCompactConversation({ messages, lastUsage: usage, model: 'gpt-6-luna', contextWindowTokens: lunaWindow }).shouldCompact, false);
});

test('el modelo activo determina su propio umbral de compactación', () => {
  const messages = [{ role: 'system', content: 's' }, { role: 'user', content: 'hola' }];
  const env = { MINI_AGENT_CONTEXT_WINDOWS: '{"gpt-6-luna":1000,"gpt-5.6-terra":200}' };
  const usage = { input_tokens: 160, output_tokens: 0 };
  assert.equal(shouldCompactConversation({ messages, lastUsage: usage, model: 'gpt-5.6-terra', contextWindowTokens: getContextWindowTokens('gpt-5.6-terra', env) }).shouldCompact, true);
  assert.equal(shouldCompactConversation({ messages, lastUsage: usage, model: 'gpt-6-luna', contextWindowTokens: getContextWindowTokens('gpt-6-luna', env) }).shouldCompact, false);
});

test('estimateConversationTokens aporta una estimación positiva de respaldo', () => {
  assert.ok(estimateConversationTokens([{ role: 'user', content: 'a'.repeat(100) }]) > 0);
});

test('la compactación conserva literalmente el último mensaje del usuario y reemplaza el historial', async () => {
  const currentUserMessage = { role: 'user', content: 'Continúa exactamente esta tarea.' };
  const messages = [
    { role: 'system', content: 'Instrucciones del agente.' },
    { role: 'user', content: 'Primera petición.' },
    { role: 'assistant', content: 'Trabajo previo.' },
    currentUserMessage,
    { role: 'assistant', content: 'Progreso de la tarea actual.' },
    { role: 'function_call_output', call_id: 'call-1', output: 'Resultado de herramienta.' },
  ];
  let request;
  const result = await compactConversation({
    openai: { responses: { create: async (value) => {
      request = value;
      return { output_text: 'Resumen de contexto y progreso.', usage: { input_tokens: 30, output_tokens: 8 } };
    } } },
    model: 'gpt-6-sol',
    messages,
  });

  assert.equal(result.compacted, true);
  assert.equal(request.model, 'gpt-6-sol');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content, /Resumen de contexto/);
  assert.strictEqual(messages[2], currentUserMessage);
  assert.equal(messages.length, 3);
  assert.match(request.input[1].content, /Resultado de herramienta/);
});

test('no intenta resumir si el único contenido es el mensaje actual del usuario', async () => {
  let called = false;
  const result = await compactConversation({
    openai: { responses: { create: async () => { called = true; } } },
    model: 'gpt-6-sol',
    messages: [{ role: 'system', content: 'sistema' }, { role: 'user', content: 'Petición grande.' }],
  });
  assert.equal(result.compacted, false);
  assert.equal(called, false);
});
