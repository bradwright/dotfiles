---
name: plan-methodology
description: Iterative planning workflow for coding tasks. Creates an implementation plan package, then iterates through draft/review cycles with user feedback until the plan is approved.
compatibility: pi with optional subagent tool (delegation preferred, in-session fallback supported).
allowed-tools: subagent read write edit bash grep find ls
---

# Plan (Iterative Planning Loop)

Use this skill when the user asks to plan work before implementing.

Treat this as **planning-only**. Do not implement code changes yet.

## Core Concept

Planning is an **iterative loop**, not a one-shot handoff. The user steers
every transition.

Heavy work (scouting, drafting, reviewing) is **delegated to subagents** so
the primary agent keeps a small context window. The primary agent
orchestrates, handles user discussion, and reads plan files on demand.

```text
User provides task description
  ↓
Create plan package directory
  ↓
Scout (subagent: scout) → writes context to plan dir
  ↓
Draft 1 (subagent: worker) → writes plan.md using scout context
  ↓
Primary reads plan.md, presents summary to user
  ↓
User feedback / discussion loop
  ├─ Discussion or questions (no edit request):
  │    → Primary adds substantive feedback to feedback.md
  │    → Prunes resolved/superseded items
  │    → plan.md unchanged
  └─ Explicit edit request from user:
       → Primary revises plan.md in place (small edits)
       → OR delegates to worker for large revisions
       → Adds Edit entry to changelog.md if material
  ↓
User requests review
  ↓
Review (subagent: plan-reviewer) → writes to feedback.md + changelog.md
  ↓
Primary reads feedback.md, presents findings to user
  ↓
User selects which feedback items to incorporate
  ↓
Draft N+1 (subagent: worker) → incorporates selected items
  ↓
Plan approved by user?
  ├─ no  → Next draft/review cycle
  └─ yes → Add Approved entry, ask: "Ready to start building?"
```

Never switch phases unless the user explicitly says so.

## Subagent Delegation Rules

### Scout (codebase reconnaissance)

Use the builtin `scout` agent. Write output into the plan package.

```
subagent(
  agent: "scout",
  task: "<scouting instructions derived from user's task>",
  output: "<plan-dir>/context.md"
)
```

The scout reads relevant source files, traces code paths, and writes
structured findings to `context.md` in the plan directory.

### Drafter (plan creation and revision)

Use the builtin `worker` agent for drafting. It reads the scout context
and feedback, then writes the plan.

For **Draft 1**:
```
subagent(
  agent: "worker",
  task: "Read <plan-dir>/context.md and <plan-dir>/feedback.md.
         Write an implementation plan to <plan-dir>/plan.md following
         the format specified below. Add a Draft 1 entry to
         <plan-dir>/changelog.md with today's date.
         <include task description and any user constraints>"
)
```

For **Draft N+1** (incorporating review feedback):
```
subagent(
  agent: "worker",
  task: "Read <plan-dir>/plan.md, <plan-dir>/feedback.md, and
         <plan-dir>/context.md.
         Incorporate ONLY these specific feedback items: <list items>.
         Update plan.md in place. Remove incorporated items from
         feedback.md. Add a Draft N+1 entry to changelog.md.
         <include any new user constraints>"
)
```

### Reviewer (plan stress-testing)

Use the project `plan-reviewer` agent. It already knows how to review
plan packages.

```
subagent(
  agent: "plan-reviewer",
  task: "Review the plan package at <plan-dir>/. The repository root
         is <cwd>. <any user steering, e.g. 'focus on error handling'>"
)
```

The reviewer writes findings to `feedback.md` and a Review entry to
`changelog.md`. It does NOT modify `plan.md`.

## Capability Detection and Fallback (Mandatory)

Before delegating, check whether the `subagent` tool is available.

- If available: use the delegation flow in this skill (preferred).
- If unavailable: run an in-session fallback that preserves the same file
  contract and phase behavior.

Fallback behavior:
- Do scouting in-session (read/grep/find relevant code), then write
  `context.md` yourself.
- Do drafting/revision in-session by editing `plan.md`, `feedback.md`, and
  `changelog.md` directly.
- Do review in-session by evaluating `plan.md` + `feedback.md` and appending
  findings to `feedback.md` plus a `Review` line in `changelog.md`.
- Keep the same guardrails: planning-only, no implementation, no unsolicited
  promotion of feedback into `plan.md`.

## Primary Agent Responsibilities

The primary agent (you) handles ONLY:

1. **Orchestration** — dispatch to subagents at the right time.
2. **User interaction** — present summaries, answer questions, gather
   feedback.
3. **Lightweight edits** — small, targeted changes to `plan.md` or
   `feedback.md` based on user discussion. Use `edit` tool directly.
4. **Feedback persistence** — write substantive user feedback to
   `feedback.md` before delegating.
5. **Reading plan files** — read `plan.md`, `feedback.md`, `changelog.md`
   to answer user questions or present summaries.

When `subagent` is available: **Do NOT** read large swathes of source code
or write full drafts yourself — delegate to scout/worker.

When `subagent` is unavailable: perform those tasks in-session, but keep
reads targeted and the output concise.

## Changelog Attribution Policy

Do **not** include model names in changelog entries by default.

Use simple entries:
- `Draft N — <YYYY-MM-DD>: ...`
- `Edit — <YYYY-MM-DD>: ...`
- `Review — <YYYY-MM-DD>: ...`
- `Approved — <YYYY-MM-DD>, user.`

## Invocation Modes

The `/skill:plan-methodology` command may include arguments:

- No args (or any non-review args): run **planning flow**.
- `review <plan-dir>`: run **review flow** for an existing plan package.

### Examples

```text
/skill:plan-methodology
/skill:plan-methodology plan migration for auth token refresh
/skill:plan-methodology review .pi/plans/2026-03-14-auth-token-refresh
```

## Plan Package (Directory Format)

All planning work is recorded in one directory:

- `.pi/plans/<yyyy-mm-dd>-<short-slug>/`

### File Naming Rules

- `yyyy-mm-dd` must be local current date in ISO format.
- `short-slug` must be lowercase kebab-case using only `[a-z0-9-]`.
- Keep slug concise (typically 3–8 words, max 60 chars).
- Do not create a new directory for revisions of the same task.

### Files in the Package

- `plan.md` — working implementation draft (what will be built).
- `feedback.md` — working user/reviewer notes and recommendations.
- `changelog.md` — lightweight ledger of significant events.
- `context.md` — scout findings (codebase context for drafting).

## Working vs Ledger Boundary (Mandatory)

- **Working files:** `plan.md`, `feedback.md`, `context.md`
- **Ledger file:** `changelog.md`

Rules:
- Use `plan.md` + `feedback.md` for planning decisions and edits.
- Keep only substantive, factual user/reviewer feedback in `feedback.md`.
- Do **not** log workflow-only chatter in `feedback.md`.
- Do **not** promote feedback into `plan.md` unless user explicitly asks.
- When feedback is incorporated/superseded/resolved, remove it from
  `feedback.md`.
- Keep `changelog.md` concise (one short line per entry).

## File Formats

### `plan.md`

The plan is the prompt. When the user runs `/build`, `plan.md` is sent
to the implementer as the kickoff prompt. Write it so a fresh agent in a
new context window can execute it without asking clarifying questions.

**Sizing:** Plans should target ~50% context window budget. If a plan
has more than ~5 implementation steps or touches more than ~8 files,
suggest splitting into two plans with a clear sequencing dependency.
This is guidance, not a hard rule.

```markdown
# <Plan Title>

## Goal

## Must-Haves
<!-- Observable truths: what must be TRUE from the user's perspective -->
<!-- Required artifacts: specific files that must exist -->
<!-- Key wiring: critical connections between artifacts
     (e.g. "LoginForm.tsx calls /api/auth/login via fetch in onSubmit") -->

## Context and Constraints

## Files and Components to Touch
<!-- explicit paths -->

## Implementation Plan
<!-- numbered steps, each with: what to do, which files, how to verify,
     and what "done" looks like. The specificity test: could a different
     agent execute this step without asking clarifying questions? -->

## Risks / Edge Cases

## Validation Checklist

## Open Questions
```

### `feedback.md`

```markdown
# Feedback

- User feedback: <factual constraint/decision/requested change>
- Reviewer finding: <factual risk or gap>
- Reviewer recommendation: <actionable fix>
```

`feedback.md` is an **active queue**, not a transcript.

### `changelog.md`

```markdown
# Changelog

- Draft 1 — <YYYY-MM-DD>: Initial plan.
- Edit — <YYYY-MM-DD>: <material change>.
- Review — <YYYY-MM-DD>: <RECOMMENDATION> — <summary>.
- Draft 2 — <YYYY-MM-DD>: <what was incorporated>.
- Approved — <YYYY-MM-DD>, user.
```

## Detailed Flows

### First Invocation — Draft 1

1. **Create the plan package directory** if missing. Initialise
   `feedback.md` and `changelog.md` with headers.
2. **Persist user context to `feedback.md`** — write concise, factual
   task constraints and preferences before scouting.
3. **Scout code context**:
   - Preferred: dispatch `scout` subagent; output to `<plan-dir>/context.md`.
   - Fallback (no subagent): scout in-session and write `context.md`.
4. **Create Draft 1**:
   - Preferred: dispatch `worker` subagent to read `context.md` +
     `feedback.md`, write `plan.md`, and append Draft 1 to `changelog.md`.
   - Fallback (no subagent): draft in-session and append Draft 1 yourself.
5. **Read `plan.md`** and present a summary to the user.
6. Stop and wait for user feedback.

### Discussion and Edits (within a draft)

1. **Read current `plan.md` + `feedback.md`** (if not already in context
   from this turn).
2. **Persist substantive feedback** to `feedback.md`. Skip workflow
   chatter. Prune resolved items.
3. For **small edits** the user explicitly requests: edit `plan.md`
   directly with the `edit` tool.
4. For **large revisions**:
   - Preferred: delegate to `worker` with specific instructions.
   - Fallback (no subagent): perform the revision in-session.
5. Add `Edit` entry to `changelog.md` if the change is material.
6. Stop and wait for user feedback.

### Review Pass

1. **Persist any user steering** to `feedback.md` (e.g. "focus on
   error handling").
2. **Run review**:
   - Preferred: dispatch `plan-reviewer` subagent with the plan directory.
   - Fallback (no subagent): review in-session and append findings to
     `feedback.md` and a `Review` entry to `changelog.md`.
3. **Read updated `feedback.md`** and present findings to user.
4. Stop and wait for user feedback.

### Incorporating Review Feedback — Draft N+1

1. **Persist any new user constraints** to `feedback.md`.
2. Confirm which feedback items to incorporate (user selects).
3. **Incorporate selected items**:
   - Preferred: dispatch `worker` with explicit list of items to
     incorporate.
   - Fallback (no subagent): incorporate in-session.
4. **Read updated `plan.md`** and present changes to user.
5. Stop and wait for user feedback.

### Subsequent Review Passes

Same as initial review. The `plan-reviewer` checks whether previous
findings were addressed and identifies new issues.

## Definition of Ready (for review recommendation)

1. Goal, scope, constraints are clear and non-contradictory.
2. Must-Haves state observable truths, required artifacts, and key
   wiring between them.
3. Files/components to touch are explicit and sufficient.
4. Implementation steps are ordered and actionable.
5. Risks/edge cases are identified with handling strategy.
6. Validation checklist has concrete checks and expected outcomes.
7. Open questions are resolved or explicitly non-blocking.
8. Scope is sized for a single context window (~5 steps, ~8 files).
9. Each implementation step has a verification criterion and names
   specific files — a different agent could execute it without
   clarifying questions.

## After Approval — Transition to Implementation

1. Record `Approved — <YYYY-MM-DD>, user.` in `changelog.md`.
2. Treat `plan.md` as the implementation spec.
3. Ask explicitly: *"Ready to start building? I'll follow the plan as
   written."*
4. Do not modify plan package files during implementation unless user
   explicitly asks.
