---
name: plan-mode
description: Iterative planning workflow for coding tasks. Creates an implementation plan package, then iterates through draft/review cycles with user feedback until the plan is approved.
compatibility: pi with /model command.
---

# Plan Mode (Iterative Planning Loop)

Use this skill when the user asks to plan work before implementing.

Treat this as **planning-only**. Do not implement code changes yet.

## Core Concept

Planning is an **iterative loop**, not a one-shot handoff. The user steers every transition.

```text
User provides task description
  ↓
Create plan package directory with:
  - plan.md (working draft)
  - feedback.md (working feedback)
  - changelog.md (ledger)
  ↓
Draft 1 (model investigates + writes plan.md)
  ↓
User feedback / discussion loop
  ├─ Discussion or questions (no edit request):
  │    → Add only substantive feedback facts to feedback.md
  │      (constraints, decisions, unresolved questions, reviewer findings)
  │    → Skip workflow-only notes (e.g. "review this", "draft v2")
  │    → Prune resolved/superseded items so feedback.md stays short
  │    → plan.md unchanged
  └─ Explicit edit request from user:
       → Revise plan.md in place
       → Add lightweight `Edit` entry to changelog.md only if change is material

User requests review (hands off to another model)
  ↓
Review pass
  → Write findings/recommendations to feedback.md
  → Do NOT edit plan.md unless user explicitly asks
  → Add `Review` entry to changelog.md
  ↓
User selects which feedback items to incorporate
  ↓
Draft 2 (incorporate ONLY selected items into plan.md)
  → Remove incorporated items from feedback.md
  → Keep unselected feedback in feedback.md
  → Add `Draft 2` entry to changelog.md
  ↓
Plan approved by user?
  ├─ no  → Start next draft/review cycle (Draft 3, 4, ...)
  └─ yes → Add `Approved` entry and ask: "Ready to start building?"
```

Never switch phases or models unless the user explicitly says so.

## Model Policy

There are no fixed model assignments. The user chooses model(s) via `/model`.

Every **model-authored** entry in `changelog.md` must include the exact active model name (without provider prefix).

Before writing each model-authored changelog entry, read the active model from `/model` in that turn and use it verbatim. Never guess, infer, copy from examples, or reuse a stale model name from an older entry. If the active model identifier is unavailable, stop and ask the user.

Approval entries are user-authored:
- `Approved — <YYYY-MM-DD>, user.`

If the user reports incorrect attribution, correct existing changelog lines before continuing.

## Invocation Modes

The `/skill:plan-mode` command may include arguments:

- No args (or any non-review args): run **planning flow**.
- `review <plan-dir>`: run **review flow** for an existing plan package directory.

### Examples

```text
/skill:plan-mode
/skill:plan-mode plan migration for auth token refresh
/skill:plan-mode review .pi/plans/2026-03-14-auth-token-refresh
```

Notes:
- Any invocation that does not start with the word `review` runs the planning flow.
- `review <plan-dir>` runs review flow for the specified existing plan package.

## Plan Package (Directory Format)

All planning work is recorded in one directory:

- `.pi/plans/<yyyy-mm-dd>-<short-slug>/`

### File Naming Rules

For `.pi/plans/<yyyy-mm-dd>-<short-slug>/`:

- `yyyy-mm-dd` must be local current date in ISO format (e.g. `2026-03-14`).
- `short-slug` must be lowercase kebab-case using only `[a-z0-9-]`.
- Keep slug concise and stable for the same task (typically 3–8 words, max 60 chars).
- Do not create a new directory for revisions of the same task; keep iterating in the same package.

### Files in the Package

- `plan.md` — working implementation draft (what will be built).
- `feedback.md` — working user/reviewer notes and recommendations (summarised).
- `changelog.md` — lightweight ledger of significant events and attribution.

`changelog.md` is a ledger, **not** a working planning surface.

## Working vs Ledger Boundary (Mandatory)

Maintain strict separation:

- **Working files:** `plan.md`, `feedback.md`
- **Ledger file:** `changelog.md`

Rules:
- Use `plan.md` + `feedback.md` for planning decisions and edits.
- Keep only substantive, factual user/reviewer feedback in `feedback.md`.
- Do **not** log workflow-only chatter in `feedback.md` (e.g. "review this", "draft v2").
- Do **not** promote feedback into `plan.md` unless the user explicitly asks.
- When feedback is incorporated, superseded, or resolved, remove it from `feedback.md` so only remaining items persist.
- Keep `changelog.md` concise (one short line per entry). No detailed analysis there.

## File Formats

### `plan.md`

```markdown
# <Plan Title>

## Goal

## Context and Constraints

## Files and Components to Touch
<!-- explicit paths -->

## Implementation Plan
<!-- numbered steps -->

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

`feedback.md` is an **active queue**, not a transcript. Keep only unresolved, actionable items.

### `changelog.md`

```markdown
# Changelog

- Draft 1 — <YYYY-MM-DD>, <model-name>: Initial plan.
- Edit — <YYYY-MM-DD>, <model-name>: <material in-draft change requested by user>.
- Review — <YYYY-MM-DD>, <model-name>: <RECOMMENDATION> — <1–2 line summary>.
- Draft 2 — <YYYY-MM-DD>, <model-name>: <what was incorporated>.
- Approved — <YYYY-MM-DD>, user.
```

## Updating the Plan Package

`feedback.md` is the **persistence mechanism** across turns and model switches. Context does not survive in chat history alone — if it's not written to a file, the next turn cannot see it.

When revising the package (as either model):

1. **Read `plan.md` and `feedback.md` first.** Context may be stale. Always re-read before acting.
2. **Persist only substantive feedback facts to `feedback.md` before substantive response.** Record constraints, decisions, objections, unresolved questions, reviewer findings/recommendations. Do not record workflow-only requests (e.g. "review this", "draft v2").
3. **Keep `feedback.md` short and active-only.** Remove resolved, incorporated, superseded, or duplicate items in the same turn.
4. If user explicitly asks for plan edits, update `plan.md` in place.
5. If user is discussing/questioning/reviewing without incorporation request, keep `plan.md` unchanged.
6. Never promote feedback into `plan.md` without explicit user instruction.
7. Append to `changelog.md` for: new draft creation, review completion, and material in-draft edits. Keep entries to one short line.
8. Skip changelog entries for tiny wording tweaks and discussion-only turns.
9. Keep `plan.md` concise. Aim for under ~200 lines in main sections (Goal through Open Questions). If larger, consolidate or split.

## Drafting Flow

### First Invocation — Draft 1

1. Read relevant source files and trace code paths.
2. Ask clarifying questions if requirements are ambiguous.
3. Create the plan package directory if missing. Initialise all three files with a Title Case header (e.g. `# Plan: <descriptive task title>`, `# Feedback`, `# Changelog`).
4. **Persist first**: append concise, factual task context to `feedback.md` (constraints, preferences, non-obvious requirements).
5. Prune `feedback.md` so only unresolved actionable items remain.
6. Write initial draft to `plan.md`.
7. Add `Draft 1` to `changelog.md` with date and exact active model name.
8. Stop and wait for user feedback.

### Discussion and Edits (within a draft)

1. Read current `plan.md` + `feedback.md`.
2. **Persist first (substance only)**: append concise factual feedback to `feedback.md` before doing anything else in that turn. Include only actionable facts; skip workflow chatter.
3. Prune `feedback.md` immediately so only unresolved items remain.
4. If user explicitly asks for edits, revise `plan.md`.
5. If edits materially change scope, sequencing, files/components, risks, or validation, append an `Edit` entry to `changelog.md`.
6. If user is discussing or asking questions, keep `plan.md` unchanged.
7. Stop and wait for user feedback.

Never assume draft is ready for review; user will explicitly request review.

### Incorporating Review Feedback — Draft N+1

1. Read current `plan.md` + `feedback.md`. (Do not read `changelog.md` for planning context — only append to it.)
2. **Persist first (if substantive)**: if the user adds new constraints/clarifications, record concise factual items in `feedback.md` before incorporating.
3. Incorporate only feedback items the user explicitly selected.
4. Remove incorporated/resolved/superseded items from `feedback.md`; keep only unresolved items.
5. Append next draft entry (`Draft N+1`) to `changelog.md` with exact model name and short incorporation summary.
6. Stop and wait for user feedback.

## Definition of Ready (for review recommendation)

Use this checklist for `READY | READY WITH NOTES | NEEDS REVISION`:

1. Goal, scope, constraints are clear and non-contradictory.
2. Files/components to touch are explicit and sufficient.
3. Implementation steps are ordered and actionable.
4. Risks/edge cases are identified with handling strategy.
5. Validation checklist has concrete checks and expected outcomes.
6. Open questions are resolved or explicitly non-blocking.

## Review Flow (`review <plan-dir>`)

Use this mode to stress-test and refine a plan package.

### Review Pass

1. Read `plan.md`, `feedback.md`, and critical referenced source files.
2. **Persist first (substance only)**: if the user provided substantive review steering (e.g. "focus on error handling"), add concise factual notes to `feedback.md` before evaluating. Skip workflow-only notes.
3. Evaluate for missing steps, assumptions, sequencing risk, edge cases, validation gaps, and simpler options.
4. Write review output:
   - Append findings/recommendations (summarised) to `feedback.md`.
   - Prune resolved/superseded/duplicate items so only unresolved feedback remains.
   - Do **not** modify `plan.md` unless user explicitly asks for incorporation in that turn.
   - Append a `Review` entry to `changelog.md` with exact model name, recommendation, and 1–2 line summary.
5. Stop and wait for user feedback.

User may then:
- Approve (`Approved — <YYYY-MM-DD>, user.`)
- Ask clarifying questions
- Select feedback to incorporate as next draft
- Switch models

### Subsequent Review Passes

After a new draft, each review pass should:

1. Read updated `plan.md` + `feedback.md`.
2. **Persist first (substance only)**: if the user provided new substantive steering/context, append concise factual notes to `feedback.md` before evaluating.
3. Check whether previous findings were addressed and whether new issues emerged.
4. Update `feedback.md` with current unresolved findings only (remove resolved/superseded items), then append a concise `Review` ledger line to `changelog.md`.
5. Stop and wait for user feedback.

## After Approval — Transition to Implementation

Once user approves the plan:

1. Record `Approved — <YYYY-MM-DD>, user.` in `changelog.md`.
2. Treat `plan.md` as the implementation spec.
3. Ask explicitly: *"Ready to start building? I'll follow the plan as written."*
4. Do not modify plan package files during implementation unless user explicitly asks.
