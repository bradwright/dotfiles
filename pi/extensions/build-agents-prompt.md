# Multi-Agent Build Supervisor

Use this skill as an alternative to single-agent `/build`.

You are the **supervisor**. You orchestrate sub-agents, validate artifacts,
and stop for user decisions when needed.

## Workflow (fixed)

```text
Planner → Parallel Implementers → Auto-Reviewer → Merge Agent
```

## Non-negotiable rules

- Plan before coding.
- Break work into small independent tasks.
- One implementer per task.
- One branch/worktree per implementer.
- No direct implementer-to-implementer coordination.
- All coordination through artifacts.
- Review before merge.
- Fix review failures with corrective implementers.

## Artifacts

- Planner: `PLAN.md`
- Implementers: `RESULT.md`
- Reviewer: `REVIEW.md`
- Merge agent: `INTEGRATION.md`, `SUMMARY.md`

## Prerequisites

Before starting, verify all of these. Stop if any fail.

**Plan mode check:** If the current session is in plan mode (e.g. the user
triggered this skill via `/plan` or while a planning skill is active), STOP
immediately. Do not attempt any tool calls. Tell the user:

> This skill requires tool access (git, bash, file I/O) to orchestrate
> sub-agents. Please exit plan mode first, then invoke `/build-agents` in a
> normal session.

Only proceed once you can confirm tool access is available.

```bash
git diff --quiet && git diff --cached --quiet
BASE_BRANCH="$(git symbolic-ref --short HEAD)"
command -v pi
```

Set common paths once.

**When the extension launches a build**, it injects a `## Run Context` block
with `PI_BIN`, `RUN_ID`, `RUN_DIR`, etc. Use those values directly instead of
computing them. If running standalone (no extension), fall back to these:

```bash
ROOT="$(pwd)"
USER_GOAL="<short-user-goal>"
GOAL_SLUG="$(printf '%s' "$USER_GOAL" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | sed 's/--*/-/g; s/^-//; s/-$//' | cut -c1-30)"
RUN_ID="$(date +%Y-%m-%d)-${GOAL_SLUG:-run}"
RUN_DIR="$ROOT/.pi/build/$RUN_ID"
WORKTREE_ROOT="$ROOT/.pi/build/worktrees"
PI_BIN="${PI_BIN:-$(which pi)}"  # Extension provides PI_BIN; fall back to which
mkdir -p "$RUN_DIR/tasks" "$WORKTREE_ROOT"
```

---

## 1) Planner — Create implementer-ready `PLAN.md`

In this workflow, the planner does **task decomposition only**.

The output of the `/plan` extension (which runs the `plan` skill) is the required input. The planner must consume the approved `plan.md` from the `/plan` run, then break it into implementer-sized units.

If no approved plan artifact is available, stop and ask the user to run `/plan` first (or provide an explicit path to an existing approved `plan.md`).

### Inputs
- Approved plan artifact from `/plan`: `<plan-package>/plan.md`
- Optional context from `<plan-package>/feedback.md` and `changelog.md`
- Current branch (`$BASE_BRANCH`)

### Planner output (`$RUN_DIR/PLAN.md`)

```markdown
# Build Plan

Source: <path to approved plan.md>
Base branch: <branch>
Run ID: <run-id>

## Tasks

### task-1: <short title>
- Description: ...
- Files: ...
- Acceptance: ...
- Dependencies: none | task-N
- Plan step mapping: <which section/step from the /plan output this implements>

### task-2: ...
```

Task decomposition requirements:
- Decompose only the already-approved `/plan` work.
- Prefer disjoint file sets.
- If overlap is unavoidable, document dependencies explicitly.
- Keep tasks small and independently reviewable.
- Every task must map back to an explicit part of the `/plan` input.

Present `PLAN.md` to the user and wait for approval.

---

## 2) Parallel Implementers — Spawn one per task

For each task in `PLAN.md`:

### 2a. Create one branch/worktree per implementer

```bash
git worktree add "$WORKTREE_ROOT/<task-id>" -b "build/$RUN_ID/<task-id>"
```

### 2b. Write implementer prompt artifact

Write to:
`$RUN_DIR/tasks/<task-id>/prompt.md`

Prompt must instruct:
- Implement only that task.
- Do not communicate with other implementers.
- Modify only in the task worktree.
- Write `RESULT.md` in the worktree root before committing.
- Commit all changes (including `RESULT.md`) with message: `build($RUN_ID): <task-id> — <short title>`.

Required `RESULT.md` format:

```markdown
## Completed

## Files Changed
- `path` — summary

## Tests

## Notes
```

### 2c. Spawn implementers in parallel (from each worktree)

Use file-based PID tracking per task to remain POSIX compatible.

**CRITICAL — variable scoping with `&`:**

When a command is backgrounded with `&`, bash backgrounds the entire
preceding compound command — including any `&&`-chained assignments.
Those assignments then happen in the subshell, NOT the current shell,
so subsequent lines see empty variables (e.g. `$TASK_DIR` → empty →
`"$TASK_DIR/pid"` → `"/pid"` → "Read-only file system").

Rules:
1. Variable assignments MUST use `;` or newlines — NEVER `&&` or `\` continuations.
2. The redirect `> "$LOG_FILE"` is part of the backgrounded command, so
   `$LOG_FILE` must already be set in the current shell BEFORE that line.
3. When spawning multiple tasks, use unique variable names (or a loop) and
   capture `$!` immediately after each `&`.

Correct pattern for each task (copy exactly):

**CRITICAL — use `$PI_BIN` not bare `pi`:**
Backgrounded subshells (`&`) from bash tool calls lose the parent PATH.
The extension injects `PI_BIN` in the Run Context block — always use it.

```bash
TASK_ID="<task-id>"
TASK_DIR="$RUN_DIR/tasks/$TASK_ID"
WORKTREE_DIR="$WORKTREE_ROOT/$TASK_ID"
PROMPT_FILE="$TASK_DIR/prompt.md"
LOG_FILE="$TASK_DIR/stdout.log"

( cd "$WORKTREE_DIR" && "$PI_BIN" -p --no-session --no-skills \
    --append-system-prompt "$PROMPT_FILE" \
    "Implement the assigned task, write RESULT.md in the repository root, and commit all changes (including RESULT.md) with: build($RUN_ID): <task-id> — <short title>." \
) > "$LOG_FILE" 2>&1 &
echo $! > "$TASK_DIR/pid"
```

Never emit this pattern (it is WRONG):
```bash
# WRONG — && chains assignments into the backgrounded group
TASK_DIR="..." && \
WORKTREE_DIR="..." && \
( ... ) > "$LOG_FILE" 2>&1 &
```

Launch all dependency-free tasks this way. For dependent tasks, wait until prerequisites are approved.

### 2d. Wait and record per-task exit status

```bash
for TASK_DIR in "$RUN_DIR/tasks"/*; do
  [ -f "$TASK_DIR/pid" ] || continue
  TASK_ID="$(basename "$TASK_DIR")"
  PID="$(cat "$TASK_DIR/pid")"
  
  if wait "$PID"; then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi
  printf "%s\n" "$EXIT_CODE" > "$TASK_DIR/exit_code.txt"
done
```

### 2e. Collect `RESULT.md` and diffs

For each task:

```bash
TASK_ID="<task-id>"
TASK_DIR="$RUN_DIR/tasks/$TASK_ID"
WORKTREE_DIR="$WORKTREE_ROOT/$TASK_ID"

cp "$WORKTREE_DIR/RESULT.md" "$TASK_DIR/RESULT.md"
git -C "$WORKTREE_DIR" diff "$BASE_BRANCH" -- . > "$TASK_DIR/diff.patch"
```

If implementer failed or `RESULT.md` is missing, keep `stdout.log` and mark task as failed for corrective handling.

---

## 3) Auto-Reviewer — Produce `REVIEW.md`

For each task, create reviewer prompt with:
- Task description + acceptance criteria from `PLAN.md`
- `RESULT.md`
- `diff.patch`

Reviewer must output:

```markdown
## Verdict
PASS | PASS_WITH_NOTES | FAIL

## Findings
- ...

## Required fixes (if FAIL)
- ...
```

Spawn reviewer subprocess:

```bash
"$PI_BIN" -p --no-session --no-skills \
  --append-system-prompt "$RUN_DIR/tasks/<task-id>/review-prompt.md" \
  "Review this task implementation against acceptance criteria."
```

Save raw output to `review-stdout.log`, then normalize into:
`$RUN_DIR/tasks/<task-id>/REVIEW.md`.

Do not merge any task without a review verdict.

---

## 4) Corrective implementers for review failures

For each task with `FAIL`:

1. Write corrective prompt with:
   - original task
   - reviewer findings
   - required fixes
2. Re-run implementer in the **same worktree/branch**.
3. Re-run auto-reviewer.
4. Max 2 corrective rounds.

If still failing after round 2:
- mark task as not approved
- do not merge it
- report to user and wait for decision

---

## 5) Merge Agent — Merge approved work and integrate artifacts

Merge-agent stage handles only tasks with `PASS` or `PASS_WITH_NOTES`.

### 5a. Merge approved branches in dependency order

```bash
git merge --no-ff "build/$RUN_ID/<task-id>" \
  -m "build($RUN_ID): <task-id> — <short title>"

# Remove the task artifact from the merged tree
git rm -f --ignore-unmatch RESULT.md
git diff --cached --quiet || git commit -m "build($RUN_ID): remove RESULT.md from <task-id>"
```

If conflict is non-trivial, stop and ask user.

### 5b. Write `INTEGRATION.md`

Path: `$RUN_DIR/INTEGRATION.md`

Include:
- run id
- base branch
- merged tasks
- not merged tasks + reason
- conflict notes/resolutions

### 5c. Write `SUMMARY.md`

Path: `$RUN_DIR/SUMMARY.md`

Include:
- counts: total / merged / failed
- high-level changes
- files modified
- verification checklist
- failed tasks and blockers

### 5d. Cleanup worktrees/branches

```bash
git worktree remove "$WORKTREE_ROOT/<task-id>" --force
git branch -d "build/$RUN_ID/<task-id>"
rmdir "$WORKTREE_ROOT" 2>/dev/null || true
```

---

## Execution order (must follow exactly)

1. Create `PLAN.md`
2. Spawn parallel implementers
3. Collect `RESULT.md`
4. Review diffs and artifacts
5. If needed, spawn corrective implementers
6. Merge approved work
7. Produce `SUMMARY.md`

## Coordination policy

- Implementers never coordinate directly.
- Reviewer only sees task artifacts and diffs.
- Merge decisions are based on `PLAN.md` + `REVIEW.md` verdicts.
- Artifact chain is the single source of truth.

## Stop and ask user when

- Plan not approved
- Ambiguous task boundaries
- Unclear merge conflict resolution
- Any task fails after 2 corrective rounds
