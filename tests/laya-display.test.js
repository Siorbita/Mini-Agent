import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLayaResult } from '../laya/format-result.js';

test('muestra respuesta, distribución en porcentajes, confianza y puntuación de Laya', () => {
  const output = JSON.stringify({
    success: true,
    result: {
      model: 'laya-rl-agent',
      routing: { model: 'laya-en', detection: { language: 'es' } },
      answers: {
        categoria: {
          type: 'choice',
          choice: 'phishing',
          probabilities: { no_phishing: 0.035, phishing: 0.965 },
          confidence: 0.782,
          answer_confidence: 0.965,
          action: { act_probability: 0.91 },
        },
        urgencia: {
          type: 'score',
          score: 2.35,
          legend: { '0': 'baja', '1': 'media', '2': 'alta' },
          probabilities: { '0': 0.1, '1': 0.25, '2': 0.65 },
          answer_confidence: 0.65,
        },
        confirmacion: { type: 'noul', noul: 0.82, answer_confidence: 0.82 },
      },
      usage: { input_tokens: 42, output_tokens: 0 },
    },
  });

  const summary = formatLayaResult(output);
  assert.match(summary, /categoria \(categoría\): phishing/);
  assert.match(summary, /phishing: 96\.5%/);
  assert.match(summary, /no_phishing: 3\.5%/);
  assert.match(summary, /Confianza de la respuesta \(calibrada\): 96\.5%/);
  assert.match(summary, /Concentración de la distribución \(no calibrada\): 78\.2%/);
  assert.match(summary, /Probabilidad de acción: 91\.0%/);
  assert.match(summary, /urgencia \(puntuación\): 2\.35/);
  assert.match(summary, /alta: 65\.0%/);
  assert.match(summary, /confirmacion \(probabilidad de sí\): 82\.0%/);
  assert.match(summary, /Probabilidad de no: 18\.0%/);
  assert.match(summary, /42 entrada/);
});

test('muestra errores de Laya y acepta respuestas que ya vienen sin envoltorio HTTP', () => {
  assert.equal(formatLayaResult(JSON.stringify({ success: false, error: 'Sin servidor' })), '  Error: Sin servidor');
  assert.match(formatLayaResult(JSON.stringify({ answers: { urgencia: { type: 'score', score: 1.5 } } })), /urgencia \(puntuación\): 1\.5/);
  assert.equal(formatLayaResult('no es JSON'), null);
});
