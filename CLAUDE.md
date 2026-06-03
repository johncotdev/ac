# ac — project context for agents

`ac` (agentic coding) is a TypeScript framework that runs an autonomous two-agent dev
loop: **Codex (GPT‑5.5)** as Lead Developer and **Claude** as Tech Lead, exchanging
structured handoffs. Part of **cot.industries**.

**You are building `ac` itself in this repo.** Start with `HANDOFF.md` — the first
milestone is the *handoff spine*. The architecture is in `docs/DESIGN.md`, the handoff
contract in `docs/handoff-schema.md`, and the agent role prompts in `prompts/`.

## Conventions
- TypeScript, ESM (`"type": "module"`), `strict` mode. Node ≥ 20. Run with `tsx`, test with `vitest`.
- Small, focused modules; comments explain *why*, not *what*. Match the clean style of the design docs.
- Validate all external/agent data with `zod`; the handoff schema is the contract.
- `ac` operates on a **target repo** via an isolated git worktree/branch — never on `main`, never pushes to a remote without a human.
- Fresh repo: make the initial commit once the spine runs end-to-end, and **only when the user asks to commit**.

## Status
Design complete; no app code yet. Build the spine per `HANDOFF.md`.
