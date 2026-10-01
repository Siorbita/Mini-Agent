import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { toolsImplementations, toolsSchema } from './index.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const INTERNAL_TOOLS = new Set(toolsSchema.map(({ name }) => name).filter((name) => name.startsWith('web_') || name.startsWith('browser_')));

function schemaToZod(schema = {}) {
  if (schema.enum) {
    const values = schema.enum;
    if (values.length && values.every((value) => typeof value === 'string')) return z.enum(values);
    if (values.length === 1) return z.literal(values[0]);
    return z.union(values.map((value) => z.literal(value)));
  }
  if (Array.isArray(schema.type)) {
    const members = schema.type.map((type) => schemaToZod({ ...schema, type }));
    return members.length === 1 ? members[0] : z.union(members);
  }
  switch (schema.type) {
    case 'string': return z.string();
    case 'integer': return z.number().int();
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    case 'array': return z.array(schemaToZod(schema.items || {}));
    case 'object': {
      const required = new Set(schema.required || []);
      const shape = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => [
        key,
        required.has(key) ? schemaToZod(value) : schemaToZod(value).optional(),
      ]));
      return z.object(shape).passthrough();
    }
    default: return z.unknown();
  }
}

export function getInternalMcpTools() {
  return [...INTERNAL_TOOLS].map((name) => toolsSchema.find((entry) => entry.name === name)).filter(Boolean);
}

export async function startMiniAgentMcpServer() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = new McpServer({ name: 'mini-agent', version: '1.0.0' });
  for (const definition of getInternalMcpTools()) {
    const implementation = toolsImplementations[definition.name];
    if (!implementation) continue;
    const inputSchema = schemaToZod(definition.parameters);
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema,
      annotations: { readOnlyHint: definition.name.startsWith('web_') || definition.name === 'browser_screenshot' },
    }, async (args) => {
      try {
        if (definition.name === 'browser_navigate' && args.use_user_profile === true && process.env.MINI_AGENT_MCP_EMBEDDED !== '1') {
          throw new Error('El servidor MCP stdio independiente no permite el perfil real de Chrome; usa un perfil aislado.');
        }
        const output = await implementation(args);
        let payload;
        try { payload = JSON.parse(output); } catch { payload = null; }
        if (payload?.image_data && payload.mime_type?.startsWith('image/')) {
          const image = payload.image_data;
          delete payload.image_data;
          return {
            content: [
              { type: 'text', text: JSON.stringify(payload) },
              { type: 'image', data: image, mimeType: payload.mime_type },
            ],
          };
        }
        return { content: [{ type: 'text', text: String(output) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }] };
      }
    });
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

function parseMcpConfig(value) {
  if (value === undefined) return { mcpServers: {} };
  let config;
  try { config = JSON.parse(value); } catch (error) { throw new Error(`La configuración MCP no es JSON válido: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    throw new Error('La configuración MCP debe tener un objeto «mcpServers».');
  }
  return config;
}

async function readConfiguredServers() {
  const configPath = process.env.MINI_AGENT_MCP_CONFIG || path.join(os.homedir(), '.mini-agent', 'mcp.json');
  let content;
  try { content = await fs.readFile(configPath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { configPath, mcpServers: {} };
    throw new Error(`No se pudo leer la configuración MCP ${configPath}: ${error.message}`);
  }
  const config = parseMcpConfig(content);
  return { configPath, mcpServers: config.mcpServers };
}

function validateServer(name, server) {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) throw new Error(`Nombre de servidor MCP no válido: ${name}`);
  if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error(`Definición inválida para el servidor MCP «${name}».`);
  if (typeof server.command !== 'string' || !server.command.trim()) throw new Error(`El servidor MCP «${name}» requiere un comando.`);
  if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) throw new Error(`Los argumentos del servidor MCP «${name}» deben ser una lista de cadenas.`);
  if (server.env !== undefined && (!server.env || typeof server.env !== 'object' || Array.isArray(server.env) || Object.values(server.env).some((value) => typeof value !== 'string'))) throw new Error(`El entorno del servidor MCP «${name}» debe ser un objeto de cadenas.`);
}

function openAiFunction(serverName, tool, functionName) {
  const parameters = tool.inputSchema && tool.inputSchema.type === 'object'
    ? { ...tool.inputSchema, additionalProperties: false }
    : { type: 'object', properties: {}, additionalProperties: false };
  return {
    type: 'function',
    name: functionName,
    description: `[MCP ${serverName}] ${tool.description || tool.name}`,
    parameters,
    strict: false,
  };
}

export class McpToolManager {
  #connections = [];
  #tools = new Map();
  #errors = [];

  get errors() { return [...this.#errors]; }
  get tools() { return [...this.#tools.values()].map((entry) => openAiFunction(entry.serverName, entry.tool, entry.functionName)); }

  async start() {
    const configured = await readConfiguredServers();
    const serverDefinitions = [
      {
        name: 'mini_agent',
        command: process.execPath,
        args: [path.join(MODULE_DIR, 'mcp-server.js')],
        env: { MINI_AGENT_MCP_EMBEDDED: '1', ...(process.env.CHROME_USER_DATA_DIR ? { CHROME_USER_DATA_DIR: process.env.CHROME_USER_DATA_DIR } : {}) },
      },
      ...Object.entries(configured.mcpServers).map(([name, definition]) => ({ name, ...definition })),
    ];
    for (const server of serverDefinitions) {
      let client;
      let transport;
      try {
        validateServer(server.name, server);
        if (server.name === 'mini_agent' && (server.command !== process.execPath || server.args?.[0] !== path.join(MODULE_DIR, 'mcp-server.js'))) throw new Error('«mini_agent» es un nombre reservado para las herramientas integradas.');
        client = new Client({ name: 'mini-agent', version: '1.0.0' });
        transport = new StdioClientTransport({
          command: server.command,
          args: server.args || [],
          env: server.env || {},
          ...(server.cwd ? { cwd: server.cwd } : {}),
          stderr: 'inherit',
        });
        await client.connect(transport);
        this.#connections.push({ client, transport, serverName: server.name });
        const response = await client.listTools();
        for (const tool of response.tools || []) {
          const functionName = `mcp__${server.name}__${tool.name}`;
          if (functionName.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(functionName)) {
            this.#errors.push(`Se omite ${server.name}.${tool.name}: el nombre no cabe en el límite de OpenAI.`);
            continue;
          }
          this.#tools.set(functionName, { client, serverName: server.name, tool, functionName, originalName: tool.name });
        }
      } catch (error) {
        await client?.close().catch(() => {});
        await transport?.close().catch(() => {});
        this.#errors.push(`Servidor MCP «${server.name}»: ${error.message}`);
      }
    }
    return { configPath: configured.configPath, connected: this.#connections.map(({ serverName }) => serverName), errors: this.errors };
  }

  getOriginalToolName(functionName) { return this.#tools.get(functionName)?.originalName || functionName; }

  requiresConfirmation(functionName) {
    const entry = this.#tools.get(functionName);
    if (!entry || entry.serverName === 'mini_agent') return false;
    if (entry.tool.annotations?.destructiveHint === true) return true;
    const details = `${entry.originalName} ${entry.tool.description || ''}`;
    return /(?:^|[\\s_-])(delete|remove|destroy|wipe|erase|purge|purchase|checkout|payment|pay|transfer|send)(?:$|[\\s_-])/i.test(details);
  }

  async call(functionName, args) {
    const entry = this.#tools.get(functionName);
    if (!entry) return JSON.stringify({ success: false, error: `Herramienta MCP no encontrada: ${functionName}` });
    try {
      const result = await entry.client.callTool({ name: entry.originalName, arguments: args });
      const blocks = result.content || [];
      const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      const image = blocks.find((block) => block.type === 'image');
      if (image) {
        let payload;
        try { payload = JSON.parse(text || '{}'); } catch { payload = { text }; }
        return JSON.stringify({ ...payload, mime_type: image.mimeType, image_data: image.data });
      }
      return text || JSON.stringify({ success: !result.isError, content: blocks });
    } catch (error) {
      return JSON.stringify({ success: false, error: `Error en MCP ${entry.serverName}.${entry.originalName}: ${error.message}` });
    }
  }

  async close() {
    await Promise.allSettled(this.#connections.map(async ({ client, transport }) => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }));
    this.#connections = [];
    this.#tools.clear();
  }
}

export function getAvailableToolSchema(mcpTools = []) {
  return [
    ...toolsSchema.filter(({ name }) => !INTERNAL_TOOLS.has(name)),
    ...mcpTools,
  ];
}
