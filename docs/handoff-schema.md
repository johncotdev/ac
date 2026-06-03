# Handoff schema

A **handoff** is one message from one agent to the next, stored as a markdown file with
YAML frontmatter. It is the unit of collaboration and the unit of audit. The structured
frontmatter carries machine-readable state; the body is high-signal prose.

This document is the **contract**. The first build milestone turns it into a `zod` schema
(`src/handoff/schema.ts`) that the MCP `write_handoff` tool validates against.

## File location & naming

```
<runs-dir>/<run-id>/NNNN-<from-role>-<phase>.md      e.g. 0003-tech-lead-review.md
<runs-dir>/<run-id>/state.json                        current phase/turn/caps (coordinator-owned)
```

`NNNN` is a zero-padded sequence; files are append-only (never edited after written).

## Frontmatter fields

| field | type | meaning |
|---|---|---|
| `id` | string | `<run>-<zero-padded seq>`; unique, e.g. `"<run-id>-0003"` |
| `run` | string | run id this handoff belongs to |
| `seq` | int | order within the run (matches `NNNN`); ≥ 1 |
| `ts` | string | ISO‑8601 timestamp (UTC) |
| `from` | `{ agent, role }` | author. `agent`: `claude`\|`codex`\|`human`; `role`: `tech-lead`\|`lead-dev`\|`human` |
| `to` | `{ agent, role }` | who must act next (same shape) |
| `phase` | enum | `plan` \| `implement` \| `review` \| `revise` \| `blocked` \| `done` |
| `task` | string | short title of the task in flight |
| `status` | enum | `in-progress` \| `approved` \| `changes-requested` \| `blocked` \| `done` |
| `confidence` | number | author's confidence, 0–1 |
| `branch` | string | git branch the work lives on (`ac/<run-id>`) |
| `commits` | string[] | commit SHAs produced this turn (may be empty) |
| `files_touched` | string[] | paths changed this turn (may be empty) |
| `decisions` | string[] | decisions made this turn |
| `open_questions` | string[] | unknowns / assumptions to revisit |
| `next_actions` | string[] | concrete, ordered directives for `to` |

## Body sections

```
## Summary      — required. The high-signal prose. What happened / what to do, tersely.
## Details      — optional. Deeper notes, rationale, tradeoffs.
## Review       — required on phase: review. Verdict + specific findings (file:line).
```

## Invariants

**Schema-enforced (per handoff, by `write_handoff` validation):**

- `phase: done` may be emitted **only** by `from.role: tech-lead`, and **only** with
  `status: approved`. (The lead dev never declares done — protocol §termination.)
- `phase: blocked` must address `to.role: human`.
- `next_actions` is non-empty unless `phase` is `done`.
- `from.agent ≠ to.agent` — a handoff always addresses the *other* party (no self-handoffs).
- The `agent`↔`role` pairing is fixed: `claude`=`tech-lead`, `codex`=`lead-dev`,
  `human`=`human`.
- `seq ≥ 1`, and `id` = `<run>-<zero-padded seq>` (e.g. run `r`, seq 3 → `r-0003`).
- `ts` is ISO-8601 UTC (trailing `Z`). `task`, `branch`, and `## Summary` are non-empty.
- `## Review` is required when `phase: review` (it is *allowed* in other phases too — e.g.
  a `done` handoff may carry the final review).

**Coordinator-enforced (across the run, not by the per-handoff schema):**

- `seq` is strictly increasing; files are immutable once written.
- Branch *naming* (`ac/<run-id>`) is assigned by the coordinator at INIT. The schema does
  **not** constrain the `branch` string — it only requires it be non-empty — so special
  runs (e.g. this bootstrap, on `bootstrap/p0-spine`) remain valid.

## Example — PLAN (Claude → Codex)

```markdown
---
id: 20260603-axum-mw-0001
run: 20260603-axum-mw
seq: 1
ts: 2026-06-03T09:40:00Z
from: { agent: claude, role: tech-lead }
to:   { agent: codex,  role: lead-dev }
phase: plan
task: "Add request-id middleware to the API"
status: in-progress
confidence: 0.8
branch: ac/20260603-axum-mw
commits: []
files_touched: []
decisions:
  - "Generate a UUIDv4 per request; echo it in the `x-request-id` response header."
  - "If the client sends `x-request-id`, honor it instead of generating."
open_questions: []
next_actions:
  - "Add middleware in src/middleware/request_id.ts; attach id to the request context."
  - "Set the `x-request-id` response header."
  - "Add a unit test covering both generated and client-supplied id paths."
---

## Summary
Small, self-contained task. Done-criteria: both id paths covered by a passing test, header
present on responses, no change to existing routes.
```

## Example — IMPLEMENT (Codex → Claude)

```markdown
---
id: 20260603-axum-mw-0002
run: 20260603-axum-mw
seq: 2
ts: 2026-06-03T09:48:00Z
from: { agent: codex, role: lead-dev }
to:   { agent: claude, role: tech-lead }
phase: implement
task: "Add request-id middleware to the API"
status: in-progress
confidence: 0.7
branch: ac/20260603-axum-mw
commits: ["a1b2c3d"]
files_touched: ["src/middleware/request_id.ts", "src/app.ts", "test/request_id.test.ts"]
decisions:
  - "Used crypto.randomUUID() (no new dependency)."
open_questions:
  - "Should the id also be logged on each request? Not in scope; left out."
next_actions:
  - "Review src/middleware/request_id.ts and test/request_id.test.ts."
---

## Summary
Implemented per the plan. `npm test` green (4 passing, incl. both id paths). Header set in
the middleware before handing to the next layer.
```

## Example — REVIEW → DONE (Claude → human)

```markdown
---
id: 20260603-axum-mw-0003
run: 20260603-axum-mw
seq: 3
ts: 2026-06-03T09:53:00Z
from: { agent: claude, role: tech-lead }
to:   { agent: human, role: human }
phase: done
task: "Add request-id middleware to the API"
status: approved
confidence: 0.9
branch: ac/20260603-axum-mw
commits: ["a1b2c3d"]
files_touched: []
decisions: ["Approved: meets done-criteria."]
open_questions: []
next_actions: []
---

## Summary
Reviewed the diff and ran the suite. Both id paths covered, header verified, no regressions.

## Review
- src/middleware/request_id.ts:12 — client-supplied id correctly preferred. ✓
- test/request_id.test.ts — covers generate + honor paths. ✓
- No scope creep. Approved; branch `ac/20260603-axum-mw` ready for human review.
```
