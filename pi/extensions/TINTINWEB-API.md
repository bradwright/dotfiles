# @tintinweb/pi-subagents API Reference

> **Note:** API surface documented from source code analysis and plan
> documentation. Some details (RPC spawn options, event payload shape)
> should be validated after installation.

Package: `npm:@tintinweb/pi-subagents`

---

## Tool Names

The extension provides three tools:

| Tool | Purpose |
|------|---------|
| `Agent` | Spawn or resume a subagent |
| `get_subagent_result` | Retrieve results from a completed/background agent |
| `steer_subagent` | Send steering instructions to a running agent |

---

## Agent Tool Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `prompt` | Yes | string | Task prompt for the agent |
| `description` | Yes | string | Short description of what the agent does |
| `subagent_type` | Yes | string | Agent type name (e.g. `"Explore"`, `"plan-reviewer"`) |
| `model` | No | string | Model override (e.g. `"claude-sonnet-4"`) |
| `thinking` | No | string | Thinking level override |
| `max_turns` | No | number | Maximum turns for the agent |
| `run_in_background` | No | boolean | Run agent in background (for parallelism) |
| `resume` | No | boolean | Resume a previous agent session |
| `isolated` | No | boolean | Run in isolated context |
| `isolation` | No | string | Isolation mode (e.g. `"worktree"`) |
| `inherit_context` | No | boolean | Inherit parent context |

### Example

```
Agent({
  subagent_type: "plan-reviewer",
  prompt: "Review the plan package at .pi/plans/my-plan/",
  description: "Review plan for completeness",
  model: "claude-sonnet-4",
  thinking: "high",
})
```

---

## Event Bus

Events emitted by the extension (subscribe via `pi.events.on()`):

| Event | Description |
|-------|-------------|
| `subagents:ready` | Extension loaded and ready to accept commands |
| `subagents:created` | Agent instance created |
| `subagents:started` | Agent started execution |
| `subagents:completed` | Agent finished successfully |
| `subagents:failed` | Agent failed |
| `subagents:steered` | Steering instruction sent to agent |

---

## RPC Protocol

Cross-extension communication via `pi.events.emit()` / `pi.events.on()`.

### Commands

| RPC Event | Description |
|-----------|-------------|
| `subagents:rpc:ping` | Check if extension is alive |
| `subagents:rpc:spawn` | Spawn an agent programmatically |
| `subagents:rpc:stop` | Stop a running agent |

### Reply Envelope

All RPC replies follow this format:

```typescript
// Success
{ success: true, data?: T }

// Failure
{ success: false, error: string }
```

Replies are emitted on `<rpc-event>:reply:<requestId>`.

### RPC Spawn Example

```typescript
// Emit spawn request
pi.events.emit("subagents:rpc:spawn", {
  requestId: "unique-id",
  type: "plan-reviewer",
  prompt: "Review the plan package at <plan-dir>/",
  options: {
    description: "Review plan for completeness",
    model: "claude-sonnet-4",      // needs confirmation
    isolation: "worktree",         // needs confirmation
    thinking: "high",              // needs confirmation
  },
});

// Listen for reply
pi.events.on("subagents:rpc:spawn:reply:unique-id", (reply) => {
  if (reply.success) {
    console.log("Agent spawned:", reply.data.id);
  } else {
    console.error("Spawn failed:", reply.error);
  }
});
```

---

## Agent Frontmatter (`.md` files)

Supported fields in agent YAML frontmatter:

| Field | Description |
|-------|-------------|
| `description` | Agent description |
| `tools` | Comma-separated tool list |
| `model` | Default model |
| `thinking` | Thinking level |
| `max_turns` | Turn limit |
| `prompt_mode` | Prompt mode |
| `disallowed_tools` | Blocked tools |
| `memory` | Memory configuration |
| `isolation` | Isolation mode |
| `enabled` | Whether agent is enabled |

**Not tintinweb fields:** `name` (derived from filename) and `scope`
(derived from file location). These are silently ignored if present but
should be removed for cleanliness.

---

## Builtin Agents

| Name | Description |
|------|-------------|
| `general-purpose` | Default general-purpose agent |
| `Explore` | Codebase exploration (replaces nicobailon's `scout`) |
| `Plan` | Planning agent |

---

## Key Differences from nicobailon/pi-subagents

| Feature | nicobailon | tintinweb |
|---------|-----------|-----------|
| Tool name | `subagent` | `Agent` |
| Result tool | `subagent_status` | `get_subagent_result` |
| Slash command | `/run` | *(none — tool-driven only)* |
| Parallel mode | `{ tasks: [...] }` batch | Individual `Agent()` calls with `run_in_background: true` |
| Working directory | `cwd` parameter | `isolation: "worktree"` |
| Output file | `output` parameter | Include path in `prompt` string |
| Concurrency | Manual | Automatic queue (default 4) |
| Steering | Not available | `steer_subagent` tool |
| Scout agent | `scout` builtin | `Explore` builtin |
| Worker agent | `worker` builtin | *(none — create custom `writer`)* |
