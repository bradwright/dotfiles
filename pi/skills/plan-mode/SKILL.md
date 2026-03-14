---
name: plan-mode
description: Iterative planning workflow for coding tasks. Creates an implementation plan in a markdown file, then iterates through numbered revisions (potentially across different models) with user feedback at every step until the plan is approved. Use when the user wants to plan work before implementing.
compatibility: pi with /model command.
---

# Plan Mode (Iterative Planning Loop)

Use this skill when the user asks to plan work before implementing.

Treat this as **planning-only**. Do not implement code changes yet.

## Core Concept

Planning is an **iterative loop**, not a one-shot handoff. The plan file is a living document. Each model reads the current state of the plan, writes its findings into it, and the user steers until satisfied.

```
┌──────────────────────────────────────────────┐
│  User provides task description               │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  Draft 1.0: Model A investigates & drafts    │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  User: reviews, comments, asks for changes   │◄──┐
└──────────────────┬───────────────────────────┘   │
                   ▼                                │
          ┌─────────────────┐                       │
          │ Ready for       │── no ─────────────────┘
          │ review?         │   Draft 1.1, 1.2, …
          └────────┬────────┘   (Model A revises)
                   │ yes
                   ▼
┌──────────────────────────────────────────────┐
│  User switches to Model B for review         │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  Review: Model B evaluates plan, writes      │
│  findings into the plan file                 │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  User: picks which feedback to act on        │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  Draft 2.0: Model B incorporates chosen      │
│  feedback into the plan                      │
└──────────────────┬───────────────────────────┘
                   ▼
          ┌─────────────────┐
          │ Plan approved?  │── no ── (back to top:
          │                 │    new draft/review cycle
          └────────┬────────┘    with Draft 3.0, etc.)
                   │ yes
                   ▼
           Plan is approved.
```

The user drives every transition. Never switch phases or models without the user explicitly saying so.

## Model Policy

There are no fixed model assignments. The user chooses which model to use for each revision via `/model`. Any model can draft, revise, or review. The revision number and model name are recorded in the Revision History so the sequence is always clear.

## Invocation Modes

The `/skill:plan-mode` command may include arguments:

- No args (or any non-review args): run **planning flow**.
- `review <plan-file>`: run **review flow** for an existing plan file.

Either mode may be invoked multiple times as the plan iterates.

## The Plan File

All planning work is recorded in a single file:

- `.pi/plans/<yyyy-mm-dd>-<short-slug>.md`

This file is the **source of truth**. Every model reads it before acting and writes its findings back into it. The user can also edit it directly between rounds.

### Plan File Format

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

## Revision History
<!-- append-only log using major.minor versioning -->
<!-- Major bumps (2.0, 3.0) when review feedback is incorporated -->
<!-- Minor bumps (1.1, 1.2) for draft iterations within a cycle -->

### Draft 1.0 — <date>, by <model-name>
- Initial plan drafted.

### Draft 1.1 — <date>, by <model-name>
- <user feedback addressed, what changed>

### Review — <date>, by <model-name>
- <findings, approval state>

### Draft 2.0 — <date>, by <model-name>
- Incorporated review feedback: <what changed>
```

### Updating the Plan File

When revising the plan (as either model):

1. **Read the current plan file first.** Your context may be stale — the other model or the user may have changed it.
2. **Update the relevant sections in place** — don't append a second "Implementation Plan" section; revise the existing one.
3. **Append to the Revision History** with the correct version (minor bump for draft iterations, major bump when incorporating review feedback), today's date, and your model name, summarising what you changed and why.
4. Keep the plan concise but executable. Don't let it bloat across iterations.

## Drafting Flow

### First Invocation — Draft 1.0

1. Read relevant files, trace code paths. Use read-only investigation.
2. Ask clarifying questions when requirements are ambiguous.
3. Write the initial plan file with all sections above. Record this as **Draft 1.0** in the Revision History, including today's date and your model name.
4. **Stop and wait for user feedback.** Summarise what you wrote and ask if they want changes.

### Minor Revisions — Draft 1.1, 1.2, …

The user has comments or questions about the current draft. Each time:

1. **Read the current plan file** — it may have been updated since your last turn.
2. Address the user's feedback. Revise plan sections in place.
3. Append the next minor version (e.g. Draft 1.1 → 1.2) to Revision History with your model name.
4. **Stop and wait for user feedback.** Summarise what changed.

Never assume the draft is ready for review. The user will explicitly say when they want to send it for review.

### Incorporating Review Feedback — Draft N+1.0

After a review, the user will tell you which feedback to act on. This may happen on a different model than the original draft:

1. **Read the current plan file** — it contains the review findings.
2. Incorporate the user's chosen feedback. Revise plan sections in place.
3. Append the next major version (e.g. Draft 1.x → Draft 2.0) to Revision History with your model name.
4. **Stop and wait for user feedback.** Summarise what changed and whether you think it's ready for another review or approval.

## Review Flow (`review <plan-file>`)

Use this mode to stress-test and refine a plan. Any model can review.

### Review Pass

1. **Read the plan file and critical referenced source files.**
2. Evaluate the plan for:
   - Missing steps or hidden assumptions
   - Architectural or sequencing risks
   - Edge cases and failure modes
   - Test/validation gaps
   - Simpler alternatives when appropriate
3. **Write findings into the plan file:**
   - Update relevant sections if you find concrete issues (e.g. a missing file in "Files to Touch").
   - Append a **Review** entry to Revision History with your model name and findings.
4. End with an approval state in the Revision History entry:
   - `APPROVED` — ready to execute
   - `APPROVED WITH NOTES` — minor issues noted but not blocking
   - `NEEDS REVISION` — significant issues, should go back for another drafting pass
5. **Stop and wait for user feedback.** Summarise your findings. The user may:
   - Ask clarifying questions to understand your findings before deciding — answer them without modifying the plan.
   - Tell you which feedback to act on — incorporate it as the next major draft (Draft N+1.0).
   - Switch to another model to incorporate the feedback.

### Subsequent Review Passes

The user may send the plan back for another review after a new major draft. Each time:

1. **Read the current plan file** — it has been updated since your last review.
2. Focus on whether previous findings were addressed and whether new issues emerged.
3. Update the plan file and append a new Review entry to Revision History.
4. **Stop and wait for user feedback.**
