import { parseArgs } from 'node:util';

function parseList(value) {
  return (value ?? '').split(',').map(part => part.trim()).filter(Boolean);
}

function positiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return number;
}

export function loadRuntimeConfig(env = process.env, args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    transport: { type: 'string' },
    host: { type: 'string' },
    port: { type: 'string' }
  } });
  const transport = values.transport ?? env.MCP_TRANSPORT ?? 'stdio';
  if (!['stdio', 'streamable-http'].includes(transport)) {
    throw new Error(`Unsupported MCP transport: ${transport}`);
  }
  const config = {
    transport,
    host: values.host ?? env.MCP_HOST ?? '127.0.0.1',
    port: positiveInteger(values.port ?? env.MCP_PORT ?? '3001', 'MCP_PORT', 65535),
    allowedHosts: parseList(env.MCP_ALLOWED_HOSTS),
    allowedOrigins: parseList(env.MCP_ALLOWED_ORIGINS),
    token: env.MCP_AUTH_TOKEN || null,
    shutdownTimeoutMs: positiveInteger(env.MCP_SHUTDOWN_TIMEOUT_MS ?? '55000', 'MCP_SHUTDOWN_TIMEOUT_MS'),
    maxConcurrentRequests: positiveInteger(env.MCP_MAX_CONCURRENT_REQUESTS ?? '16', 'MCP_MAX_CONCURRENT_REQUESTS')
  };
  if (!config.host.trim()) throw new Error('MCP_HOST must not be empty');
  if (transport === 'streamable-http' && (!config.token || !config.allowedHosts.length)) {
    throw new Error('HTTP requires MCP_AUTH_TOKEN and MCP_ALLOWED_HOSTS');
  }
  return config;
}