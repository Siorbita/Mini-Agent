import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAvailableToolSchema, McpToolManager } from '../tools/mcp.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

 test('conecta el MCP integrado, descubre herramientas web/navegador y conserva las herramientas locales', async (context) => {
  const manager = new McpToolManager();
  context.after(() => manager.close());
  const status = await manager.start();
  assert.deepEqual(status.connected, ['mini_agent']);
  assert.equal(status.errors.length, 0);
  assert.ok(manager.tools.some((tool) => tool.name === 'mcp__mini_agent__web_search'));
  assert.ok(manager.tools.some((tool) => tool.name === 'mcp__mini_agent__browser_navigate'));
  const schemas = getAvailableToolSchema(manager.tools);
  assert.equal(schemas.some((tool) => tool.name === 'web_search'), false);
  assert.equal(schemas.some((tool) => tool.name === 'browser_navigate'), false);
  assert.ok(schemas.some((tool) => tool.name === 'read_file'));
  assert.ok(schemas.some((tool) => tool.name === 'desktop_sequence'));
  assert.ok(schemas.some((tool) => tool.name === 'mcp__mini_agent__web_search'));
});

test('descubre y ejecuta un servidor MCP stdio declarado en el archivo de configuración', async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-mcp-test-'));
  const configPath = path.join(temporaryDirectory, 'mcp.json');
  await fs.writeFile(configPath, JSON.stringify({
    mcpServers: {
      fixture: {
        command: process.execPath,
        args: [path.join(projectRoot, 'tests', 'fixtures', 'mcp-fixture-server.js')],
      },
    },
  }));
  const originalConfigPath = process.env.MINI_AGENT_MCP_CONFIG;
  process.env.MINI_AGENT_MCP_CONFIG = configPath;
  const manager = new McpToolManager();
  context.after(async () => {
    await manager.close();
    if (originalConfigPath === undefined) delete process.env.MINI_AGENT_MCP_CONFIG;
    else process.env.MINI_AGENT_MCP_CONFIG = originalConfigPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const status = await manager.start();
  assert.deepEqual(status.connected, ['mini_agent', 'fixture']);
  assert.deepEqual(status.errors, []);
  const echo = manager.tools.find((tool) => tool.name === 'mcp__fixture__echo_text');
  assert.ok(echo);
  assert.equal(echo.parameters.properties.text.type, 'string');
  assert.deepEqual(JSON.parse(await manager.call(echo.name, { text: 'hola MCP' })), { echoed: 'hola MCP' });
  assert.equal(manager.requiresConfirmation(echo.name), false);
  assert.equal(manager.requiresConfirmation('mcp__fixture__delete_records'), true);
});
