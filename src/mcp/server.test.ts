/// <reference types="node" />

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { type Handoff } from "../handoff/schema.js";
import { type HandoffWriteInput } from "../handoff/store.js";
import { createAcMcpServer, createHandoffToolHandlers } from "./server.js";

const tempDirs: string[] = [];

async function makeTempRunsDir(): Promise<string> {
  const runsDir = await mkdtemp(path.join(os.tmpdir(), "ac-mcp-"));
  tempDirs.push(runsDir);

  return runsDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const planInput = (): HandoffWriteInput => ({
  ts: "2026-06-03T09:40:00Z",
  from: { agent: "claude", role: "tech-lead" },
  to: { agent: "codex", role: "lead-dev" },
  phase: "plan",
  task: "Add request-id middleware to the API",
  status: "in-progress",
  confidence: 0.8,
  branch: "ac/20260603-axum-mw",
  commits: [],
  files_touched: [],
  decisions: ["Generate a UUIDv4 per request."],
  open_questions: [],
  next_actions: ["Add middleware in src/middleware/request_id.ts."],
  body: {
    summary: "Small, self-contained task.",
  },
});

const implementInput = (): HandoffWriteInput => ({
  ts: "2026-06-03T09:48:00Z",
  from: { agent: "codex", role: "lead-dev" },
  to: { agent: "claude", role: "tech-lead" },
  phase: "implement",
  task: "Add request-id middleware to the API",
  status: "in-progress",
  confidence: 0.7,
  branch: "ac/20260603-axum-mw",
  commits: ["a1b2c3d"],
  files_touched: ["src/middleware/request_id.ts"],
  decisions: ["Used crypto.randomUUID()."],
  open_questions: [],
  next_actions: ["Review src/middleware/request_id.ts."],
  body: {
    summary: "Implemented per the plan.",
  },
});

const reviewInput = (): HandoffWriteInput => ({
  ts: "2026-06-03T09:53:00Z",
  from: { agent: "claude", role: "tech-lead" },
  to: { agent: "codex", role: "lead-dev" },
  phase: "review",
  task: "Add request-id middleware to the API",
  status: "changes-requested",
  confidence: 0.76,
  branch: "ac/20260603-axum-mw",
  commits: [],
  files_touched: [],
  decisions: ["Implementation needs one more test."],
  open_questions: [],
  next_actions: ["Add client-supplied id coverage."],
  body: {
    summary: "Review found one missing test.",
    review: "test/request_id.test.ts - add client-supplied id coverage.",
  },
});

describe("ac-handoffs MCP handlers", () => {
  it("writes, reads, lists, and returns latest handoffs", async () => {
    const runsDir = await makeTempRunsDir();
    const handlers = createHandoffToolHandlers({ runsDir });

    const plan = await handlers.writeHandoff({ run: "run-a", handoff: planInput() });
    const implement = await handlers.writeHandoff({ run: "run-a", handoff: implementInput() });
    const review = await handlers.writeHandoff({ run: "run-a", handoff: reviewInput() });

    expect(plan.seq).toBe(1);
    expect(implement.seq).toBe(2);
    expect(review.seq).toBe(3);
    await expect(handlers.readHandoff({ run: "run-a", seq: 2 })).resolves.toEqual(implement);
    await expect(handlers.listHandoffs({ run: "run-a" })).resolves.toEqual([plan, implement, review]);
    await expect(handlers.latestHandoff({ run: "run-a", role: "lead-dev" })).resolves.toEqual(review);
    await expect(handlers.latestHandoff({ run: "run-a", role: "tech-lead" })).resolves.toEqual(implement);
    await expect(handlers.latestHandoff({ run: "run-a", role: "human" })).resolves.toBeNull();
  });

  it("rejects invalid writes and writes nothing", async () => {
    const runsDir = await makeTempRunsDir();
    const handlers = createHandoffToolHandlers({ runsDir });
    const invalid = planInput();
    invalid.next_actions = [];

    await expect(handlers.writeHandoff({ run: "run-a", handoff: invalid })).rejects.toBeInstanceOf(ZodError);
    await expect(readdir(path.join(runsDir, "run-a"))).rejects.toThrow();
  });

  it("rejects unsafe run ids", async () => {
    const runsDir = await makeTempRunsDir();
    const handlers = createHandoffToolHandlers({ runsDir });

    await expect(handlers.listHandoffs({ run: "../outside" })).rejects.toThrow();
    await expect(handlers.listHandoffs({ run: "nested/run" })).rejects.toThrow();
    await expect(handlers.listHandoffs({ run: String.raw`nested\run` })).rejects.toThrow();
  });

  it("returns null for absent run state and parsed JSON when present", async () => {
    const runsDir = await makeTempRunsDir();
    const handlers = createHandoffToolHandlers({ runsDir });
    const runDir = path.join(runsDir, "run-a");
    const state = { phase: "plan", turn: 1, caps: { max_rounds: 5 } };

    await expect(handlers.getRunState({ run: "run-a" })).resolves.toBeNull();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "state.json"), JSON.stringify(state), "utf8");
    await expect(handlers.getRunState({ run: "run-a" })).resolves.toEqual(state);
  });
});

describe("ac-handoffs MCP server", () => {
  it("exposes tools over an in-memory MCP transport", async () => {
    const runsDir = await makeTempRunsDir();
    const server = createAcMcpServer({ runsDir });
    const client = new Client({ name: "ac-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "write_handoff" }),
          expect.objectContaining({ name: "latest_handoff" }),
          expect.objectContaining({ name: "read_handoff" }),
          expect.objectContaining({ name: "list_handoffs" }),
          expect.objectContaining({ name: "get_run_state" }),
        ]),
      });

      const writeResult = await client.callTool({
        name: "write_handoff",
        arguments: { run: "run-a", handoff: planInput() },
      });
      const written = readStructuredResult(writeResult) as Handoff;
      expect(written.id).toBe("run-a-0001");

      const latestResult = await client.callTool({
        name: "latest_handoff",
        arguments: { run: "run-a", role: "lead-dev" },
      });
      expect(readStructuredResult(latestResult)).toEqual(written);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function readStructuredResult(result: unknown): unknown {
  if (
    typeof result === "object" &&
    result !== null &&
    "structuredContent" in result &&
    typeof result.structuredContent === "object" &&
    result.structuredContent !== null &&
    "result" in result.structuredContent
  ) {
    return result.structuredContent.result;
  }

  throw new Error(`missing structured result: ${JSON.stringify(result)}`);
}
