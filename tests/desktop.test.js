import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDesktopPoint, validateDesktopRegion } from '../tools/desktop.js';
import { toolsImplementations, toolsSchema } from '../tools/index.js';

const desktopToolNames = [
  'desktop_screenshot', 'desktop_click', 'desktop_type',
  'desktop_keypress', 'desktop_scroll',
];

test('registra las herramientas de control de escritorio', () => {
  for (const name of desktopToolNames) {
    assert.equal(typeof toolsImplementations[name], 'function', `${name} tiene implementación`);
    assert.ok(toolsSchema.some((tool) => tool.name === name), `${name} está disponible para el modelo`);
  }
});

test('desktop_sequence limita las secuencias antes de activar el backend nut.js', async () => {
  const invalid = JSON.parse(await toolsImplementations.desktop_sequence({ actions: [] }));
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /entre 1 y 25/);
  assert.ok(toolsSchema.some((tool) => tool.name === 'desktop_sequence'));
});

test('desktop_screenshot admite una región para reducir el tamaño de imagen y uso de tokens', () => {
  const schema = toolsSchema.find((tool) => tool.name === 'desktop_screenshot');
  assert.ok(schema);
  assert.deepEqual(schema.parameters.properties.region.type, ['object', 'null']);
  assert.deepEqual(schema.parameters.properties.region.required, ['x', 'y', 'width', 'height']);
  assert.doesNotThrow(() => validateDesktopRegion({ x: 10, y: 20, width: 300, height: 200 }, 1920, 1080));
  assert.throws(() => validateDesktopRegion({ x: 1900, y: 20, width: 300, height: 200 }, 1920, 1080), /dentro de la pantalla/);
  assert.throws(() => validateDesktopRegion({ x: 10.5, y: 20, width: 300, height: 200 }, 1920, 1080), /dentro de la pantalla/);
  assert.throws(() => validateDesktopRegion({ x: 10, y: 20, width: 0, height: 200 }, 1920, 1080), /dentro de la pantalla/);
});

test('valida coordenadas absolutas dentro de los límites de pantalla', () => {
  assert.doesNotThrow(() => validateDesktopPoint(0, 0, 1920, 1080));
  assert.doesNotThrow(() => validateDesktopPoint(1919, 1079, 1920, 1080));
  assert.throws(() => validateDesktopPoint(1920, 10, 1920, 1080), /fuera de la pantalla/);
  assert.throws(() => validateDesktopPoint(10, -1, 1920, 1080), /fuera de la pantalla/);
  assert.throws(() => validateDesktopPoint(Number.NaN, 10, 1920, 1080), /fuera de la pantalla/);
});
