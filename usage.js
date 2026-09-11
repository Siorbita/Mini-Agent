const PRICING_PER_MILLION = {
  'gpt-5.6-luna': { input: 2.5, output: 10 },
  'gpt-5.6-terra': { input: 1.25, output: 5 },
  'gpt-5.6-sol': { input: 0.5, output: 2 },
  'gpt-6-astra': { input: 10, output: 50 },
  'gpt-4o': { input: 2.5, output: 10 },
};

export function getUsage(response) {
  const usage = response?.usage;
  if (!usage) return null;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_token_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? input + output);
  return { input, cached, output, total };
}

export function estimateCost(usage, model) {
  if (!usage) return null;
  const pricing = PRICING_PER_MILLION[model];
  if (!pricing) return null;
  return (usage.input * pricing.input + usage.output * pricing.output) / 1_000_000;
}

export function formatUsage(response, model, { color = true } = {}) {
  const usage = getUsage(response);
  if (!usage) return '';
  const cost = estimateCost(usage, model);
  const amount = cost === null ? 'coste no disponible' : `≈ $${cost.toFixed(6)}`;
  const cacheText = usage.cached ? `, cache ${usage.cached.toLocaleString('es-ES')}` : '';
  const text = `tokens: ${usage.total.toLocaleString('es-ES')} (entrada ${usage.input.toLocaleString('es-ES')}${cacheText}, salida ${usage.output.toLocaleString('es-ES')}) · ${amount}`;
  return color ? `\x1b[90m${text}\x1b[0m` : text;
}
