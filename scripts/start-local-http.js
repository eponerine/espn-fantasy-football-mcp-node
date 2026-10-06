import { randomBytes } from 'node:crypto';

if (!process.env.MCP_AUTH_TOKEN) {
  process.env.MCP_AUTH_TOKEN = randomBytes(32).toString('hex');
  console.error('Using an ephemeral local token; set MCP_AUTH_TOKEN in .env for client integration.');
}
process.env.MCP_TRANSPORT = 'streamable-http';
process.env.MCP_HOST = '127.0.0.1';
process.env.MCP_PORT = process.env.MCP_PORT || '3001';
process.env.MCP_ALLOWED_HOSTS = 'localhost,127.0.0.1';
await import('../src/index.js');