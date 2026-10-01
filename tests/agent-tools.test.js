import test from 'node:test';
import assert from 'node:assert/strict';
import { executeToolCallsSequentially, processToolResults, removeSentImages, requiresChromeProfileConsent } from '../tools/agent-tool-flow.js';

test('solo el perfil real de Chrome requiere consentimiento fuera de los argumentos del modelo', () => {
  assert.equal(requiresChromeProfileConsent('browser_navigate', { use_user_profile: true }), true);
  assert.equal(requiresChromeProfileConsent('browser_navigate', { use_user_profile: false }), false);
  assert.equal(requiresChromeProfileConsent('browser_navigate', { use_user_profile: null }), false);
  assert.equal(requiresChromeProfileConsent('computer_click', { use_user_profile: true }), false);
  assert.equal(requiresChromeProfileConsent('desktop_click', { use_user_profile: true }), false);
});

test('adjunta capturas como input_image y conserva la salida textual de la herramienta', () => {
  const screenshotPayload = {
    success: true,
    url: 'https://example.test/',
    title: 'Example',
    mime_type: 'image/png',
    image_data: 'cG5nLWJhc2U2NA==',
  };
  const toolResults = [{
    type: 'function_call_output',
    call_id: 'call-screenshot',
    output: JSON.stringify(screenshotPayload),
  }];

  const { toolResults: processed, requestedContent } = processToolResults(toolResults);
  const outputPayload = JSON.parse(processed[0].output);
  assert.deepEqual(outputPayload, { success: true, url: 'https://example.test/', title: 'Example', mime_type: 'image/png' });
  assert.ok(!processed[0].output.includes(screenshotPayload.image_data));
  assert.equal(requestedContent[0].type, 'input_text');
  assert.match(requestedContent[0].text, /call-screenshot/);
  assert.deepEqual(requestedContent[1], {
    type: 'input_image',
    image_url: 'data:image/png;base64,cG5nLWJhc2U2NA==',
  });
});

test('elimina las imágenes del historial después de enviarlas y mantiene texto contextual', () => {
  const imageUrl = 'data:image/png;base64,large-image-data';
  const history = [
    { role: 'user', content: [{ type: 'input_text', text: 'Mira esta pantalla' }, { type: 'input_image', image_url: imageUrl }] },
    { role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] },
    { role: 'assistant', content: 'Siguiente paso' },
  ];

  const cleaned = removeSentImages(history);
  assert.deepEqual(cleaned[0].content, [{ type: 'input_text', text: 'Mira esta pantalla' }]);
  assert.deepEqual(cleaned[1].content, [{ type: 'input_text', text: '[La imagen ya se envió en una solicitud anterior; se omite del historial.]' }]);
  assert.equal(cleaned[2], history[2]);
  assert.ok(!JSON.stringify(cleaned).includes(imageUrl));
  assert.deepEqual(removeSentImages(cleaned), cleaned);
  // Cleanup returns a copy and does not remove the image from the already-sent request.
  assert.equal(history[0].content[1].image_url, imageUrl);
});

test('ejecuta llamadas de herramientas secuencialmente en el orden recibido', async () => {
  const events = [];
  const calls = [{ call_id: 'first' }, { call_id: 'second' }, { call_id: 'third' }];
  const results = await executeToolCallsSequentially(calls, {}, async (call) => {
    events.push(`start:${call.call_id}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push(`end:${call.call_id}`);
    return call.call_id;
  });

  assert.deepEqual(events, [
    'start:first', 'end:first',
    'start:second', 'end:second',
    'start:third', 'end:third',
  ]);
  assert.deepEqual(results, ['first', 'second', 'third']);
});
