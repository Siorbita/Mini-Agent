import test from 'node:test';
import assert from 'node:assert/strict';
import { layaTools } from '../tools/laya.js';
import { toolsImplementations, toolsSchema } from '../tools/index.js';

const parse = (value) => JSON.parse(value);
const argumentsFor = {
  state: 'La aplicación se cierra al abrir la configuración. El usuario dice que no puede trabajar.',
  questions: [
    {
      name: 'categoria',
      type: 'choice',
      instructions: '¿Qué equipo debe atender el mensaje?',
      criteria: [
        { key: 'soporte', description: 'Errores, fallos o problemas técnicos de software.' },
        { key: 'facturacion', description: 'Pagos, cobros o facturas.' },
        { key: 'otro', description: 'Asuntos que no encajan en las demás categorías.' },
      ],
    },
    {
      name: 'urgencia',
      type: 'score',
      instructions: '¿Cuál es el nivel de urgencia, de menor a mayor?',
      criteria: [
        { key: '0', description: 'No urgente; se puede resolver más adelante.' },
        { key: '1', description: 'Urgente; impide completar una tarea importante.' },
      ],
    },
    { name: 'amenaza', type: 'noul', instructions: '¿El usuario amenaza explícitamente con cancelar o abandonar el servicio?', criteria: [] },
  ],
};

test('laya_predict envía las preguntas Laya en el formato que acepta el servidor Python', async (context) => {
  const originalUrl = process.env.LAYA_SERVER_URL;
  process.env.LAYA_SERVER_URL = 'http://localhost:18765';
  context.after(() => { if (originalUrl === undefined) delete process.env.LAYA_SERVER_URL; else process.env.LAYA_SERVER_URL = originalUrl; });
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ answers: { categoria: { choice: 'soporte' }, urgencia: { score: 1 }, amenaza: { noul: 0.02 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = parse(await layaTools.laya_predict(argumentsFor));
  assert.equal(result.success, true);
  assert.equal(request.url, 'http://localhost:18765/predict');
  assert.deepEqual(JSON.parse(request.options.body), {
    state: argumentsFor.state,
    questions: {
      categoria: {
        type: 'choice',
        instructions: argumentsFor.questions[0].instructions,
        criteria: { soporte: 'Errores, fallos o problemas técnicos de software.', facturacion: 'Pagos, cobros o facturas.', otro: 'Asuntos que no encajan en las demás categorías.' },
      },
      urgencia: {
        type: 'score',
        instructions: argumentsFor.questions[1].instructions,
        criteria: ['No urgente; se puede resolver más adelante.', 'Urgente; impide completar una tarea importante.'],
      },
      amenaza: { type: 'noul', instructions: argumentsFor.questions[2].instructions },
    },
  });
  assert.equal(typeof request.options.signal, 'object');
});

test('laya_predict limita los destinos de red a loopback', async (context) => {
  const originalUrl = process.env.LAYA_SERVER_URL;
  process.env.LAYA_SERVER_URL = 'https://example.com';
  context.after(() => { if (originalUrl === undefined) delete process.env.LAYA_SERVER_URL; else process.env.LAYA_SERVER_URL = originalUrl; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No debe realizar una petición externa'); };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = parse(await layaTools.laya_predict(argumentsFor));
  assert.equal(result.success, false);
  assert.match(result.error, /no se envía el estado a hosts remotos/);
});

test('laya_predict devuelve errores útiles para preguntas inválidas y respuestas HTTP fallidas', async (context) => {
  const invalid = parse(await layaTools.laya_predict({ ...argumentsFor, questions: [] }));
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /entre 1 y 20 preguntas/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Solicitud inválida' }), { status: 400 });
  context.after(() => { globalThis.fetch = originalFetch; });
  const failed = parse(await layaTools.laya_predict(argumentsFor));
  assert.equal(failed.success, false);
  assert.match(failed.error, /Solicitud inválida/);
});

test('laya_predict se registra en el esquema y las implementaciones del agente', () => {
  assert.equal(typeof toolsImplementations.laya_predict, 'function');
  const schema = toolsSchema.find((entry) => entry.name === 'laya_predict');
  assert.ok(schema);
  assert.equal(schema.strict, true);
  assert.deepEqual(schema.parameters.required, ['state', 'questions']);
});
