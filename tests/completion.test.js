import test from 'node:test';
import assert from 'node:assert/strict';

// index.js inicia la CLI al importarse; extraemos la función sin ejecutar la aplicación.
const source = await (await import('node:fs/promises')).readFile(new URL('../index.js', import.meta.url), 'utf8');
const functionSource = source.match(/function getCommandSuggestions\(line\) \{[\s\S]*?\n\}\n\nfunction createInput/)[0]
  .replace(/\n\nfunction createInput[\s\S]*/, '');
const constantsSource = source.match(/const COMMAND_COMPLETIONS = \[[\s\S]*?const COMMAND_ARGUMENTS = \{[\s\S]*?\n\};/)[0];
const getCommandSuggestions = Function(`${constantsSource}\n${functionSource}\nreturn getCommandSuggestions;`)();

test('sugiere comandos desde la barra', () => {
  assert.ok(getCommandSuggestions('/').includes('/model'));
  assert.deepEqual(getCommandSuggestions('/mo'), ['/model']);
  assert.deepEqual(getCommandSuggestions('/new'), ['/new']);
});

test('sugiere argumentos después de un comando', () => {
  assert.deepEqual(getCommandSuggestions('/model '), ['/model luna', '/model terra', '/model sol', '/model astra']);
  assert.deepEqual(getCommandSuggestions('/model t'), ['/model terra']);
});

test('no sugiere texto normal ni argumentos extra', () => {
  assert.deepEqual(getCommandSuggestions('hola'), []);
  assert.deepEqual(getCommandSuggestions('/model luna extra'), []);
});
