import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, stripAnsi } from '../renderer.js';

test('renderMarkdown procesa encabezados, énfasis y código inline', () => {
  const output = stripAnsi(renderMarkdown('# Título\nTexto **importante** y `const x = 1`.', { color: true }));
  assert.match(output, /Título/);
  assert.match(output, /importante/);
  assert.match(output, /const x = 1/);
});

test('renderMarkdown muestra bloques de código con lenguaje', () => {
  const output = stripAnsi(renderMarkdown('```js\nconsole.log("hola");\n```', { color: true }));
  assert.match(output, /┌─ js/);
  assert.match(output, /│ console\.log\("hola"\);/);
  assert.match(output, /└─/);
});

test('renderMarkdown conserva salida legible sin color', () => {
  const output = renderMarkdown('- uno\n- dos', { color: false });
  assert.equal(output, '- uno\n- dos');
  assert.equal(stripAnsi(output), output);
});

test('renderMarkdown representa tablas básicas', () => {
  const output = stripAnsi(renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |', { color: true }));
  assert.match(output, /│ A/);
  assert.match(output, /│ 1/);
  assert.match(output, /┼/);
});
