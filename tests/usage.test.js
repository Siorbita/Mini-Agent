import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, formatUsage, getUsage } from '../usage.js';

test('getUsage normaliza metadatos de uso de Chat Completions', () => {
  const usage = getUsage({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } });
  assert.deepEqual(usage, { input: 120, output: 30, total: 150 });
});

test('estimateCost calcula el coste según el modelo', () => {
  assert.equal(estimateCost({ input: 1_000_000, output: 500_000 }, 'gpt-5.6-terra'), 3.75);
  assert.equal(estimateCost({ input: 1_000_000, output: 500_000 }, 'gpt-6-luna'), 7.5);
  assert.equal(estimateCost({ input: 1_000_000, output: 500_000 }, 'gpt-6-sol'), 1.5);
  assert.equal(estimateCost({ input: 10, output: 10 }, 'modelo-desconocido'), null);
});

test('formatUsage muestra tokens y coste sin ANSI cuando se desactiva el color', () => {
  const text = formatUsage({ usage: { prompt_tokens: 1000, completion_tokens: 250, total_tokens: 1250 } }, 'gpt-5.6-terra', { color: false });
  assert.match(text, /tokens: (1\.250|1250)/);
  assert.match(text, /entrada (1\.000|1000)/);
  assert.match(text, /salida 250/);
  assert.match(text, /≈ \$0\.002500/);
});
