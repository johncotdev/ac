/// <reference types="node" />

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { type Handoff, type Role, RoleSchema } from "../handoff/schema.js";
import {
  createHandoffStore,
  type HandoffStore,
  type HandoffWriteInput,
} from "../handoff/store.js";

const SERVER_INFO = {
  name: "ac-handoffs",
  version: "0.0.0",
};

const RunIdSchema = z
  .string()
  .min(1)
  .refine((run) => run !== "." && !run.includes(".."), "run must not contain path traversal segments")
  .refine((run) => !/[\\/]/.test(run), "run must not contain path separators");

const JsonObjectSchema = z.record(z.string(), z.unknown());

export const WriteHandoffInputSchema = z.strictObject({
  run: RunIdSchema,
  handoff: JsonObjectSchema,
});

export const LatestHandoffInputSchema = z.strictObject({
  run: RunIdSchema,
  role: RoleSchema,
});

export const ReadHandoffInputSchema = z.strictObject({
  run: RunIdSchema,
  seq: z.number().int().positive(),
});

export const ListHandoffsInputSchema = z.strictObject({
  run: RunIdSchema,
});

export const GetRunStateInputSchema = z.strictObject({
  run: RunIdSchema,
});

export type WriteHandoffInput = z.infer<typeof WriteHandoffInputSchema>;
export type LatestHandoffInput = z.infer<typeof LatestHandoffInputSchema>;
export type ReadHandoffInput = z.infer<typeof ReadHandoffInputSchema>;
export type ListHandoffsInput = z.infer<typeof ListHandoffsInputSchema>;
export type GetRunStateInput = z.infer<typeof GetRunStateInputSchema>;
export type RunState = unknown;

export interface HandoffToolHandlers {
  writeHandoff(input: WriteHandoffInput): Promise<Handoff>;
  latestHandoff(input: LatestHandoffInput): Promise<Handoff | null>;
  readHandoff(input: ReadHandoffInput): Promise<Handoff>;
  listHandoffs(input: ListHandoffsInput): Promise<Handoff[]>;
  getRunState(input: GetRunStateInput): Promise<RunState | null>;
}

export interface HandoffToolHandlerOptions {
  runsDir?: string;
  storeFactory?: (options: { runDir: string; runId: string }) => HandoffStore;
}

export function createHandoffToolHandlers(options: HandoffToolHandlerOptions = {}): HandoffToolHandlers {
  const runsDir = path.resolve(options.runsDir ?? process.env.AC_RUNS_DIR ?? ".ac/runs");
  const storeFactory = options.storeFactory ?? createHandoffStore;

  const storeFor = (run: string): HandoffStore => {
    const safeRun = parseRunId(run);
    return storeFactory({ runDir: path.join(runsDir, safeRun), runId: safeRun });
  };

  const runDirFor = (run: string): string => path.join(runsDir, parseRunId(run));

  return {
    async writeHandoff(input) {
      const parsed = WriteHandoffInputSchema.parse(input);
      return storeFor(parsed.run).write(parsed.handoff as HandoffWriteInput);
    },

    async latestHandoff(input) {
      const parsed = LatestHandoffInputSchema.parse(input);
      return (await storeFor(parsed.run).latestFor(parsed.role)) ?? null;
    },

    async readHandoff(input) {
      const parsed = ReadHandoffInputSchema.parse(input);
      return storeFor(parsed.run).read(parsed.seq);
    },

    async listHandoffs(input) {
      const parsed = ListHandoffsInputSchema.parse(input);
      return storeFor(parsed.run).list();
    },

    async getRunState(input) {
      const parsed = GetRunStateInputSchema.parse(input);
      return readJsonIfPresent(path.join(runDirFor(parsed.run), "state.json"));
    },
  };
}

export interface AcMcpServerOptions extends HandoffToolHandlerOptions {
  handlers?: HandoffToolHandlers;
}

export function createAcMcpServer(options: AcMcpServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO);
  const handlers = options.handlers ?? createHandoffToolHandlers(options);

  registerHandoffTools(server, handlers);

  return server;
}

export function registerHandoffTools(server: McpServer, handlers: HandoffToolHandlers): void {
  server.registerTool(
    "write_handoff",
    {
      description: "Validate and persist a new handoff for a run.",
      inputSchema: WriteHandoffInputSchema,
    },
    async (input) => toToolResult(await handlers.writeHandoff(input)),
  );

  server.registerTool(
    "latest_handoff",
    {
      description: "Read the latest handoff addressed to a role.",
      inputSchema: LatestHandoffInputSchema,
    },
    async (input) => toToolResult(await handlers.latestHandoff(input)),
  );

  server.registerTool(
    "read_handoff",
    {
      description: "Read one handoff by sequence number.",
      inputSchema: ReadHandoffInputSchema,
    },
    async (input) => toToolResult(await handlers.readHandoff(input)),
  );

  server.registerTool(
    "list_handoffs",
    {
      description: "List all handoffs in a run ordered by sequence.",
      inputSchema: ListHandoffsInputSchema,
    },
    async (input) => toToolResult(await handlers.listHandoffs(input)),
  );

  server.registerTool(
    "get_run_state",
    {
      description: "Read run state.json if present.",
      inputSchema: GetRunStateInputSchema,
    },
    async (input) => toToolResult(await handlers.getRunState(input)),
  );
}

export async function runStdioServer(): Promise<void> {
  const server = createAcMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function parseRunId(run: string): string {
  return RunIdSchema.parse(run);
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

function toToolResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: { result },
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  runStdioServer().catch((error: unknown) => {
    console.error("ac-handoffs MCP server failed:", error);
    process.exit(1);
  });
}
