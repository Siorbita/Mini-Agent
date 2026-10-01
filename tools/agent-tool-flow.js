import { extractRequestedFiles } from '../attachments.js';

export function requiresChromeProfileConsent(toolName, args) {
  return toolName === 'browser_navigate' && args?.use_user_profile === true;
}

export async function executeToolCallsSequentially(calls, options, execute) {
  const results = [];
  for (const call of calls) results.push(await execute(call, options));
  return results;
}

export function processToolResults(toolResults) {
  const requestedContent = [];
  for (const toolResult of toolResults) {
    const requestedFiles = extractRequestedFiles(toolResult.output);
    if (requestedFiles) {
      toolResult.output = requestedFiles.output;
      requestedContent.push(...requestedFiles.content);
    }
    try {
      const payload = JSON.parse(toolResult.output);
      if (payload.image_data && payload.mime_type?.startsWith('image/')) {
        const imageData = payload.image_data;
        delete payload.image_data;
        toolResult.output = JSON.stringify(payload);
        requestedContent.push({
          type: 'input_text',
          text: `Captura de pantalla adjunta (${toolResult.call_id}).`,
        });
        requestedContent.push({ type: 'input_image', image_url: `data:${payload.mime_type};base64,${imageData}` });
      }
    } catch { /* conserva como texto las salidas que no son JSON */ }
  }
  return { toolResults, requestedContent };
}

// Keep image payloads only in the request that first sends them. Preserve a
// small marker in history so later turns know an image was already supplied.
export function removeSentImages(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    const imageCount = message.content.filter((part) => part?.type === 'input_image').length;
    if (!imageCount) return message;
    const content = message.content.filter((part) => part?.type !== 'input_image');
    if (!content.length) {
      content.push({ type: 'input_text', text: '[La imagen ya se envió en una solicitud anterior; se omite del historial.]' });
    }
    return { ...message, content };
  });
}
