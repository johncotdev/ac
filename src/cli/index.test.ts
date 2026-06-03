/// <reference types="node" />

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type Handoff } from "../handoff/schema.js";
import { createHandoffStore, serializeHandoff } from "../handoff/store.js";
import { readState } from "../coordinator/state.js";
import { initCommand, latestCommand, main, watchCommand, writeCommand, type CliContext } from "./index.js";

const tempDirs: string[] = [];

async function makeTempRunsDir(): Promise<string> {
  const runsDir = await mkdtemp(path.join(os.tmpdir(), "ac-cli-"));
  tempDirs.push(runsDir);

  return runsDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const captureContext = (): CliContext & { output: string[] } => {
  const output: string[] = [];

  return {
    output,
    writeStdout: (text) => output.push(text),
  };
};

const sourceHandoff = (): Handoff => ({
  id: "source-run-0009",
  run: "source-run",
  seq: 9,
  ts: "2026-06-03T09:40:00Z",
  from: { agent: "claude", role: "tech-lead" },
  to: { agent: "codex", role: "lead-dev" },
  phase: "plan",
  task: "Add request-id middleware to the API",
  status: "in-progress",
  confidence: 0.8,
  branch: "bootstrap/p0-spine",
  commits: [],
  files_touched: [],
  decisions: ["Generate a UUIDv4 per request."],
  open_questions: [],
  next_actions: ["Add middleware in src/middleware/request_id.ts."],
  body: {
    summary: "Small, self-contained task.",
    details: "Use crypto.randomUUID().",
  },
});

describe("CLI commands", () => {
  it("init creates a run directory and valid state.json", async () => {
    const runsDir = await makeTempRunsDir();
    const context = captureContext();

    const state = await initCommand(
      { run: "run-a", goal: "Build the spine", branch: "bootstrap/p0-spine", runsDir },
      context,
    );

    await expect(readState(path.join(runsDir, "run-a"))).resolves.toEqual(state);
    expect(context.output.join("")).toContain("initialized run-a");
  });

  it("main dispatches init through parseArgs", async () => {
    const runsDir = await makeTempRunsDir();
    const context = captureContext();

    await main(["init", "run-a", "--goal", "Build the spine", "--runs-dir", runsDir], context);

    await expect(readState(path.join(runsDir, "run-a"))).resolves.toMatchObject({
      run: "run-a",
      goal: "Build the spine",
      branch: "ac/run-a",
      phase: "plan",
    });
  });

  it("write parses a handoff document and persists with store-assigned seq and id", async () => {
    const runsDir = await makeTempRunsDir();
    const handoffPath = path.join(runsDir, "source.md");
    const context = captureContext();

    await writeFile(handoffPath, serializeHandoff(sourceHandoff()), "utf8");

    const written = await writeCommand({ run: "run-a", file: handoffPath, runsDir }, context);
    const store = createHandoffStore({ runDir: path.join(runsDir, "run-a"), runId: "run-a" });

    expect(written.id).toBe("run-a-0001");
    expect(written.run).toBe("run-a");
    expect(written.seq).toBe(1);
    expect(written.body).toEqual(sourceHandoff().body);
    await expect(store.read(1)).resolves.toEqual(written);
    expect(context.output.join("")).toContain("wrote run-a-0001 seq=1");
  });

  it("write reads handoff documents from stdin when no file is provided", async () => {
    const runsDir = await makeTempRunsDir();
    const document = serializeHandoff(sourceHandoff());
    const context: CliContext = {
      stdin: [document],
      writeStdout: () => undefined,
    };

    await expect(writeCommand({ run: "run-a", runsDir }, context)).resolves.toMatchObject({
      id: "run-a-0001",
      seq: 1,
    });
  });

  it("write accepts hand-authored YAML timestamps", async () => {
    const runsDir = await makeTempRunsDir();
    const context: CliContext = {
      stdin: [
        `---
id: source-run-0009
run: source-run
seq: 9
ts: 2026-06-03T09:40:00Z
from: { agent: claude, role: tech-lead }
to:   { agent: codex,  role: lead-dev }
phase: plan
task: "Add request-id middleware to the API"
status: in-progress
confidence: 0.8
branch: bootstrap/p0-spine
commits: []
files_touched: []
decisions:
  - "Generate a UUIDv4 per request."
open_questions: []
next_actions:
  - "Add middleware in src/middleware/request_id.ts."
---

## Summary
Small, self-contained task.
`,
      ],
      writeStdout: () => undefined,
    };

    await expect(writeCommand({ run: "run-a", runsDir }, context)).resolves.toMatchObject({
      id: "run-a-0001",
      ts: "2026-06-03T09:40:00.000Z",
    });
  });

  it("latest prints and returns the latest handoff for a role", async () => {
    const runsDir = await makeTempRunsDir();
    const context = captureContext();
    const store = createHandoffStore({ runDir: path.join(runsDir, "run-a"), runId: "run-a" });
    const { id: _id, run: _run, seq: _seq, ...writeInput } = sourceHandoff();
    void _id;
    void _run;
    void _seq;
    const written = await store.write(writeInput);

    await expect(latestCommand({ run: "run-a", role: "lead-dev", runsDir }, context)).resolves.toEqual(written);

    const printed = JSON.parse(context.output.join("")) as unknown;
    expect(printed).toEqual(written);
  });

  it("latest returns undefined with a clean message when no handoff exists for a role", async () => {
    const runsDir = await makeTempRunsDir();
    const context = captureContext();

    await expect(latestCommand({ run: "run-a", role: "human", runsDir }, context)).resolves.toBeUndefined();
    expect(context.output.join("")).toContain("no handoff found for role human in run run-a");
  });

  it("watch prints existing handoffs and stops on abort", async () => {
    const runsDir = await makeTempRunsDir();
    const context = captureContext();
    const controller = new AbortController();
    const store = createHandoffStore({ runDir: path.join(runsDir, "run-a"), runId: "run-a" });
    const { id: _id, run: _run, seq: _seq, ...writeInput } = sourceHandoff();
    void _id;
    void _run;
    void _seq;
    await store.write(writeInput);

    const watching = watchCommand({ run: "run-a", runsDir }, { ...context, signal: controller.signal });

    await vi.waitFor(() => {
      expect(context.output.join("")).toContain("1\ttech-lead->lead-dev\tplan/in-progress");
    });
    controller.abort();
    await expect(watching).resolves.toBeUndefined();
  });
});
