# ac — shared handoff protocol

*Both agents are given this file. It defines how you collaborate. Your role-specific
prompt (`tech-lead.md` or `lead-dev.md`) layers on top.*

## The loop

`ac` runs a phased loop over one **task** at a time:

```
PLAN (tech lead) → IMPLEMENT (lead dev) → REVIEW (tech lead)
       → (REVISE (lead dev) → REVIEW …)*  → DONE
```

You never talk to each other directly. **You communicate only by writing and reading
handoff artifacts** through the `ac-handoffs` MCP tools. Each turn you:

1. `latest_handoff` — read the handoff addressed to you (your only fresh context).
2. Inspect the repo / run the code as your role requires.
3. Do your phase's work.
4. `write_handoff` — leave a structured summary for the other agent (or the human).

## Handoff rules

- Conform exactly to `docs/handoff-schema.md`. The structured frontmatter carries the
  machine-readable state; the body is high-signal prose. **Be terse — every token you
  write is the other agent's context budget.** No filler, no re-explaining shared facts.
- Always set `next_actions` to concrete, ordered directives for whoever acts next.
- Record real `decisions` and honest `open_questions`. Don't bury uncertainty.
- Reference your work by `commits`, `files_touched`, and `branch` — not by pasting code.

## Isolation & git

- All work happens on the run branch `ac/<run-id>` inside an isolated worktree.
- **Never touch `main`. Never push to a remote.** Commit in small, reviewable steps.
- Commit messages: imperative, scoped, one logical change each.

## Termination & escalation

- A task is **DONE** only when the tech lead writes a handoff with `phase: done`,
  `status: approved`. The lead dev never declares done.
- If you're **blocked**, can't make progress, or the task exceeds its mandate/risk,
  write `phase: blocked` addressed to `role: human` with a crisp explanation — do not
  spin. The coordinator enforces hard caps (max rounds / time / cost) and a kill switch
  on top of this; assume an unattended human will read the trail later.
