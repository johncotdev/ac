# ac — design

> Read `README.md` for the elevator pitch and `docs/handoff-schema.md` for the handoff
> contract. This document is the architecture and the autonomy/safety model.

## 1. Purpose & principles

`ac` automates a development loop that the author already runs by hand: **Codex (GPT‑5.5)**
as Lead Developer and **Claude** as Tech Lead, repeatedly summarizing their work to each
other. `ac` makes that loop durable, auditable, and unattended.

Principles:

1. **The protocol is the product.** The value is the *handoff* — a small, high-signal
   summary that carries exactly the context the next agent needs. Everything else (UI,
   automation) is replaceable; the schema is sacred.
2. **Artifacts over chat.** Agents are stateless between invocations and their context gets
   compacted. Durable, replayable, reviewable artifacts (files + git) survive that and are
   the audit trail.
3. **Model-agnostic.** Agents sit behind adapters and a shared MCP interface. Swap Codex or
   Claude for anything without touching the coordinator.
4. **Safe by construction.** Autonomy is bounded by isolation (a throwaway branch), hard
   caps, and explicit termination — not by trust.
5. **git is the source of truth.** Decisions live in commits; handoffs reference them. The
   review surface is a diff (and eventually `gitt`).

## 2. Roles

| Role | Agent | Does | Produces |
|---|---|---|---|
| **Lead Developer** | Codex / GPT‑5.5 | implements, tests, commits | IMPLEMENT/REVISE handoffs |
| **Tech Lead** | Claude | plans, decomposes, reviews, decides done | PLAN/REVIEW/DONE handoffs |
| **Principal** | Human (you) | sets the goal, reviews the result branch | the goal; the merge decision |

Role behavior is defined in `prompts/` and injected as each agent's system prompt.

## 3. Architecture — four layers

Loosely coupled; each is independently replaceable.

### 3.1 Spine — handoff store (MCP)
The shared context bus. An **MCP server** (`ac-handoffs`) exposes tools both agents call
identically:

- `latest_handoff(run)` → the most recent handoff addressed to the caller's role
- `read_handoff(run, seq)` / `list_handoffs(run)`
- `write_handoff(run, handoff)` → validates against the schema, assigns `seq`, persists
- `get_run_state(run)` *(coordinator + read-only for agents)*

Backed by the run directory (`<runs-dir>/<run-id>/`). Because it's MCP, Codex and Claude
use the exact same interface — the spine is tool-agnostic. Artifacts are also plain files,
so the coordinator and the cockpit can read them directly without MCP.

### 3.2 Adapters — invoke an agent
A thin module per agent implementing one interface:

```ts
interface Agent {
  role: Role;
  // Given the latest handoff + repo context, run the agent headlessly and
  // return the handoff it wrote (it calls write_handoff via MCP itself).
  run(ctx: TurnContext): Promise<Handoff>;
}
```

- **Claude adapter** — headless `claude -p` (or the Claude Agent SDK), `--output-format
  json`, role prompt from `prompts/tech-lead.md`, `ac-handoffs` MCP attached, target-repo
  context via `CLAUDE.md`. *(Verify current SDK/flags at build time.)*
- **Codex adapter** — Codex's non-interactive `exec` mode, role prompt from
  `prompts/lead-dev.md`, `ac-handoffs` MCP attached, context via `AGENTS.md`. *(Verify
  current invocation + MCP-client config at build time.)*

The coordinator only knows the `Agent` interface.

### 3.3 Coordinator — drive the loop
A state machine (see §4) that picks the next phase, invokes the right adapter, persists the
resulting handoff, checks termination, and enforces the safety caps. Owns `state.json`.

### 3.4 Cockpit — observe & review *(deferred)*
Start with a **tmux** layout (zero custom code): a pane tailing the run (`ac watch`), a
`gitt` pane pointed at the run branch for diffs, and the agents' own output. Graduate to a
unified ratatui app later (this is where the libghostty / `portable-pty + tui-term`
embedding options come back). `gitt` is the first real panel.

## 4. The autonomous loop

```
INIT ─▶ PLAN ─▶ IMPLEMENT ─▶ REVIEW ─┬─(approved)──▶ DONE
                  ▲                   │
                  └──── REVISE ◀──────┘ (changes-requested)
   any phase ─▶ BLOCKED (→ human)     caps exceeded ─▶ ABORTED (→ human)
```

- **INIT** — create worktree + branch `ac/<run-id>`; seed the run dir; record the goal.
- **PLAN** (Claude) → **IMPLEMENT** (Codex) → **REVIEW** (Claude). On
  `changes-requested`, loop to **REVISE** (Codex) → **REVIEW**. On `approved`, **DONE**.
- Phase selection is driven purely by the latest handoff's `phase`/`status` + `state.json`.

## 5. Autonomy & safety model

"Fully autonomous" = the loop runs end-to-end without human turns. It is made safe by
construction, not by trust:

- **Isolation.** All work in a dedicated git **worktree** on branch `ac/<run-id>`. `main` is
  never touched; nothing is pushed to a remote. The human reviews the branch afterward.
- **Hard caps** (in `state.json`, enforced by the coordinator): max rounds, max wall-clock,
  and a token/cost budget. Hitting any cap → `ABORTED` handoff to the human.
- **Convergence.** DONE requires an explicit tech-lead `approved`. A **stuck detector**
  aborts on non-progress: e.g. N rounds with no new commits, or repeated identical
  `open_questions`/review findings (ping-pong).
- **Sandboxed agents.** Even unattended, agents run in their tools' restricted modes with a
  command allow/deny policy — autonomy ≠ unrestricted shell. The worktree confines writes.
- **Kill switch.** A sentinel file (e.g. `<run-dir>/STOP`) halts the loop cleanly after the
  current step.
- **Audit.** The ordered handoffs + git history are a complete, replayable record.

## 6. Framework vs target repo

`ac` (this repo) is the **tooling**. It operates on a **target repo** (could be `gitt`, or
anything). Keep them distinct:

- The target repo is where agents do the work; `ac` creates the worktree/branch there.
- Run state lives at a configurable `runs-dir`, defaulting to `<target>/.ac/runs/<run-id>/`.
  Gitignored in the target by default; optionally committed on the run branch as audit.
- A run is configured by: target repo path, goal text, role→agent mapping, and caps.

## 7. Tech stack & planned `src/` layout

TypeScript / Node ≥ 20, ESM, strict. `tsx` to run, `vitest` to test, `zod` for schema.

```
src/
  handoff/
    schema.ts        # zod schema + types (mirrors docs/handoff-schema.md)
    store.ts         # read/write/list handoffs in a run dir; assigns seq
  mcp/
    server.ts        # ac-handoffs MCP server over store.ts
  agents/
    types.ts         # Agent / TurnContext / Role interfaces
    claude.ts        # Claude (tech-lead) adapter
    codex.ts         # Codex (lead-dev) adapter
  coordinator/
    state.ts         # RunState + state.json io
    loop.ts          # the state machine + caps + stuck detection   (P2)
  cli/
    index.ts         # `ac init|run|watch|resume` commands
```

(The first milestone only needs `handoff/`, `mcp/`, and a minimal `cli/`. See `HANDOFF.md`.)

## 8. Roadmap

- **P0 — spine, proven by hand.** `handoff/schema.ts` + `store.ts` + `mcp/server.ts`; wire
  both agents to the MCP server; run PLAN→IMPLEMENT→REVIEW manually (human relays). Goal:
  confirm the schema and prompts feel right before automating.
- **P1 — scripted turns.** Agent adapters that invoke each agent headless and capture the
  handoff. Human still triggers each turn.
- **P2 — autonomous coordinator.** `coordinator/loop.ts`: full state machine, worktree
  isolation, caps, stuck detection, kill switch.
- **P3 — cockpit.** tmux layout + `ac watch`; fold in `gitt` as the review pane; later a
  unified TUI.

## 9. Open questions (decide as you build)

- Exact headless invocation + MCP-client wiring for **Codex** and **Claude** (verify
  against current tool versions; encapsulate in the adapters).
- Cost/token accounting source for the budget cap (per-tool reporting vs. estimate).
- Whether to auto-open a PR on DONE or just leave the branch.
- Multi-task runs (a backlog) vs. one-task-per-run (start with one task per run).
