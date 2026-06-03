# Agent Wiring

This runbook wires Claude Code and Codex to the local `ac-handoffs` MCP server for the P0
manual smoke loop.

Verified against:

- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Claude Code config debugging docs: https://code.claude.com/docs/en/debug-your-config
- Codex MCP docs: https://developers.openai.com/codex/mcp
- Codex config basics: https://developers.openai.com/codex/config-basic
- Codex AGENTS.md docs: https://developers.openai.com/codex/guides/agents-md

## Prerequisites

1. Work from `C:\Dev\ac` on branch `bootstrap/p0-spine`.
2. Install dependencies with `npm install`.
3. Keep the run base at `C:\Dev\ac\.ac\runs`.
4. Confirm the server starts:

```powershell
$env:AC_RUNS_DIR = 'C:\Dev\ac\.ac\runs'
npm run mcp
```

The server is a stdio process, so it stays silent and waits for MCP input. Stop it with
`Ctrl+C` when testing manually.

## Claude Code Config

Claude Code project-scoped MCP servers live in `.mcp.json` at the project root. Project
servers are designed to be checked into version control and require one-time approval inside
Claude Code with `/mcp`.

Current repo config:

```json
{
  "mcpServers": {
    "ac-handoffs": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "cd /d C:\\Dev\\ac && npm.cmd run mcp"],
      "env": {
        "AC_RUNS_DIR": "C:\\Dev\\ac\\.ac\\runs"
      }
    }
  }
}
```

Deviation from the original sketch: the Claude docs confirm `command`, `args`, and per-server
`env`, but do not document a `cwd` field for `.mcp.json`. On Windows the config uses
`cmd /c "cd /d C:\Dev\ac && npm.cmd run mcp"` so the server starts in the repo directory
without relying on an undocumented `cwd` key.

Launch Claude Code from the repo root:

```powershell
cd C:\Dev\ac
claude
```

Inside Claude Code:

1. Run `/mcp`.
2. Approve the project-scoped `ac-handoffs` server if prompted.
3. Confirm it connects and exposes `write_handoff`, `latest_handoff`, `read_handoff`,
   `list_handoffs`, and `get_run_state`.
4. Inject the Tech Lead role by giving Claude the contents of `prompts/protocol.md` and
   `prompts/tech-lead.md` at session start.

## Codex Config

Codex reads user config from `~/.codex/config.toml` and trusted project config from
`.codex/config.toml`. The CLI and IDE extension share these config layers.

Current repo config:

```toml
[mcp_servers."ac-handoffs"]
enabled = true
command = "npm.cmd"
args = ["run", "mcp"]
cwd = "C:\\Dev\\ac"
startup_timeout_sec = 10
tool_timeout_sec = 60

[mcp_servers."ac-handoffs".env]
AC_RUNS_DIR = "C:\\Dev\\ac\\.ac\\runs"
```

This uses Codex's documented stdio fields: `command`, `args`, per-server `env`, and `cwd`.
The project must be trusted or Codex skips the `.codex/` layer.

Launch Codex from the repo root:

```powershell
cd C:\Dev\ac
codex
```

At session start, inject the Lead Developer role by giving Codex the contents of
`prompts/protocol.md` and `prompts/lead-dev.md`. For a durable P1 setup, move this prompt
composition into an adapter or project instructions file; for P0, keep it explicit in the
manual launch.

## Run Conventions

- `AC_RUNS_DIR` is the base directory for all runs: `C:\Dev\ac\.ac\runs`.
- MCP tool calls pass a `run` id, for example `bootstrap-p0` or `wire-smoke-001`.
- Each run stores handoffs under `AC_RUNS_DIR\<run>`.
- `ac init <run-id> --goal <text>` creates the run directory and `state.json`.
- Handoff files are immutable and named `NNNN-<from-role>-<phase>.md`.

## Task 7 Smoke Loop

1. Start with a clean throwaway run:

```powershell
cd C:\Dev\ac
npm run ac -- init wire-smoke-001 --goal "Verify Claude and Codex exchange handoffs through ac-handoffs"
```

2. Launch Claude Code from `C:\Dev\ac`, approve `ac-handoffs` in `/mcp`, and inject
   `prompts/protocol.md` plus `prompts/tech-lead.md`.
3. As Tech Lead, call `write_handoff` with `run = "wire-smoke-001"` and a PLAN handoff to
   `{ agent: "codex", role: "lead-dev" }`. Do not include `id`, `run`, or `seq`; the store
   injects them.
4. Launch Codex from `C:\Dev\ac`, confirm `ac-handoffs` is available, and inject
   `prompts/protocol.md` plus `prompts/lead-dev.md`.
5. As Lead Developer, call `latest_handoff` with `run = "wire-smoke-001"` and
   `role = "lead-dev"`, perform the tiny throwaway task, then call `write_handoff` with an
   IMPLEMENT handoff back to `{ agent: "claude", role: "tech-lead" }`.
6. In Claude Code, call `latest_handoff` with `run = "wire-smoke-001"` and
   `role = "tech-lead"`, review the implementation, then call `write_handoff` with a REVIEW
   handoff. The review verdict is the top-level `status`: use `status = "approved"` if it
   passes, or `status = "changes-requested"` with concrete `next_actions` if it does not.
   Because `phase = "review"`, include findings as a markdown string in `body.review`.

Example approved REVIEW payload:

```json
{
  "run": "wire-smoke-001",
  "handoff": {
    "ts": "2026-06-03T10:30:00Z",
    "from": { "agent": "claude", "role": "tech-lead" },
    "to": { "agent": "codex", "role": "lead-dev" },
    "phase": "review",
    "task": "Verify Claude and Codex exchange handoffs through ac-handoffs",
    "status": "approved",
    "confidence": 0.85,
    "branch": "bootstrap/p0-spine",
    "commits": [],
    "files_touched": [],
    "decisions": ["Approved: live handoff tool exchange succeeded."],
    "open_questions": [],
    "next_actions": ["No code changes required; the Tech Lead will write the final DONE handoff."],
    "body": {
      "summary": "Reviewed the smoke-loop implementation and approved it.",
      "review": "- Handoff exchange completed through MCP tools.\n- No schema/store mismatch found."
    }
  }
}
```

The `handoff` object intentionally omits `id`, `run`, and `seq`; the store injects them.
`body.summary` is always required. `body.review` is required only when `phase = "review"`.

7. If approved, write a final DONE handoff from Tech Lead to the human:
   `{ agent: "human", role: "human" }`, `phase = "done"`, and `status = "approved"`.
   Do not add a nested review verdict field; the DONE verdict is already represented by the
   top-level `status`. DONE may have an empty `next_actions` array.
8. Capture every friction point for task 8: config prompts, tool visibility, tool-call payload
   confusion, role-prompt drift, Windows spawning, and any schema/store mismatch.

Schema trace for the happy path:

- PLAN: `claude/tech-lead` to `codex/lead-dev`, `phase = "plan"`,
  `status = "in-progress"`, non-empty `next_actions`, `body.summary`.
- IMPLEMENT: `codex/lead-dev` to `claude/tech-lead`, `phase = "implement"`,
  `status = "in-progress"`, non-empty `next_actions`, `body.summary`.
- REVIEW approved: `claude/tech-lead` to `codex/lead-dev`, `phase = "review"`,
  `status = "approved"`, non-empty `next_actions`, `body.summary`, `body.review`.
- DONE: `claude/tech-lead` to `human/human`, `phase = "done"`, `status = "approved"`,
  empty `next_actions` allowed, `body.summary`.

The live proof is this human-plus-agents smoke loop. Unit tests and process probes can confirm
the server starts, but they do not prove that Claude Code and Codex both load and call the tools
inside real agent sessions.
