function parsePayload(output) {
  try {
    const payload = typeof output === 'string' ? JSON.parse(output) : output;
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  }
}

function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const bounded = Math.max(0, Math.min(1, value));
  return `${(bounded * 100).toFixed(1)}%`;
}

function listProbabilities(probabilities, legend) {
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) return [];
  return Object.entries(probabilities)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => {
      const label = legend && Object.hasOwn(legend, key) ? legend[key] : key;
      return `      ${label}: ${percent(value)}`;
    });
}

function formatQuestion(name, answer, root) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return [`  • ${name}: ${String(answer)}`];
  }
  const lines = [];
  const type = answer.type || (Object.hasOwn(answer, 'choice') ? 'choice' : Object.hasOwn(answer, 'score') ? 'score' : Object.hasOwn(answer, 'noul') ? 'noul' : '');
  const legend = answer.legend && typeof answer.legend === 'object' ? answer.legend : null;
  const probabilities = answer.probabilities
    ?? root.probabilities?.[name]
    ?? root.distributions?.[name];

  if (type === 'choice' || Object.hasOwn(answer, 'choice')) {
    lines.push(`  • ${name} (categoría): ${answer.choice ?? 'sin etiqueta'}`);
  } else if (type === 'score' || Object.hasOwn(answer, 'score')) {
    lines.push(`  • ${name} (puntuación): ${answer.score ?? 'sin puntuación'}`);
  } else if (type === 'noul' || Object.hasOwn(answer, 'noul')) {
    const yes = percent(answer.noul);
    lines.push(`  • ${name} (probabilidad de sí): ${yes ?? answer.noul}`);
    if (typeof answer.noul === 'number' && Number.isFinite(answer.noul)) {
      lines.push(`      Probabilidad de no: ${percent(1 - answer.noul)}`);
    }
  } else {
    lines.push(`  • ${name}`);
  }

  const probabilityLines = listProbabilities(probabilities, legend);
  if (probabilityLines.length) lines.push('      Distribución:', ...probabilityLines);
  const calibrated = percent(answer.answer_confidence);
  if (calibrated !== null) lines.push(`      Confianza de la respuesta (calibrada): ${calibrated}`);
  const concentration = percent(answer.confidence);
  if (concentration !== null) lines.push(`      Concentración de la distribución (no calibrada): ${concentration}`);
  const actionProbability = percent(answer.action?.act_probability);
  if (actionProbability !== null) lines.push(`      Probabilidad de acción: ${actionProbability}`);
  return lines;
}

/** Convierte la salida de laya_predict en un resumen visible para la terminal. */
export function formatLayaResult(output) {
  const payload = parsePayload(output);
  if (!payload) return null;
  if (payload.success === false) return `  Error: ${payload.error || 'Laya no pudo completar la evaluación.'}`;

  const result = payload.result && typeof payload.result === 'object' ? payload.result : payload;
  const lines = [];
  if (typeof result.model === 'string') lines.push(`  Modelo: ${result.model}`);
  if (result.routing && typeof result.routing === 'object') {
    const route = result.routing;
    const details = [route.model, route.language || route.detection?.language].filter((item) => typeof item === 'string');
    if (details.length) lines.push(`  Enrutamiento: ${details.join(' · ')}`);
  }

  const answers = result.answers;
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    for (const [name, answer] of Object.entries(answers)) lines.push(...formatQuestion(name, answer, result));
  }

  const usage = result.usage;
  if (usage && typeof usage === 'object') {
    const input = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    if (Number.isFinite(input) || Number.isFinite(outputTokens)) {
      lines.push(`  Tokens: ${Number.isFinite(input) ? input : '?'} entrada · ${Number.isFinite(outputTokens) ? outputTokens : '?'} salida`);
    }
  }

  if (!lines.length) lines.push(`  Resultado: ${JSON.stringify(result, null, 2)}`);
  return lines.join('\n');
}
