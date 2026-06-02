import { describe, expect, it } from "vitest";

import { HandoffSchema, type Handoff } from "./schema.js";

const planExample: Handoff = {
  id: "20260603-axum-mw-0001",
  run: "20260603-axum-mw",
  seq: 1,
  ts: "2026-06-03T09:40:00Z",
  from: { agent: "claude", role: "tech-lead" },
  to: { agent: "codex", role: "lead-dev" },
  phase: "plan",
  task: "Add request-id middleware to the API",
  status: "in-progress",
  confidence: 0.8,
  branch: "ac/20260603-axum-mw",
  commits: [],
  files_touched: [],
  decisions: [
    "Generate a UUIDv4 per request; echo it in the `x-request-id` response header.",
    "If the client sends `x-request-id`, honor it instead of generating.",
  ],
  open_questions: [],
  next_actions: [
    "Add middleware in src/middleware/request_id.ts; attach id to the request context.",
    "Set the `x-request-id` response header.",
    "Add a unit test covering both generated and client-supplied id paths.",
  ],
  body: {
    summary:
      "Small, self-contained task. Done-criteria: both id paths covered by a passing test, header present on responses, no change to existing routes.",
  },
};

const implementExample: Handoff = {
  id: "20260603-axum-mw-0002",
  run: "20260603-axum-mw",
  seq: 2,
  ts: "2026-06-03T09:48:00Z",
  from: { agent: "codex", role: "lead-dev" },
  to: { agent: "claude", role: "tech-lead" },
  phase: "implement",
  task: "Add request-id middleware to the API",
  status: "in-progress",
  confidence: 0.7,
  branch: "ac/20260603-axum-mw",
  commits: ["a1b2c3d"],
  files_touched: ["src/middleware/request_id.ts", "src/app.ts", "test/request_id.test.ts"],
  decisions: ["Used crypto.randomUUID() (no new dependency)."],
  open_questions: ["Should the id also be logged on each request? Not in scope; left out."],
  next_actions: ["Review src/middleware/request_id.ts and test/request_id.test.ts."],
  body: {
    summary:
      "Implemented per the plan. `npm test` green (4 passing, incl. both id paths). Header set in the middleware before handing to the next layer.",
  },
};

const doneExample: Handoff = {
  id: "20260603-axum-mw-0003",
  run: "20260603-axum-mw",
  seq: 3,
  ts: "2026-06-03T09:53:00Z",
  from: { agent: "claude", role: "tech-lead" },
  to: { agent: "human", role: "human" },
  phase: "done",
  task: "Add request-id middleware to the API",
  status: "approved",
  confidence: 0.9,
  branch: "ac/20260603-axum-mw",
  commits: ["a1b2c3d"],
  files_touched: [],
  decisions: ["Approved: meets done-criteria."],
  open_questions: [],
  next_actions: [],
  body: {
    summary:
      "Reviewed the diff and ran the suite. Both id paths covered, header verified, no regressions.",
    review:
      "- src/middleware/request_id.ts:12 - client-supplied id correctly preferred.\n- test/request_id.test.ts - covers generate + honor paths.\n- No scope creep. Approved; branch `ac/20260603-axum-mw` ready for human review.",
  },
};

const clone = (handoff: Handoff): Handoff => ({
  ...handoff,
  from: { ...handoff.from },
  to: { ...handoff.to },
  commits: [...handoff.commits],
  files_touched: [...handoff.files_touched],
  decisions: [...handoff.decisions],
  open_questions: [...handoff.open_questions],
  next_actions: [...handoff.next_actions],
  body: { ...handoff.body },
});

describe("HandoffSchema", () => {
  it("accepts the worked examples from the schema documentation", () => {
    expect(HandoffSchema.safeParse(planExample).success).toBe(true);
    expect(HandoffSchema.safeParse(implementExample).success).toBe(true);
    expect(HandoffSchema.safeParse(doneExample).success).toBe(true);
  });

  it("allows a review body outside the review phase", () => {
    expect(HandoffSchema.safeParse(doneExample).success).toBe(true);
  });

  it("accepts a valid review phase with a Review section", () => {
    const handoff = clone(implementExample);
    handoff.id = "20260603-axum-mw-0003";
    handoff.seq = 3;
    handoff.from = { agent: "claude", role: "tech-lead" };
    handoff.to = { agent: "codex", role: "lead-dev" };
    handoff.phase = "review";
    handoff.status = "changes-requested";
    handoff.commits = [];
    handoff.files_touched = [];
    handoff.next_actions = ["Revise the middleware tests to cover client-supplied IDs."];
    handoff.body = {
      summary: "Review found one missing edge-case test.",
      review: "test/request_id.test.ts - add coverage for client-supplied IDs.",
    };

    expect(HandoffSchema.safeParse(handoff).success).toBe(true);
  });

  it("rejects lead-dev done approval", () => {
    const handoff = clone(doneExample);
    handoff.from = { agent: "codex", role: "lead-dev" };

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects blocked handoffs addressed to a non-human", () => {
    const handoff = clone(planExample);
    handoff.phase = "blocked";
    handoff.status = "blocked";
    handoff.to = { agent: "codex", role: "lead-dev" };

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects empty next_actions on non-done phases", () => {
    const handoff = clone(planExample);
    handoff.next_actions = [];

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects review handoffs without a Review section", () => {
    const handoff = clone(implementExample);
    handoff.from = { agent: "claude", role: "tech-lead" };
    handoff.to = { agent: "codex", role: "lead-dev" };
    handoff.phase = "review";
    handoff.status = "changes-requested";
    handoff.body = { summary: "Review found one missing edge-case test." };

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects empty Summary sections", () => {
    const handoff = clone(planExample);
    handoff.body = { summary: "   " };

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects mismatched agent and role pairs", () => {
    const handoff = clone(planExample);
    handoff.from = { agent: "claude", role: "lead-dev" };

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects non-UTC ISO timestamps", () => {
    const handoff = clone(planExample);
    handoff.ts = "2026-06-03T09:40:00+10:00";

    expect(HandoffSchema.safeParse(handoff).success).toBe(false);
  });
});
