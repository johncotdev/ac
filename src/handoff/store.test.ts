/// <reference types="node" />

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { createHandoffStore, type HandoffWriteInput } from "./store.js";

const tempDirs: string[] = [];

async function makeTempRunDir(): Promise<string> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "ac-store-"));
  tempDirs.push(runDir);

  return runDir;
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
    details: "Use crypto.randomUUID().",
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
  files_touched: ["src/middleware/request_id.ts", "src/app.ts", "test/request_id.test.ts"],
  decisions: ["Used crypto.randomUUID() (no new dependency)."],
  open_questions: ["Logging is out of scope."],
  next_actions: ["Review src/middleware/request_id.ts and test/request_id.test.ts."],
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

describe("HandoffStore", () => {
  it("assigns increasing seq values and zero-padded filenames", async () => {
    const runDir = await makeTempRunDir();
    const store = createHandoffStore({ runDir, runId: "store-test" });

    const first = await store.write(planInput());
    const second = await store.write(implementInput());

    expect(first.seq).toBe(1);
    expect(first.id).toBe("store-test-0001");
    expect(first.run).toBe("store-test");
    expect(second.seq).toBe(2);
    expect(second.id).toBe("store-test-0002");
    expect(second.run).toBe("store-test");
    await expect(readdir(runDir).then((filenames) => filenames.toSorted())).resolves.toEqual([
      "0001-tech-lead-plan.md",
      "0002-lead-dev-implement.md",
    ]);
  });

  it("round-trips written handoffs through markdown", async () => {
    const runDir = await makeTempRunDir();
    const store = createHandoffStore({ runDir, runId: "store-test" });

    const written = await store.write(planInput());
    const read = await store.read(written.seq);

    expect(read).toEqual(written);
  });

  it("lists all handoffs ordered by seq", async () => {
    const runDir = await makeTempRunDir();
    const store = createHandoffStore({ runDir, runId: "store-test" });

    const first = await store.write(planInput());
    const second = await store.write(implementInput());

    await expect(store.list()).resolves.toEqual([first, second]);
  });

  it("returns the latest handoff addressed to a role", async () => {
    const runDir = await makeTempRunDir();
    const store = createHandoffStore({ runDir, runId: "store-test" });
    const firstToLeadDev = await store.write(planInput());
    await store.write(implementInput());
    const secondToLeadDev = await store.write(reviewInput());

    expect(await store.latestFor("lead-dev")).toEqual(secondToLeadDev);
    expect(await store.latestFor("tech-lead")).toEqual(await store.read(2));
    expect(firstToLeadDev.seq).toBe(1);
    await expect(store.latestFor("human")).resolves.toBeUndefined();
  });

  it("rejects invalid handoffs and writes nothing", async () => {
    const runDir = await makeTempRunDir();
    const store = createHandoffStore({ runDir, runId: "store-test" });
    const invalid = planInput();
    invalid.next_actions = [];

    await expect(store.write(invalid)).rejects.toBeInstanceOf(ZodError);
    await expect(readdir(runDir)).resolves.toEqual([]);
  });

  it("never overwrites an existing handoff file", async () => {
    const runDir = await makeTempRunDir();
    const existingFile = path.join(runDir, "0001-tech-lead-plan.md");
    await writeFile(existingFile, "already here", "utf8");
    const store = createHandoffStore({ runDir, runId: "store-test" });

    await expect(store.write(planInput())).rejects.toThrow();
    await expect(readFile(existingFile, "utf8")).resolves.toBe("already here");
  });
});
