#!/usr/bin/env node
import { startMiniAgentMcpServer } from './mcp.js';

try {
  await startMiniAgentMcpServer();
} catch (error) {
  console.error(`Mini Agent MCP server failed: ${error.message}`);
  process.exitCode = 1;
}
