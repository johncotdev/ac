/// <reference types="node" />

import { mkdir, readFile, watch } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

import { RoleSchema, type Handoff, type Role } from "../handoff/schema.js";
import { createHandoffStore, parseHandoffDocument } from "../handoff/store.js";
import { initialState, writeState, type RunCaps, type RunState } from "../coordinator/state.js";

const RunIdSchema = z
  .string()
  .min(1)
  .refine((run) => run !== "." && !run.includes(".."), "run must not contain path traversal segments")
  .refine((run) => !/[\\/]/.test(run), "run must not contain path separators");

export interface CliContext {
  env?: Record<string, string | undefined>;
  stdin?: AsyncIterable<Buffer | Uint8Array | string> | Iterable<Buffer | Uint8Array | string>;
  signal?: AbortSignal;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
}

export interface InitCommandOptions {
  run: string;
  goal: string;
  branch?: string;
  runsDir?: string;
  caps?: Partial<RunCaps>;
}

export interface LatestCommandOptions {
  run: string;
  role: Role;
  runsDir?: string;
}

export interface WriteCommandOptions {
  run: string;
  file?: string;
  runsDir?: string;
}

export interface WatchCommandOptions {
  run: string;
  runsDir?: string;
}

export async function initCommand(options: InitCommandOptions, context: CliContext = {}): Promise<RunState> {
  const run = parseRunId(options.run);
  const runDir = resolveRunDir(run, options.runsDir, context.env);
  const state = initialState({
    run,
    goal: options.goal,
    ...(options.branch === undefined ? {} : { branch: options.branch }),
    ...(options.caps === undefined ? {} : { caps: options.caps }),
  });

  await writeState(runDir, state);
  writeLine(context, `initialized ${run} at ${runDir}`);
  writeLine(context, `branch: ${state.branch}`);

  return state;
}

export async function latestCommand(
  options: LatestCommandOptions,
  context: CliContext = {},
): Promise<Handoff | undefined> {
  const run = parseRunId(options.run);
  const store = createHandoffStore({ runDir: resolveRunDir(run, options.runsDir, context.env), runId: run });
  const handoff = await store.latestFor(options.role);

  if (handoff === undefined) {
    writeLine(context, `no handoff found for role ${options.role} in run ${run}`);
    return undefined;
  }

  writeLine(context, JSON.stringify(handoff, null, 2));
  return handoff;
}

export async function writeCommand(options: WriteCommandOptions, context: CliContext = {}): Promise<Handoff> {
  const run = parseRunId(options.run);
  const raw = options.file === undefined ? await readStdin(context.stdin) : await readFile(options.file, "utf8");
  const input = parseHandoffDocument(raw);
  const store = createHandoffStore({ runDir: resolveRunDir(run, options.runsDir, context.env), runId: run });
  const handoff = await store.write(input);

  writeLine(context, `wrote ${handoff.id} seq=${handoff.seq}`);
  return handoff;
}

export async function watchCommand(options: WatchCommandOptions, context: CliContext = {}): Promise<void> {
  const run = parseRunId(options.run);
  const runDir = resolveRunDir(run, options.runsDir, context.env);
  const store = createHandoffStore({ runDir, runId: run });
  const seen = new Set<number>();

  await mkdir(runDir, { recursive: true });

  for (const handoff of await store.list()) {
    seen.add(handoff.seq);
    writeLine(context, summarizeHandoff(handoff));
  }

  try {
    for await (const event of watch(runDir, { signal: context.signal })) {
      const filename = typeof event.filename === "string" ? event.filename : undefined;
      const seq = parseHandoffSeq(filename);
      if (seq === undefined || seen.has(seq)) {
        continue;
      }

      const handoff = await store.read(seq);
      seen.add(handoff.seq);
      writeLine(context, summarizeHandoff(handoff));
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    throw error;
  }
}

export async function main(argv = process.argv.slice(2), context: CliContext = {}): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "init": {
      const parsed = parseArgs({
        args,
        allowPositionals: true,
        options: {
          goal: { type: "string" },
          branch: { type: "string" },
          "runs-dir": { type: "string" },
        },
      });
      const run = parsed.positionals[0];
      const goal = readRequiredString(parsed.values.goal, "--goal");

      if (run === undefined) {
        throw new Error("usage: ac init <run-id> --goal <text> [--branch <b>] [--runs-dir <d>]");
      }

      await initCommand(
        {
          run,
          goal,
          ...(typeof parsed.values.branch === "string" ? { branch: parsed.values.branch } : {}),
          ...(typeof parsed.values["runs-dir"] === "string" ? { runsDir: parsed.values["runs-dir"] } : {}),
        },
        context,
      );
      return;
    }

    case "latest": {
      const parsed = parseArgs({
        args,
        options: {
          run: { type: "string" },
          role: { type: "string" },
          "runs-dir": { type: "string" },
        },
      });
      await latestCommand(
        {
          run: readRequiredString(parsed.values.run, "--run"),
          role: RoleSchema.parse(readRequiredString(parsed.values.role, "--role")),
          ...(typeof parsed.values["runs-dir"] === "string" ? { runsDir: parsed.values["runs-dir"] } : {}),
        },
        context,
      );
      return;
    }

    case "write": {
      const parsed = parseArgs({
        args,
        options: {
          run: { type: "string" },
          file: { type: "string" },
          "runs-dir": { type: "string" },
        },
      });
      await writeCommand(
        {
          run: readRequiredString(parsed.values.run, "--run"),
          ...(typeof parsed.values.file === "string" ? { file: parsed.values.file } : {}),
          ...(typeof parsed.values["runs-dir"] === "string" ? { runsDir: parsed.values["runs-dir"] } : {}),
        },
        context,
      );
      return;
    }

    case "watch": {
      const parsed = parseArgs({
        args,
        options: {
          run: { type: "string" },
          "runs-dir": { type: "string" },
        },
      });
      await watchCommand(
        {
          run: readRequiredString(parsed.values.run, "--run"),
          ...(typeof parsed.values["runs-dir"] === "string" ? { runsDir: parsed.values["runs-dir"] } : {}),
        },
        context,
      );
      return;
    }

    default:
      throw new Error("usage: ac <init|latest|write|watch> ...");
  }
}

function resolveRunDir(run: string, runsDir?: string, env: Record<string, string | undefined> = process.env): string {
  return path.join(path.resolve(runsDir ?? env.AC_RUNS_DIR ?? ".ac/runs"), parseRunId(run));
}

function parseRunId(run: string): string {
  return RunIdSchema.parse(run);
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`${label} is required`);
}

async function readStdin(stdin: CliContext["stdin"] = process.stdin): Promise<string> {
  let raw = "";

  for await (const chunk of stdin) {
    raw += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }

  return raw;
}

function summarizeHandoff(handoff: Handoff): string {
  return `${handoff.seq}\t${handoff.from.role}->${handoff.to.role}\t${handoff.phase}/${handoff.status}\t${handoff.task}`;
}

function parseHandoffSeq(filename: string | undefined): number | undefined {
  const match = filename?.match(/^(\d+)-.+-.+\.md$/);
  const rawSeq = match?.[1];

  return rawSeq === undefined ? undefined : Number.parseInt(rawSeq, 10);
}

function writeLine(context: CliContext, line: string): void {
  const write = context.writeStdout ?? ((text: string) => process.stdout.write(text));
  write(`${line}\n`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
