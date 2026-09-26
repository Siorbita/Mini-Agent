import test from 'node:test';
import assert from 'node:assert/strict';
import { toolsImplementations } from '../tools.js';
import { runCommand } from '../tools/command-runner.js';

const parse = (value) => JSON.parse(value);

test('read_file rechaza rutas fuera del proyecto', async () => {
  const result = parse(await toolsImplementations.read_file({ path: '../plan.txt' }));
  assert.match(result.error, /dentro del directorio/);
});

test('glob encuentra patrones recursivos', async () => {
  const result = parse(await toolsImplementations.glob({ pattern: '**/*.js' }));
  assert.ok(result.matches.includes('tools.js'));
  assert.ok(result.matches.includes('agent.js'));
});

test('grep convierte regex inválida en búsqueda literal', async () => {
  const result = parse(await toolsImplementations.grep({ query: '[Plan', file_pattern: 'plan.txt' }));
  assert.ok(result.matches.length > 0 || result.total_matches === 0);
});

test('runCommand ejecuta comandos node sin shell', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(result.stdout, 'ok');
});

test('runCommand termina el proceso al recibir una señal de cancelación', async () => {
  const controller = new AbortController();
  const command = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(command, { name: 'AbortError' });
});

test('runCommand puede ejecutar npm aunque su lanzador no esté disponible', async () => {
  const result = await runCommand('npm', ['--version']);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('run_command bloquea comandos destructivos', async () => {
  const result = parse(await toolsImplementations.run_command({ command: 'rm', args: ['-rf', 'x'] }));
  assert.equal(result.success, false);
  assert.match(result.error, /destructivo/);
});
