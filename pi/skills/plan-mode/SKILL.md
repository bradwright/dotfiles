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
  │    → Append verbatim notes to feedback.md
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

Every **model-authored** entry in `changelog.md` must include the exact active model name (without provider prefix). Never guess or substitute a model name. If unavailable, stop and ask the user.

Approval entries are user-authored:
- `Approved — <YYYY-MM-DD>, user.`

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
- `feedback.md` — working user/reviewer notes and recommendations (verbatim).
- `changelog.md` — lightweight ledger of significant events and attribution.

`changelog.md` is a ledger, **not** a working planning surface.

## Working vs Ledger Boundary (Mandatory)

Maintain strict separation:

- **Working files:** `plan.md`, `feedback.md`
- **Ledger file:** `changelog.md`

Rules:
- Use `plan.md` + `feedback.md` for planning decisions and edits.
- Keep discussion/recommendations in `feedback.md` verbatim.
- Do **not** promote feedback into `plan.md` unless the user explicitly asks.
- When feedback is incorporated into a new draft, remove the incorporated items from `feedback.md`.
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
# Feedback / Discussion (Verbatim)

- User note (verbatim): "..."
- Reviewer recommendation (verbatim): "..."
```

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

When revising the package (as either model):

1. **Read `plan.md` and `feedback.md` first.** Context may be stale.
2. If user explicitly asks for plan edits, update `plan.md` in place.
3. If user is discussing/questioning/reviewing without incorporation request, append notes to `feedback.md` and keep `plan.md` unchanged.
4. Never promote feedback into `plan.md` without explicit user instruction.
5. Append to `changelog.md` for: new draft creation, review completion, and material in-draft edits. Keep entries to one short line.
6. Skip changelog entries for tiny wording tweaks and discussion-only turns.
7. Keep `plan.md` concise. Aim for under ~200 lines in main sections (Goal through Open Questions). If larger, consolidate or split.

## Drafting Flow

### First Invocation — Draft 1

1. Read relevant source files and trace code paths.
2. Ask clarifying questions if requirements are ambiguous.
3. Create the plan package directory if missing. Initialise all three files with a Title Case header (e.g. `# Plan: <descriptive task title>`, `# Feedback`, `# Changelog`).
4. Write initial draft to `plan.md`.
5. Add `Draft 1` to `changelog.md` with date and exact active model name.
6. Stop and wait for user feedback.

### Discussion and Edits (within a draft)

1. Read current `plan.md` + `feedback.md`.
2. If user explicitly asks for edits, revise `plan.md`.
3. If edits materially change scope, sequencing, files/components, risks, or validation, append an `Edit` entry to `changelog.md`.
4. If user is discussing or asking questions, append verbatim notes to `feedback.md` and keep `plan.md` unchanged.
5. Stop and wait for user feedback.

Never assume draft is ready for review; user will explicitly request review.

### Incorporating Review Feedback — Draft N+1

1. Read current `plan.md` + `feedback.md`. (Do not read `changelog.md` for planning context — only append to it.)
2. Incorporate only feedback items the user explicitly selected.
3. Remove incorporated items from `feedback.md`. Unselected items stay — the user may approve the plan with unresolved feedback if they judge it non-blocking.
4. Append next draft entry (`Draft N+1`) to `changelog.md` with exact model name and short incorporation summary.
5. Stop and wait for user feedback.

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
2. Evaluate for missing steps, assumptions, sequencing risk, edge cases, validation gaps, and simpler options.
3. Write review output:
   - Append findings/recommendations (verbatim) to `feedback.md`.
   - Do **not** modify `plan.md` unless user explicitly asks for incorporation in that turn.
   - Append a `Review` entry to `changelog.md` with exact model name, recommendation, and 1–2 line summary.
4. Stop and wait for user feedback.

User may then:
- Approve (`Approved — <YYYY-MM-DD>, user.`)
- Ask clarifying questions
- Select feedback to incorporate as next draft
- Switch models

### Subsequent Review Passes

After a new draft, each review pass should:

1. Read updated `plan.md` + `feedback.md`.
2. Check whether previous findings were addressed and whether new issues emerged.
3. Append review findings to `feedback.md` and a concise `Review` ledger line to `changelog.md`.
4. Stop and wait for user feedback.

## After Approval — Transition to Implementation

Once user approves the plan:

1. Record `Approved — <YYYY-MM-DD>, user.` in `changelog.md`.
2. Treat `plan.md` as the implementation spec.
3. Ask explicitly: *"Ready to start building? I'll follow the plan as written."*
4. Do not modify plan package files during implementation unless user explicitly asks.
