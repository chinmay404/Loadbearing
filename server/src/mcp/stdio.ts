#!/usr/bin/env node
// The MCP server as a local process, for clients that launch one.
//
// The deployment serves the same tools over HTTP at /api/mcp, which is what a hosted
// chatbot needs. This is for the other case: a client that spawns a command and talks
// to it over stdin and stdout, pointed at whichever Loadbearing you actually use —
// localhost while developing, the deployment otherwise.
//
// Nothing but wiring. The tools live in tools.ts precisely so that neither transport
// is where a capability gets decided.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LoadbearingClient } from './client.js';
import { mcpServer } from './tools.js';

const BASE_URL = (process.env.LOADBEARING_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const TOKEN = process.env.LOADBEARING_TOKEN ?? '';

if (!TOKEN) {
  // stderr, not stdout: stdout is the protocol channel, and anything else on it is a
  // parse error at the other end.
  console.error(
    "LOADBEARING_TOKEN is not set. Mint one in Loadbearing under Grader model → API tokens, then put it in this server's env.",
  );
  process.exit(1);
}

await mcpServer(new LoadbearingClient(BASE_URL, TOKEN)).connect(new StdioServerTransport());

// Announced on stderr so a misconfigured URL is visible in the client's server log
// rather than showing up later as every tool failing for no stated reason.
console.error(`[loadbearing-mcp] connected, talking to ${BASE_URL}`);
