const DEFAULT_SERVER_URL = 'http://127.0.0.1:18765';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_STATE_CHARS = 100_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function getServerUrl() {
  const base = new URL(process.env.LAYA_SERVER_URL || DEFAULT_SERVER_URL);
  if (base.protocol !== 'http:' || !LOOPBACK_HOSTS.has(base.hostname)) {
    throw new Error('LAYA_SERVER_URL debe apuntar a un servidor HTTP local (127.0.0.1, localhost o ::1); no se envía el estado a hosts remotos.');
  }
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  base.search = '';
  base.hash = '';
  return new URL('predict', base).href;
}

function buildQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 20) {
    throw new Error('Incluye entre 1 y 20 preguntas para evaluar en una sola inferencia.');
  }
  const result = {};
  for (const question of questions) {
    if (!question || typeof question.name !== 'string' || !/^[\w-]{1,64}$/u.test(question.name)) {
      throw new Error('Cada pregunta necesita un name único de hasta 64 caracteres (letras, números, _ o -).');
    }
    if (Object.hasOwn(result, question.name)) throw new Error(`El nombre de pregunta «${question.name}» está repetido.`);
    if (typeof question.instructions !== 'string' || !question.instructions.trim()) {
      throw new Error(`La pregunta «${question.name}» necesita instrucciones claras.`);
    }
    if (!['choice', 'score', 'noul'].includes(question.type)) throw new Error(`Tipo de pregunta inválido en «${question.name}».`);

    const criteria = question.criteria;
    if (question.type === 'choice') {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 20) {
        throw new Error(`La pregunta choice «${question.name}» requiere de 2 a 20 opciones.`);
      }
      const options = {};
      for (const item of criteria) {
        if (!item?.key?.trim() || !item?.description?.trim()) throw new Error(`Cada opción de «${question.name}» necesita key y description.`);
        if (Object.hasOwn(options, item.key)) throw new Error(`La opción «${item.key}» está repetida en «${question.name}».`);
        options[item.key] = item.description;
      }
      result[question.name] = { type: 'choice', instructions: question.instructions, criteria: options };
    } else if (question.type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) {
        throw new Error(`La pregunta score «${question.name}» requiere de 2 a 10 niveles ordenados.`);
      }
      result[question.name] = { type: 'score', instructions: question.instructions, criteria: criteria.map((item) => {
        if (!item?.description?.trim()) throw new Error(`Cada nivel de «${question.name}» necesita una description.`);
        return item.description;
      }) };
    } else {
      result[question.name] = { type: 'noul', instructions: question.instructions };
    }
  }
  return result;
}

export const layaTools = {
  laya_predict: async ({ state, questions }) => {
    try {
      if (typeof state !== 'string' || !state.trim()) throw new Error('state debe contener texto o un JSON serializado con el contexto que se va a evaluar.');
      if (state.length > MAX_STATE_CHARS) throw new Error(`state excede el límite de ${MAX_STATE_CHARS} caracteres; resume y conserva solo la evidencia relevante.`);
      const url = getServerUrl();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ state, questions: buildQuestions(questions) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
        return JSON.stringify({ success: false, error: `El servidor Laya respondió con ${detail}.` });
      }
      return JSON.stringify({ success: true, result: body });
    } catch (error) {
      const unavailable = error.cause || error.name === 'TypeError' || error.name === 'TimeoutError';
      const advice = unavailable
        ? ' Comprueba que Python y las dependencias locales de Laya están instalados (npm install) y que LAYA_SERVER_URL apunta al servidor local, por defecto http://127.0.0.1:18765.'
        : '';
      return JSON.stringify({ success: false, error: `${error.message}${advice}` });
    }
  },
};

const questionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'ID único y corto para recuperar esta respuesta, p. ej. categoria o urgencia.' },
    type: { type: 'string', enum: ['choice', 'score', 'noul'], description: 'choice elige una etiqueta; score puntúa una escala ordinal; noul estima la probabilidad de una respuesta sí/no.' },
    instructions: { type: 'string', description: 'Una pregunta concreta, específica y respondible usando únicamente la evidencia de state.' },
    criteria: {
      type: 'array',
      description: 'Para choice, opciones mutuamente distinguibles (2-20) con su key y definición; para score, niveles ordenados de menor a mayor como descripciones. Para noul, usa [].',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Etiqueta estable que devolverá Laya para choice. Para score puede repetirse el índice como texto.' },
          description: { type: 'string', description: 'Significado de la opción o descripción concreta del nivel ordinal.' },
        },
        required: ['key', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'type', 'instructions', 'criteria'],
  additionalProperties: false,
};

export const layaToolsSchema = [{
  type: 'function',
  name: 'laya_predict',
  description: 'Evalúa hasta 20 preguntas estructuradas sobre el mismo texto/estado con el modelo Laya local (sin API externa y sin generar texto libre). Úsala para clasificación, enrutamiento, detección sí/no, extracción de señales y puntuación ordinal en una sola inferencia. state debe contener el mensaje/documento y solo el contexto necesario. Formula instrucciones inequívocas; choice: 2-20 opciones mutuamente diferenciables, con definiciones breves y una opción residual como «otro» si hace falta; score: 2-10 niveles ordinales en orden de menor a mayor; noul: una pregunta binaria cuya respuesta positiva sea explícita. Incluye varias preguntas independientes en la misma llamada. Lee result.answers y, si existe, las probabilidades/distribuciones; no inventes explicaciones porque Laya solo decide etiquetas/puntuaciones y no genera texto. Es una señal rápida, no un LLM general ni garantía de acierto: valida decisiones de alto impacto, no trates la confianza como certeza y usa el modelo generativo principal para razonamiento, explicaciones o tareas abiertas. El Router gestiona automáticamente la lengua. La CLI instala las dependencias Python durante npm install e inicia/detiene el servidor local junto con el agente; LAYA_SERVER_URL permite configurar la dirección de loopback.',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'Texto o JSON serializado que se evalúa; incluye hechos pertinentes y evita datos irrelevantes.' },
      questions: { type: 'array', minItems: 1, maxItems: 20, items: questionSchema, description: 'Preguntas tipadas a evaluar conjuntamente sobre state.' },
    },
    required: ['state', 'questions'],
    additionalProperties: false,
  },
  strict: true,
}];
