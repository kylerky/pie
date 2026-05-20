---
name: pi-swarm
description: Delegate tasks to subagent Pi instances or orchestrate swarms of cooperating Pi agents running in isolated tmux sessions. Pi MUST actively spawn subagents for large or parallelizable work instead of handling everything in the main session. For swarm workflows, spawn multiple Pi instances that coordinate peer-to-peer through Unix domain socket control channels (pi --session-control). Use for task delegation, parallel execution, context isolation, and multi-agent swarm coordination.
---

# Pi Swarm

Spawn and manage Pi instances as tmux windows grouped in sessions. Each agent
runs `pi --session-control`, creates a socket at
`~/.pi/session-control/<session-id>.sock`, and has its own isolated context. The
initial prompt is sent via the control socket after startup (not as a CLI
argument).

```
tmux session "pi-swarm-explore"        tmux session "pi-swarm-build"
├─ window: rust-crates (agent)         ├─ window: implementer (agent)
├─ window: racket-source (agent)       └─ window: tester (agent)
├─ window: openspec-docs (agent)
└─ window: tools-scripts (agent)
```

## Two Usage Patterns

**1. Subagent Delegation (Parent → Workers):** Spawn subagents for independent
tasks. The parent coordinates everything. All subagents for one task share a
tmux session:

```bash
spawn.ts --session explore rust-crates "Explore the Rust crates..."
spawn.ts --session explore racket-source "Explore the Racket source..."
```

Wait for the subagents to finish using `wait.ts`, which produces the results.

**2. Swarm Coordination (Peer-to-Peer):** Spawn cooperating agents within one
session. Agents communicate directly through control channels. Parent bootstraps
by passing session IDs.

## When Pi MUST Use Pi Swarm

Pi MUST delegate to swarm members (not the main session) for: parallelizable
tasks, large multi-step work, background operations, context isolation, division
of labor, and swarm coordination.

Do NOT spawn swarm members for: trivial one-shot operations, tightly sequential
tasks, or simple single-turn questions.

**Default parallelism limit**: 3-5 concurrent members.

## Communication Architecture

Use `send_to_session` for parent→member communication:

```
send_to_session(sessionId: "<id>", action: "send", message: "...")
```

Add `wait_until: "turn_end"` for single-response calls, `"agent_end"` for
multi-turn tasks. Use `action: "get_message"` for the last assistant message,
`"get_summary"` for an AI summary. Members receive a `<sender_info>` block with
the parent's session ID and can reply with their own `send_to_session`.

For peer-to-peer swarms, pass all session IDs in initial prompts so agents
coordinate autonomously.

### Timeout Handling (Two-Wait Pattern)

When a `wait_until` or `wait.ts` call times out, **do not immediately steer**:

1. **Verify liveness** — `list.ts` or check tmux session. If dead, handle
   normally.
2. **Second wait** — if the agent is still alive, wait again with a similar
   timeout. The agent may just need more time.
3. **Steer only after two timeouts** — use
   `send_to_session(...,
   mode: "steer")` with a short wait (e.g.,
   `wait_until: "turn_end"`).

## Event Synchronization

Events: **`turn_end`** (after one LLM response + tool calls), **`agent_end`**
(after all turns). Always subscribe before sending:

```
1. write: { type: "subscribe", event: "agent_end" }
2. write: { type: "send", message: "..." }
3. read: wait for agent_end event
```

`wait.ts` subscribes to `agent_end` with a `get_message` fallback for agents
that already finished before connection.

## Scripts

All in `scripts/`, TypeScript/Deno with Effect-TS. Run with
`deno run --allow-all scripts/<script>.ts`.

**spawn.ts** — Spawn a swarm member:

```bash
deno run --allow-all spawn.ts [--tmux-socket <path>] [--cwd <path>] [--session <name>] <name> "<prompt>"
```

Options: `--tmux-socket` (path to tmux socket), `--cwd` (working dir, default:
parent CWD), `--session` (group name, pfx `pi-swarm-`, default: `default`).
Outputs JSON:
`{ sessionId, sessionName, tmuxSession, windowName, tmuxSocket,
controlSocket, cwd }`.
Store `sessionId` for later communication. For long prompts (>100KB), write to a
temp file or use `@file`.

**list.ts** — List running members:

```bash
deno run --allow-all list.ts [--json] [--session <name>]
```

**send.ts** — Send a message (for scripts/debugging):

```bash
deno run --allow-all send.ts <session-id> <message> [--mode steer|follow_up] [--wait]
```

`--wait` blocks until `agent_end` using subscribe-before-send.

**kill.ts** — Terminate a member:

```bash
deno run --allow-all kill.ts [--session <name>] <agent-name>
```

Kills the window. Last window kills the session. Sweeps orphaned symlinks.

**wait.ts** — Wait for completion:

```bash
deno run --allow-all wait.ts <session-id> [--timeout <seconds>]
```

Blocks until all turns complete (default timeout: 300s). Pay attention to wait
in the foreground.

## Swarm Workflow Example

```bash
# Spawn agents
deno run --allow-all spawn.ts --cwd /home/user/project --session explore researcher \
  "You are in a Pi swarm. Research best practices for Rust error handling."
# → {"sessionId":"abc-123", ...}

deno run --allow-all spawn.ts --cwd /home/user/project --session explore implementer \
  "You are in a Pi swarm. Implement error types in src/errors.rs. Coordinate with researcher at abc-123."
# → {"sessionId":"def-456", ...}

# Wait for results
deno run --allow-all wait.ts abc-123
deno run --allow-all wait.ts def-456

# On timeout: verify liveness, wait again, steer only as last resort
deno run --allow-all wait.ts def-456 --timeout 300  # times out
deno run --allow-all list.ts --session explore       # still alive → wait again
deno run --allow-all wait.ts def-456 --timeout 320  # second wait
# Only after second timeout, steer:
# deno run --allow-all send.ts def-456 "Any blockers?" --mode steer --wait

# Follow-up
deno run --allow-all send.ts abc-123 "Check async error handling too" --wait

# Clean up
deno run --allow-all kill.ts --session explore researcher
deno run --allow-all kill.ts --session explore implementer
```

## Best Practices

1. **Record session IDs** from `spawn.ts` for all subsequent communication.
2. **Use `--session`** to group related agents; `--cwd` for worktrees/specific
   dirs.
3. **Provide self-contained prompts** — swarm members have isolated context.
4. **For swarms, include coordination instructions** — pass all member session
   IDs.
5. **Choose the right pattern** — delegation when parent coordinates, swarm when
   agents communicate peer-to-peer.
6. **Wait appropriately** — `wait_until: "agent_end"` for multi-turn,
   `"turn_end"` for single-response, `follow_up` for fire-and-forget. **On
   timeout, wait a second time** before steering. See "Timeout Handling."
7. **Clean up** — kill members when done; never exceed 5 concurrent.
8. **Verify liveness** with `list.ts` before sending. On failure, check pane
   output with `tmux capture-pane -t pi-swarm-<session>:<window>`.
9. **Close the swarm loop**
