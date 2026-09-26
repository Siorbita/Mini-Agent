import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewFeedback, parseGoalReview, reviewGoal } from '../goal-review.js';

test('el revisor acepta una implementación sin hallazgos bloqueantes', () => {
  const result = parseGoalReview(JSON.stringify({
    verdict: 'pass',
    summary: 'El cambio cumple el objetivo y no se detectaron errores relevantes.',
    findings: [{ severity: 'low', file: 'README.md', issue: 'Podría añadirse otro ejemplo.', suggested_fix: 'Agregar una muestra de uso.' }],
  }));
  assert.equal(result.status, 'pass');
  assert.equal(result.findings.length, 1);
});

test('un needs_work con solo hallazgos menores se normaliza como aprobado', () => {
  const result = parseGoalReview(JSON.stringify({
    verdict: 'needs_work',
    summary: 'Hay una sugerencia menor.',
    findings: [{ severity: 'low', file: 'README.md', issue: 'Falta un ejemplo.', suggested_fix: 'Agregarlo.' }],
  }));
  assert.equal(result.status, 'pass');
});

test('un hallazgo bloqueante prevalece sobre un veredicto pass', () => {
  const result = parseGoalReview(JSON.stringify({
    verdict: 'pass',
    summary: 'El cambio es correcto.',
    findings: [{ severity: 'high', file: 'x.js', issue: 'Hay un bug.', suggested_fix: 'Corregirlo.' }],
  }));
  assert.equal(result.status, 'needs_work');
});

test('JSON mal formado o estructura inválida no se consideran aprobación', () => {
  assert.equal(parseGoalReview('{mal json').status, 'unavailable');
  assert.equal(parseGoalReview(JSON.stringify({ verdict: 'other', summary: 'x', findings: [] })).status, 'unavailable');
});

test('los hallazgos de revisión se formatean como instrucciones para el agente', () => {
  const feedback = formatReviewFeedback({
    summary: 'Un requisito no se cumple.',
    findings: [{ severity: 'high', file: 'src/a.js', issue: 'No valida entrada vacía.', suggested_fix: 'Añadir la validación antes del procesamiento.' }],
  });
  assert.match(feedback, /src\/a\.js/);
  assert.match(feedback, /No valida entrada vacía/);
  assert.match(feedback, /ejecuta las comprobaciones relevantes/);
});

test('reviewGoal realiza una llamada independiente con el objetivo y la evidencia', async () => {
  let request;
  const result = await reviewGoal({
    openai: { responses: { create: async (value) => {
      request = value;
      return { output_text: JSON.stringify({ verdict: 'pass', summary: 'Correcto.', findings: [] }), usage: { total_tokens: 12 } };
    } } },
    model: 'review-model',
    goal: 'Añadir validación',
    evidence: 'Cambios y pruebas',
  });
  assert.equal(request.model, 'review-model');
  assert.match(request.input[1].content, /Añadir validación/);
  assert.match(request.input[1].content, /Cambios y pruebas/);
  assert.equal(result.review.status, 'pass');
  assert.equal(result.usage.total_tokens, 12);
});

test('un error del revisor se informa como no verificado, nunca como aprobado', async () => {
  const result = await reviewGoal({
    openai: { responses: { create: async () => { throw new Error('sin conexión'); } } },
    model: 'review-model',
    goal: 'Cambiar código',
    evidence: 'evidencia',
  });
  assert.equal(result.review.status, 'unavailable');
  assert.match(result.review.summary, /sin conexión/);
  assert.ok(result.error);
});
