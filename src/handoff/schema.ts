import { z } from "zod";

export const AgentSchema = z.enum(["claude", "codex", "human"]);
export const RoleSchema = z.enum(["tech-lead", "lead-dev", "human"]);
export const PhaseSchema = z.enum([
  "plan",
  "implement",
  "review",
  "revise",
  "blocked",
  "done",
]);
export const StatusSchema = z.enum([
  "in-progress",
  "approved",
  "changes-requested",
  "blocked",
  "done",
]);

export const ActorSchema = z.strictObject({
  agent: AgentSchema,
  role: RoleSchema,
});

export const HandoffBodySchema = z.strictObject({
  summary: z
    .string()
    .refine((value) => value.trim().length > 0, "body.summary must be non-empty"),
  details: z.string().optional(),
  review: z.string().optional(),
});

export const HandoffSchema = z
  .strictObject({
    id: z.string().min(1),
    run: z.string().min(1),
    seq: z.number().int().nonnegative(),
    ts: z
      .iso
      .datetime()
      .refine((value) => value.endsWith("Z"), "ts must be an ISO-8601 UTC timestamp ending in Z"),
    from: ActorSchema,
    to: ActorSchema,
    phase: PhaseSchema,
    task: z.string().min(1),
    status: StatusSchema,
    confidence: z.number().min(0).max(1),
    branch: z.string().min(1),
    commits: z.array(z.string()),
    files_touched: z.array(z.string()),
    decisions: z.array(z.string()),
    open_questions: z.array(z.string()),
    next_actions: z.array(z.string()),
    body: HandoffBodySchema,
  })
  .superRefine((handoff, ctx) => {
    if (
      handoff.phase === "done" &&
      handoff.status === "approved" &&
      handoff.from.role !== "tech-lead"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["from", "role"],
        message: "only from.role tech-lead may emit phase done with status approved",
      });
    }

    if (handoff.phase === "blocked" && handoff.to.role !== "human") {
      ctx.addIssue({
        code: "custom",
        path: ["to", "role"],
        message: "phase blocked must address to.role human",
      });
    }

    if (handoff.phase !== "done" && handoff.next_actions.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["next_actions"],
        message: "next_actions must be non-empty unless phase is done",
      });
    }

    if (handoff.phase === "review" && !handoff.body.review?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["body", "review"],
        message: "body.review is required when phase is review",
      });
    }

    const expectedRoles: Record<Agent, Role> = {
      claude: "tech-lead",
      codex: "lead-dev",
      human: "human",
    };

    if (handoff.from.role !== expectedRoles[handoff.from.agent]) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "from.agent must match its natural role",
      });
    }

    if (handoff.to.role !== expectedRoles[handoff.to.agent]) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "to.agent must match its natural role",
      });
    }
  });

export type Agent = z.infer<typeof AgentSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type HandoffBody = z.infer<typeof HandoffBodySchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
