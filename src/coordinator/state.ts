/// <reference types="node" />

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const DEFAULT_CAPS = {
  max_rounds: 8,
  max_wall_clock_s: 3600,
} as const;

export const RunCapsSchema = z.strictObject({
  max_rounds: z.number().int().positive(),
  max_wall_clock_s: z.number().int().positive(),
  max_cost_usd: z.number().positive().optional(),
});

export const RunStatePhaseSchema = z.enum([
  "init",
  "plan",
  "implement",
  "review",
  "revise",
  "blocked",
  "done",
  "aborted",
]);

export const RunStateSchema = z.strictObject({
  run: z.string().min(1),
  goal: z.string().min(1),
  branch: z.string().min(1),
  phase: RunStatePhaseSchema,
  turn: z.number().int().nonnegative(),
  caps: RunCapsSchema,
  created_ts: z.iso.datetime(),
});

export type RunCaps = z.infer<typeof RunCapsSchema>;
export type RunStatePhase = z.infer<typeof RunStatePhaseSchema>;
export type RunState = z.infer<typeof RunStateSchema>;

export interface InitialStateInput {
  run: string;
  goal: string;
  branch?: string;
  caps?: Partial<RunCaps>;
  createdTs?: string;
}

export function initialState(input: InitialStateInput): RunState {
  return RunStateSchema.parse({
    run: input.run,
    goal: input.goal,
    branch: input.branch ?? `ac/${input.run}`,
    phase: "plan",
    turn: 0,
    caps: {
      ...DEFAULT_CAPS,
      ...(input.caps?.max_cost_usd === undefined ? {} : { max_cost_usd: input.caps.max_cost_usd }),
      ...(input.caps?.max_rounds === undefined ? {} : { max_rounds: input.caps.max_rounds }),
      ...(input.caps?.max_wall_clock_s === undefined
        ? {}
        : { max_wall_clock_s: input.caps.max_wall_clock_s }),
    },
    created_ts: input.createdTs ?? new Date().toISOString(),
  });
}

export async function readState(runDir: string): Promise<RunState | null> {
  try {
    const raw = await readFile(statePath(runDir), "utf8");
    return RunStateSchema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeState(runDir: string, state: RunState): Promise<void> {
  const parsed = RunStateSchema.parse(state);
  await mkdir(runDir, { recursive: true });
  await writeFile(statePath(runDir), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function statePath(runDir: string): string {
  return path.join(runDir, "state.json");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
