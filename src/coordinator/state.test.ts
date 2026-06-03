/// <reference types="node" />

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CAPS, initialState, readState, writeState } from "./state.js";

const tempDirs: string[] = [];

async function makeTempRunDir(): Promise<string> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "ac-state-"));
  tempDirs.push(runDir);

  return runDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RunState", () => {
  it("builds initial state with default branch, caps, and next phase", () => {
    expect(
      initialState({
        run: "run-a",
        goal: "Build the spine",
        createdTs: "2026-06-03T09:40:00Z",
      }),
    ).toEqual({
      run: "run-a",
      goal: "Build the spine",
      branch: "ac/run-a",
      phase: "plan",
      turn: 0,
      caps: DEFAULT_CAPS,
      created_ts: "2026-06-03T09:40:00Z",
    });
  });

  it("round-trips state.json", async () => {
    const runDir = await makeTempRunDir();
    const state = initialState({
      run: "run-a",
      goal: "Build the spine",
      branch: "bootstrap/p0-spine",
      caps: { max_rounds: 3, max_cost_usd: 2.5 },
      createdTs: "2026-06-03T09:40:00Z",
    });

    await expect(readState(runDir)).resolves.toBeNull();
    await writeState(runDir, state);
    await expect(readState(runDir)).resolves.toEqual(state);
  });
});
