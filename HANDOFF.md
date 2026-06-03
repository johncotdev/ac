# ac — build handoff (start here)

> You're starting fresh in `C:\Dev\ac`. This repo is **design-complete, code-empty**. Read
> this top to bottom, then `docs/DESIGN.md` (architecture) and `docs/handoff-schema.md`
> (the contract). `CLAUDE.md` has the short version + conventions.

## What you're building

`ac` (agentic coding) — a TypeScript framework that runs an autonomous two-agent dev loop:
**Codex (GPT‑5.5)** = Lead Developer, **Claude** = Tech Lead, exchanging structured
**handoffs**. Part of cot.industries. Full rationale in `docs/DESIGN.md`.

## Decisions already locked (don't relitigate)

- **Stack:** TypeScript / Node ≥ 20, ESM, strict. `tsx` to run, `vitest` to test, `zod` for schema.
- **Spine:** artifact-based handoffs over an **MCP server** (`ac-handoffs`).
- **Autonomy target:** *fully autonomous*, but made safe by isolation + caps (that's the P2 coordinator; see DESIGN §5). Build toward it; don't build it yet.
- **First milestone:** the **spine, proven by hand** (P0). Cockpit and full automation come later.

## Your milestone: P0 — the handoff spine

Goal: stand up the schema + store + MCP server, wire both agents to it, and run a
**manual** PLAN→IMPLEMENT→REVIEW loop on a throwaway task to confirm the schema and the
role prompts feel right *before* any automation. Concretely, in order:

1. **Install deps & confirm the toolchain.** (Verify current versions — names/APIs evolve.)
   ```
   npm install zod @modelcontextprotocol/sdk gray-matter
   npm install -D typescript tsx vitest @types/node
   npm run typecheck        # should pass on an empty src (add a placeholder if needed)
   ```
2. **`src/handoff/schema.ts`** — a `zod` schema + inferred TS types mirroring
   `docs/handoff-schema.md` exactly, including the invariants (only tech-lead may emit
   `done`/`approved`; `blocked` ⇒ `to.role: human`; `next_actions` non-empty unless `done`).
3. **`src/handoff/store.ts`** — given a run dir: `list`, `read(seq)`, `latestFor(role)`,
   and `write(handoff)` which validates, assigns the next `seq`, and writes
   `NNNN-<role>-<phase>.md` (frontmatter via `gray-matter`). Files are **immutable** once
   written. Unit-test seq assignment, `latestFor`, and validation rejection.
4. **`src/mcp/server.ts`** — the `ac-handoffs` MCP server (stdio transport) exposing
   `latest_handoff`, `read_handoff`, `list_handoffs`, `write_handoff`, `get_run_state` over
   `store.ts`. `npm run mcp` launches it.
5. **`src/cli/index.ts`** — minimal: `ac init <run-id>` (create run dir + `state.json` +
   seed the goal), plus `ac latest` / `ac write` / `ac watch` (tail the run dir) so you can
   drive and observe a loop by hand.
6. **Wire the agents to the MCP server.** Add `ac-handoffs` to Claude Code's MCP config and
   to Codex's MCP-client config, both launching `npm run mcp`. Inject the role prompts:
   `prompts/tech-lead.md` for Claude, `prompts/lead-dev.md` for Codex, plus
   `prompts/protocol.md` for both. **This is the riskiest step — verify each tool's current
   MCP-config + headless-invocation mechanism against its docs.**
7. **Manual smoke loop.** Pick a trivial task in a *throwaway target repo*. Relay by hand:
   Claude writes a PLAN handoff → you feed it to Codex → Codex IMPLEMENTs + writes a handoff
   → back to Claude for REVIEW → DONE. Confirm every handoff validates and reads cleanly.
8. **Capture learnings.** Note any schema/prompt friction; adjust `docs/handoff-schema.md` +
   `prompts/` (they're living specs). That feedback *is* the deliverable of P0.

**Definition of done (P0):** schema + store + MCP server build, typecheck, and have passing
tests; both agents can `write`/`latest` against a run dir; a hand-run 3-step loop yields
valid, readable handoffs; schema/prompts updated with what you learned.

**Then P1:** agent adapters (`src/agents/{claude,codex}.ts`) that invoke each agent headless
and capture the handoff — human still triggers each turn. (P2 = autonomous coordinator;
P3 = cockpit. See DESIGN §8.) Don't get ahead of P0.

## Conventions

- ESM + `NodeNext`: **import paths need explicit `.js` extensions** in TS source (common gotcha).
- `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on — write types accordingly.
- `zod` validates everything that crosses a boundary (MCP input, files on disk).
- Small modules; comments explain *why*. Match the design docs' tone.
- Keep the framework (this repo) separate from any **target repo** it operates on (DESIGN §6).

## Safety (relevant even in P0)

- `ac` operates on a **target repo** via an isolated git worktree on branch `ac/<run-id>` —
  never `main`, never a remote push. The worktree/caps/kill-switch machinery is P2, but
  encode the assumption now (e.g. the run config carries the branch + caps fields).

## Gotchas

- **Windows host.** The author is on Windows 11. Node/npm/tsx/MCP-over-stdio are fine
  cross-platform. Verify **Codex on Windows** (it may want WSL); Claude Code runs natively.
  PTY/worktree concerns are P2.
- **Verify SDK/CLI specifics at build time.** `@modelcontextprotocol/sdk` is the MCP SDK.
  The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, for P1) and Codex's `exec`/MCP
  config evolve — confirm names, flags, and config-file locations against current docs
  rather than trusting any snippet here.
- **Fresh repo, no commits yet.** Make the initial commit once the spine runs end-to-end —
  and only when the user asks to commit. Default branch is `main`.

## Map of what's here

| Path | What |
|---|---|
| `README.md` | overview + the locked decisions |
| `docs/DESIGN.md` | architecture, the loop, the autonomy/safety model, `src/` layout, roadmap |
| `docs/handoff-schema.md` | the handoff contract + worked examples (→ `src/handoff/schema.ts`) |
| `prompts/protocol.md` | shared loop/handoff rules (both agents) |
| `prompts/tech-lead.md` | Claude's role prompt |
| `prompts/lead-dev.md` | Codex's role prompt |
| `package.json` / `tsconfig.json` | toolchain (scripts reference the `src/` files you'll create) |
