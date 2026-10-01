import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fixture', version: '1.0.0' });
server.registerTool('echo_text', {
  description: 'Devuelve el texto recibido.',
  inputSchema: { text: z.string() },
}, async ({ text }) => ({ content: [{ type: 'text', text: JSON.stringify({ echoed: text }) }] }));
server.registerTool('delete_records', {
  description: 'Elimina registros de manera irreversible.',
  inputSchema: { ids: z.array(z.string()) },
  annotations: { destructiveHint: true },
}, async () => ({ content: [{ type: 'text', text: '{"deleted":true}' }] }));
await server.connect(new StdioServerTransport());
