/// <reference types="node" />

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import { HandoffSchema, type Handoff, type HandoffBody, type Role } from "./schema.js";

export type HandoffWriteInput = Omit<Handoff, "id" | "run" | "seq">;

export interface HandoffStoreOptions {
  runDir: string;
  runId: string;
}

export interface HandoffStore {
  list(): Promise<Handoff[]>;
  read(seq: number): Promise<Handoff>;
  latestFor(role: Role): Promise<Handoff | undefined>;
  write(input: HandoffWriteInput): Promise<Handoff>;
}

const HANDOFF_FILE_PATTERN = /^(\d+)-.+-.+\.md$/;

export function createHandoffStore(options: HandoffStoreOptions): HandoffStore {
  return new FileHandoffStore(options.runDir, options.runId);
}

class FileHandoffStore implements HandoffStore {
  constructor(
    private readonly runDir: string,
    private readonly runId: string,
  ) {}

  async list(): Promise<Handoff[]> {
    const filenames = await this.listHandoffFilenames();
    const handoffs = await Promise.all(filenames.map((filename) => this.readFileByName(filename)));

    return handoffs.toSorted((left, right) => left.seq - right.seq);
  }

  async read(seq: number): Promise<Handoff> {
    const prefix = `${padSeq(seq)}-`;
    const filenames = (await this.listHandoffFilenames()).filter((filename) => filename.startsWith(prefix));

    if (filenames.length === 0) {
      throw new Error(`handoff ${seq} not found`);
    }

    if (filenames.length > 1) {
      throw new Error(`multiple handoffs found for seq ${seq}`);
    }

    const filename = filenames[0];
    if (filename === undefined) {
      throw new Error(`handoff ${seq} not found`);
    }

    return this.readFileByName(filename);
  }

  async latestFor(role: Role): Promise<Handoff | undefined> {
    const handoffs = await this.list();

    for (let index = handoffs.length - 1; index >= 0; index -= 1) {
      const handoff = handoffs[index];
      if (handoff?.to.role === role) {
        return handoff;
      }
    }

    return undefined;
  }

  async write(input: HandoffWriteInput): Promise<Handoff> {
    const seq = (await this.nextSeq());
    const handoff = HandoffSchema.parse({
      ...input,
      id: `${this.runId}-${padSeq(seq)}`,
      run: this.runId,
      seq,
    });
    const filename = handoffFileName(handoff);
    const filePath = path.join(this.runDir, filename);

    await mkdir(this.runDir, { recursive: true });
    await writeFile(filePath, serializeHandoff(handoff), { encoding: "utf8", flag: "wx" });

    return handoff;
  }

  private async nextSeq(): Promise<number> {
    const handoffs = await this.list();
    const latest = handoffs.at(-1);

    return latest === undefined ? 1 : latest.seq + 1;
  }

  private async listHandoffFilenames(): Promise<string[]> {
    let filenames: string[];

    try {
      filenames = await readdir(this.runDir);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    return filenames.filter((filename) => HANDOFF_FILE_PATTERN.test(filename));
  }

  private async readFileByName(filename: string): Promise<Handoff> {
    const filePath = path.join(this.runDir, filename);
    const raw = await readFile(filePath, "utf8");
    const parsed = matter(raw);
    const handoff = HandoffSchema.parse({
      ...asFrontmatter(parsed.data),
      body: parseBody(parsed.content),
    });
    const expectedFilename = handoffFileName(handoff);

    if (filename !== expectedFilename) {
      throw new Error(`handoff filename ${filename} does not match ${expectedFilename}`);
    }

    return handoff;
  }
}

export function serializeHandoff(handoff: Handoff): string {
  const { body, ...frontmatter } = handoff;

  return matter.stringify(serializeBody(body), frontmatter);
}

function parseBody(content: string): HandoffBody {
  const sections: Partial<Record<BodySectionName, string>> = {};
  const matches = [...content.matchAll(/^## (Summary|Details|Review)\s*$/gm)];
  const firstMatch = matches[0];

  if (firstMatch !== undefined && content.slice(0, firstMatch.index).trim().length > 0) {
    throw new Error("unexpected content before first handoff body section");
  }

  for (const [index, match] of matches.entries()) {
    const title = parseSectionName(match[1]);
    const start = match.index + match[0].length;
    const next = matches[index + 1];
    const end = next === undefined ? content.length : next.index;

    sections[title] = trimSectionContent(content.slice(start, end));
  }

  return {
    summary: sections.Summary ?? "",
    ...(sections.Details === undefined ? {} : { details: sections.Details }),
    ...(sections.Review === undefined ? {} : { review: sections.Review }),
  };
}

function serializeBody(body: HandoffBody): string {
  const sections = [`## Summary\n${body.summary.trimEnd()}`];

  if (body.details !== undefined) {
    sections.push(`## Details\n${body.details.trimEnd()}`);
  }

  if (body.review !== undefined) {
    sections.push(`## Review\n${body.review.trimEnd()}`);
  }

  return `${sections.join("\n\n")}\n`;
}

function handoffFileName(handoff: Handoff): string {
  return `${padSeq(handoff.seq)}-${handoff.from.role}-${handoff.phase}.md`;
}

function padSeq(seq: number): string {
  return String(seq).padStart(4, "0");
}

type BodySectionName = "Summary" | "Details" | "Review";

function parseSectionName(value: string | undefined): BodySectionName {
  if (value === "Summary" || value === "Details" || value === "Review") {
    return value;
  }

  throw new Error(`unknown handoff body section ${String(value)}`);
}

function trimSectionContent(content: string): string {
  return content.replace(/^\r?\n/, "").trimEnd();
}

function asFrontmatter(data: { [key: string]: unknown }): Record<string, unknown> {
  return data;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
