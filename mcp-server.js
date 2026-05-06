#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { run } = require('./src/agent');

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

const transport = new StdioServerTransport();
server.connect(transport);
