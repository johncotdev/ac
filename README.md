# ac — agentic coding

> Part of **cot.industries**. Domain: **cot.ac**.

`ac` is a framework for running a two-agent software-development loop **autonomously**:

- **Codex (GPT‑5.5)** — *Lead Developer*: implements, tests, commits.
- **Claude** — *Tech / Engineering Lead*: plans, decomposes, reviews, sets direction, decides "done".

The two agents collaborate by writing **structured handoff summaries** to each other over a shared, durable protocol. `ac` orchestrates that loop, keeps every exchange as an auditable artifact, and isolates the work on a throwaway git branch so a fully autonomous run is safe to review after the fact.

## Status

**Design phase — no application code yet.** This repo currently holds the design and the
build handoff. Start at [`HANDOFF.md`](HANDOFF.md); the architecture is in
[`docs/DESIGN.md`](docs/DESIGN.md); the handoff contract in
[`docs/handoff-schema.md`](docs/handoff-schema.md).

## The idea in one picture

```
         ┌──────── ac coordinator (autonomous loop) ────────┐
  goal → │  PLAN → IMPLEMENT → REVIEW → REVISE → … → DONE    │ → branch for human review
         └───┬───────────┬───────────────┬──────────────────┘
             │           │               │
          Claude       Codex           Claude         ← agents (headless invocation)
        (tech lead)  (lead dev)      (tech lead)
             └───────────┴── handoffs ──┴── (MCP tools + .ac/runs artifacts) ──┘
```

## Key decisions (locked)

- **Stack:** TypeScript / Node for orchestration. The cockpit/TUI stays Rust — [`gitt`](https://github.com/johncotdev/gitt) is a planned review panel.
- **Spine:** artifact-based handoffs exposed through an **MCP server** — model‑agnostic, durable, auditable.
- **Autonomy:** fully autonomous runs on an **isolated git worktree/branch**; the human reviews the result, not each step.
- **First milestone:** build and prove the handoff spine (manual loop → scripted). See `HANDOFF.md`.

## Layout

| Path | What |
|---|---|
| `docs/DESIGN.md` | full architecture + autonomy/safety model |
| `docs/handoff-schema.md` | the handoff artifact contract (the keystone) |
| `prompts/` | role system prompts: `tech-lead` (Claude), `lead-dev` (Codex), shared `protocol` |
| `HANDOFF.md` | start-here guide for the first build session |
| `src/` | *(to be created)* MCP server, agent adapters, coordinator, CLI |
| `.ac/` | *(runtime)* per-run state + handoff artifacts; gitignored |
