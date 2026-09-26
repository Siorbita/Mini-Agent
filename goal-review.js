const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_work'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['severity', 'file', 'issue', 'suggested_fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'summary', 'findings'],
  additionalProperties: false,
};

const REVIEW_INSTRUCTIONS = `Eres un agente revisor independiente de cambios de software. Verifica el objetivo solicitado contra la evidencia de implementación y las salidas de herramientas/pruebas. Busca errores funcionales, requisitos incumplidos, regresiones y problemas de seguridad introducidos por el cambio. No ejecutes ni sugieras como hechos pruebas que no aparecen en la evidencia. No bloquees por estilo, preferencias personales o mejoras opcionales. Usa needs_work solo para hallazgos concretos, relevantes y corregibles que impidan considerar terminado el objetivo; usa pass si no encuentras problemas bloqueantes. Los hallazgos low no bloquean. No modifiques archivos. Devuelve únicamente el objeto JSON solicitado.`;

export function parseGoalReview(text) {
  try {
    const parsed = JSON.parse(text);
    if (!['pass', 'needs_work'].includes(parsed.verdict)
      || typeof parsed.summary !== 'string'
      || !Array.isArray(parsed.findings)
      || parsed.findings.some((finding) => !finding
        || !['critical', 'high', 'medium', 'low'].includes(finding.severity)
        || typeof finding.file !== 'string'
        || typeof finding.issue !== 'string'
        || typeof finding.suggested_fix !== 'string')) {
      throw new Error('Respuesta del revisor con formato inválido.');
    }
    const hasBlockingFinding = parsed.findings.some((finding) => finding.severity !== 'low');
    if (parsed.verdict === 'pass' && hasBlockingFinding) {
      return { ...parsed, verdict: 'needs_work', status: 'needs_work' };
    }
    if (parsed.verdict === 'needs_work' && !hasBlockingFinding) {
      return { ...parsed, verdict: 'pass', status: 'pass' };
    }
    return { ...parsed, status: parsed.verdict };
  } catch (error) {
    return { status: 'unavailable', summary: error.message, findings: [] };
  }
}

export async function reviewGoal({ openai, model, goal, evidence }) {
  try {
    const response = await openai.responses.create({
      model,
      input: [
        { role: 'developer', content: REVIEW_INSTRUCTIONS },
        {
          role: 'user',
          content: `OBJETIVO ORIGINAL:\n${goal}\n\nEVIDENCIA DE LA TAREA (puede estar truncada; distingue hechos de afirmaciones del agente):\n${evidence}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'goal_review',
          strict: true,
          schema: REVIEW_SCHEMA,
        },
      },
    });
    return { review: parseGoalReview(response.output_text || ''), usage: response.usage };
  } catch (error) {
    return {
      review: { status: 'unavailable', summary: error.message || 'No se pudo contactar al agente revisor.', findings: [] },
      usage: null,
      error,
    };
  }
}

export function formatReviewFeedback(review) {
  const findings = review.findings
    .filter((finding) => finding.severity !== 'low')
    .map((finding, index) => `${index + 1}. [${finding.severity}] ${finding.file}: ${finding.issue}\n   Corrección sugerida: ${finding.suggested_fix}`)
    .join('\n');
  return `La revisión independiente encontró problemas que debes resolver antes de dar la tarea por terminada.\nResumen: ${review.summary}\n${findings}\nCorrige los hallazgos en el proyecto, ejecuta las comprobaciones relevantes y vuelve a resumir qué cambiaste. No afirmes que una prueba pasó si no la ejecutaste.`;
}
