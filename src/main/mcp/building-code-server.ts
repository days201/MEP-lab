import { existsSync } from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createOpenAIEmbeddingClient } from './building-code/embedding';
import { loadBuildingCodeIndex, type BuildingCodeIndex } from './building-code/index-store';
import {
  BuildingCodeSemanticSearchUnavailableError,
  lookupTable,
  readSection,
  resolveCrossRefsForNode,
  searchBuildingCode,
  type BuildingCodeToolResult,
} from './building-code/retrieval';

type BuildingCodeToolName = 'search' | 'read_section' | 'resolve_cross_refs' | 'lookup_table';

interface ToolDefinition {
  name: BuildingCodeToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function listBuildingCodeTools(): ToolDefinition[] {
  return [
    {
      name: 'search',
      description: 'Find cited building-code sections and tables by semantic query.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_section',
      description: 'Read a full canonical building-code section, table, figure, or appendix.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          includeChildren: { type: 'boolean' },
        },
        required: ['ref'],
      },
    },
    {
      name: 'resolve_cross_refs',
      description: 'Resolve deterministic cross-references from a cited building-code node.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          depth: { type: 'number', enum: [1, 2] },
        },
        required: ['ref'],
      },
    },
    {
      name: 'lookup_table',
      description: 'Look up cited building-code table rows and notes.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          filters: { type: 'object' },
          query: { type: 'string' },
        },
        required: ['ref'],
      },
    },
  ];
}

export async function handleBuildingCodeTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ content: Array<{ type: 'text'; text: string }> } & BuildingCodeToolResult> {
  const index = await loadIndex();
  let result: BuildingCodeToolResult;

  switch (name) {
    case 'search':
      assertSemanticSearchAvailable(index);
      result = await searchBuildingCode(index, {
        query: requireString(args.query, 'query'),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        embeddingClient: createOpenAIEmbeddingClient(),
      });
      break;
    case 'read_section':
      result = readSection(index, {
        ref: requireString(args.ref, 'ref'),
        includeChildren: args.includeChildren === true,
      });
      break;
    case 'resolve_cross_refs':
      result = resolveCrossRefsForNode(index, {
        ref: requireString(args.ref, 'ref'),
        depth: args.depth === 2 ? 2 : 1,
      });
      break;
    case 'lookup_table':
      result = lookupTable(index, {
        ref: requireString(args.ref, 'ref'),
        filters: isRecord(args.filters) ? stringRecord(args.filters) : undefined,
        query: typeof args.query === 'string' ? args.query : undefined,
      });
      break;
    default:
      throw new Error(`Unknown building-code tool: ${name}`);
  }

  return {
    ...result,
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export function createFromBuildingCodePreset(): {
  name: string;
  type: 'stdio';
  command: string;
  args: string[];
} {
  return {
    name: 'Building_Code',
    type: 'stdio',
    command: 'node',
    args: [getBuildingCodeServerPath()],
  };
}

async function loadIndex(): Promise<BuildingCodeIndex> {
  const indexDir = process.env.BUILDING_CODE_INDEX_DIR?.trim();
  if (!indexDir) {
    throw new Error('Building_Code knowledge base is empty. Upload documents in Settings > Knowledge Base.');
  }
  try {
    return await loadBuildingCodeIndex(indexDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Building_Code knowledge base is empty. Upload documents in Settings > Knowledge Base.');
    }
    throw error;
  }
}

function assertSemanticSearchAvailable(index: BuildingCodeIndex): void {
  if (!index.semanticSearchAvailable || index.vectors.length === 0) {
    throw new BuildingCodeSemanticSearchUnavailableError();
  }
}

function getBuildingCodeServerPath(): string {
  const jsPath = path.resolve(__dirname, '../../dist-mcp/building-code-server.js');
  if (existsSync(jsPath)) {
    return jsPath;
  }

  return path.resolve(__dirname, 'building-code-server.ts');
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }

  return value;
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createServer(): Server {
  const server = new Server(
    {
      name: 'building-code',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listBuildingCodeTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleBuildingCodeTool(
        request.params.name,
        request.params.arguments ?? {}
      );

      return {
        content: result.content,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              message: error instanceof Error ? error.message : String(error),
              tool: request.params.name,
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Building Code MCP server failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
