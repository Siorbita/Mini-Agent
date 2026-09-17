import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MIME_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };

export async function fileToInput(filePath) {
  const absolute = path.resolve(filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`${filePath} no es un archivo.`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`${filePath} supera el límite de 20 MB.`);
  const mime = MIME_TYPES[path.extname(absolute).toLowerCase()];
  if (!mime) throw new Error(`Tipo no compatible: ${path.extname(absolute) || '(sin extensión)'}. Usa PNG, JPG, WEBP o PDF.`);
  const data = (await fs.readFile(absolute)).toString('base64');
  const dataUrl = `data:${mime};base64,${data}`;
  return mime === 'application/pdf'
    ? { type: 'input_file', filename: path.basename(absolute), file_data: dataUrl }
    : { type: 'input_image', image_url: dataUrl, detail: 'auto' };
}

export async function filesToInput(paths) {
  return Promise.all(paths.map(fileToInput));
}

// Convierte la respuesta de request_files en contenido nativo de Responses API.
// El base64 nunca se deja dentro del texto de la herramienta: se entrega como
// input_file/input_image en el turno siguiente.
export function extractRequestedFiles(toolOutput) {
  let payload;
  try { payload = JSON.parse(toolOutput); } catch { return null; }
  if (!payload.success || !Array.isArray(payload.files)) return null;

  const content = [];
  const metadata = [];
  for (const file of payload.files) {
    if (!file?.data || !file.mime_type || !file.input_type) continue;
    const dataUrl = `data:${file.mime_type};base64,${file.data}`;
    content.push(file.input_type === 'input_image'
      ? { type: 'input_image', image_url: dataUrl, detail: 'auto' }
      : { type: 'input_file', filename: file.filename, file_data: dataUrl });
    metadata.push({ path: file.path, filename: file.filename, mime_type: file.mime_type });
  }
  if (!content.length) return null;
  return {
    output: JSON.stringify({ success: true, files: metadata, message: 'Archivos adjuntados al siguiente turno.' }),
    content,
  };
}
