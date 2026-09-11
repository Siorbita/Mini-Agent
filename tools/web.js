const MAX_BYTES = 1_500_000;
const MAX_TEXT = 60_000;
const MAX_LINKS = 50;
const REQUEST_TIMEOUT = 15_000;

function validUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se permiten URLs HTTP o HTTPS.');
  return url;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\\s+/g, ' ').trim();
}

function linksFromHtml(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
      seen.add(url.href);
      links.push({ url: url.href, text: stripHtml(match[2]).slice(0, 200) });
      if (links.length >= MAX_LINKS) break;
    } catch { /* enlace inválido */ }
  }
  return links;
}

async function fetchPage(url, headers = {}) {
  const response = await fetch(url, { headers: { 'user-agent': 'mini-agent/1.0 (+web research)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1', ...headers }, signal: AbortSignal.timeout(REQUEST_TIMEOUT), redirect: 'follow' });
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_BYTES) throw new Error('La página excede el tamaño máximo permitido.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) throw new Error('La página excede el tamaño máximo permitido.');
  return { response, html: new TextDecoder().decode(buffer) };
}

export const webTools = {
  web_fetch: async ({ url, extract = 'text', max_chars = MAX_TEXT }) => {
    try {
      const target = validUrl(url);
      const { response, html } = await fetchPage(target.href);
      const limit = Math.max(1_000, Math.min(Number(max_chars) || MAX_TEXT, MAX_TEXT));
      const result = { url: response.url, status: response.status, content_type: response.headers.get('content-type') || '', title: (html.match(/<title[^>]*>([\\s\\S]*?)<\/title>/i)?.[1] || '').trim().slice(0, 300) };
      if (extract === 'links') result.links = linksFromHtml(html, response.url);
      else if (extract === 'html') result.content = html.slice(0, limit);
      else result.content = stripHtml(html).slice(0, limit);
      return JSON.stringify(result);
    } catch (error) { return JSON.stringify({ error: `No se pudo obtener la página: ${error.message}` }); }
  },
  web_search: async ({ query, max_results = 5 }) => {
    try {
      if (!query?.trim()) throw new Error('La consulta no puede estar vacía.');
      const limit = Math.max(1, Math.min(Number(max_results) || 5, 10));
      const target = new URL('https://html.duckduckgo.com/html/');
      target.searchParams.set('q', query.trim());
      const { response, html } = await fetchPage(target.href, { accept: 'text/html' });
      const results = [];
      for (const match of html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let url = match[1];
        try { url = new URL(url, response.url).href; } catch { continue; }
        results.push({ title: stripHtml(match[2]), url, snippet: '' });
        if (results.length >= limit) break;
      }
      return JSON.stringify({ query, results, count: results.length });
    } catch (error) { return JSON.stringify({ error: `Búsqueda web fallida: ${error.message}` }); }
  },
};
