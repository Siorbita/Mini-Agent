import test from 'node:test';
import assert from 'node:assert/strict';
import { toolsImplementations, toolsSchema } from '../tools/index.js';
import { validatePoint } from '../tools/browser.js';

const computerToolNames = [
  'computer_screenshot', 'computer_click', 'computer_type',
  'computer_keypress', 'computer_scroll', 'computer_move',
];

test('registra herramientas de control visual dentro de Chromium', () => {
  for (const name of computerToolNames) {
    assert.equal(typeof toolsImplementations[name], 'function', `${name} tiene implementación`);
    assert.ok(toolsSchema.some((tool) => tool.name === name), `${name} está disponible para el modelo`);
  }
});

test('valida coordenadas respecto al viewport antes de interactuar', () => {
  const page = { viewport: () => ({ width: 800, height: 600 }) };
  assert.doesNotThrow(() => validatePoint(page, 0, 0));
  assert.doesNotThrow(() => validatePoint(page, 799, 599));
  assert.throws(() => validatePoint(page, 800, 10), /fuera de la ventana/);
  assert.throws(() => validatePoint(page, 10, -1), /fuera de la ventana/);
  assert.throws(() => validatePoint(page, Number.NaN, 10), /fuera de la ventana/);
});
