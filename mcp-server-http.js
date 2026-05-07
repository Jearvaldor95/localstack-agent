#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');
const { run } = require('./src/agent');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = new McpServer({
  name: 'localstack-agent',
  version: '1.0.0',
});

server.tool(
  'provision_localstack',
  'Scans AWS service usage (DynamoDB, SQS, S3, SNS, IAM) in a project and creates the resources in LocalStack',
  { projectPath: z.string().describe('Absolute or relative path to the project root') },
  async ({ projectPath }) => {
    const result = await run(projectPath);
    return {
      content: [{ type: 'text', text: result.log.join('\n') }],
    };
  }
);

// Mapa de transportes activos por sesión
const transports = {};

const httpServer = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'localstack-agent' }));
    return;
  }

  // SSE endpoint — el cliente se conecta aquí primero
  if (req.method === 'GET' && req.url === '/sse') {
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;

    res.on('close', () => {
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
    return;
  }

  // Messages endpoint — el cliente envía mensajes aquí
  if (req.method === 'POST' && req.url?.startsWith('/messages')) {
    const sessionId = new URL(req.url, `http://localhost`).searchParams.get('sessionId');
    const transport = transports[sessionId];

    if (!transport) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

httpServer.listen(PORT, () => {
  console.log(`✅ MCP Server (HTTP/SSE) corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   SSE endpoint:  http://0.0.0.0:${PORT}/sse`);
  console.log(`   Health check:  http://0.0.0.0:${PORT}/health`);
});
