---
name: pi-swarm
description: Delegate tasks to subagent Pi instances or orchestrate swarms of cooperating Pi agents running in isolated tmux sessions. Pi MUST actively spawn subagents for large or parallelizable work instead of handling everything in the main session. For swarm workflows, spawn multiple Pi instances that coordinate peer-to-peer through Unix domain socket control channels (pi --session-control). Use for task delegation, parallel execution, context isolation, and multi-agent swarm coordination.
---

# Pi Swarm

Spawn and manage swarms of Pi instances — isolated subagents and cooperating
multi-agent swarms. Each swarm lives in its own tmux session; within a session,
each agent is a separate window. Agents communicate with the parent and each
other via Unix domain socket control channels.

## Architecture

```
tmux session "pi-swarm-explore"        tmux session "pi-swarm-build"
├─ window: rust-crates (agent)         ├─ window: implementer (agent)
├─ window: racket-source (agent)       └─ window: tester (agent)
├─ window: openspec-docs (agent)
└─ window: tools-scripts (agent)
```

Each agent:

- Runs `pi --session-control` (no initial prompt on CLI — prompt is sent via
  control socket after startup)
- Creates a control socket at `~/.pi/session-control/<session-id>.sock`
- Has its own isolated context window

Different swarms (different tasks/stages) go in different sessions. Within a
session, agents are windows — attach once and use `C-b n` / `C-b p` to switch
between them.

## Two Usage Patterns

### 1. Subagent Delegation (Parent → Workers)

Spawn one or more subagents to handle independent tasks. The parent delegates
work and collects results. Subagents don't need to talk to each other — the
parent coordinates everything.

All subagents for one task share a tmux session:

```bash
spawn.ts --session explore rust-crates "Explore the Rust crates..."
spawn.ts --session explore racket-source "Explore the Racket source..."
spawn.ts --session explore openspec-docs "Explore OpenSpec specs..."
```

### 2. Swarm Coordination (Peer-to-Peer)

Spawn multiple Pi instances that form a cooperative swarm within one session.
Agents communicate directly with each other through control channels. The parent
bootstraps the swarm by passing session IDs, then agents coordinate
autonomously.

## When Pi MUST Use Pi Swarm

Pi MUST delegate work to swarm members (rather than doing it in the main
session) when:

- **Parallelizable tasks**: Two or more independent tasks that can run at the
  same time (e.g., researching two different topics, implementing separate
  modules, linting and testing simultaneously).
- **Large multi-step tasks**: Complex work that benefits from a focused,
  isolated context window (e.g., a full feature implementation, a codebase-wide
  refactor, an investigation that reads many files).
- **Background work**: Long-running operations that shouldn't block the main
  session (e.g., running a test suite, building a project, fetching many URLs).
- **Context isolation**: Tasks that would clutter the main session's context
  with irrelevant detail (e.g., exploratory spikes, debugging a different
  component).
- **Division of labor**: Tasks that cleanly separate into different concerns
  (e.g., research vs implementation, frontend vs backend, writing tests vs
  writing code).
- **Swarm workflows**: Tasks where multiple agents benefit from peer-to-peer
  coordination (e.g., one agent researches while another implements, then they
  cross-validate each other's work).

Do NOT spawn swarm members for:

- Trivial one-shot operations (single `ls`, `cat`, `rg`)
- Tasks that need tight, sequential coordination with the main session
- Simple questions that can be answered in a single turn

**Default parallelism limit**: 3-5 concurrent swarm members to avoid resource
exhaustion.

## Communication Architecture

All communication uses Pi's control extension (in agent-stuff). Swarm members
are started with `--session-control`, which creates a Unix domain socket at
`~/.pi/session-control/<session-id>.sock`.

### Initial Prompt

The initial prompt is sent via the control socket after the agent starts — NOT
as a CLI argument to pi. This ensures reliable delivery regardless of prompt
length or special characters. `spawn.ts` handles this automatically.

### Parent → Swarm Member

Use the `send_to_session` tool:

```
send_to_session(sessionId: "<session-id>", action: "send", message: "...")
```

Add `wait_until: "turn_end"` to block until the member finishes its current
turn and receive the response. Use `wait_until: "agent_end"` to block until
the full agent loop completes (useful for multi-turn tasks). Both modes use the
subscribe-before-send pattern internally to avoid race conditions.

Use `action: "get_message"` to fetch just the last assistant message. Use
`action: "get_summary"` for an AI-generated summary of activity.

### Swarm Member → Parent

Every message sent via `send_to_session` automatically includes a
`<sender_info>` block with the sender's session ID and name. The member can
reply by using its own `send_to_session` tool with the parent's session ID found
in `<sender_info>`.

### Swarm Member ↔ Swarm Member (Peer-to-Peer)

Same mechanism. Pass all relevant session IDs to each swarm member in the
initial prompt so they can coordinate directly. Example initial prompt for a
swarm:

> "You are part of a Pi swarm. Your role: research authentication patterns. Your
> session ID is available in $PI_SESSION_ID. Swarm members: implementer at
> `<impl-session-id>`, tester at `<test-session-id>`. Use send_to_session to ask
> them questions and share findings. Coordinate autonomously — the parent does
> not need to relay messages."

## Event Synchronization

The control extension emits two events for subscribers:

- **`turn_end`** — fires after each individual turn (one LLM response + tool calls).
- **`agent_end`** — fires once when the full agent loop completes (all turns). Use for multi-turn tasks.

**Always subscribe before sending** to avoid race conditions:

```
1. write: { type: "subscribe", event: "agent_end" }
2. write: { type: "send", message: "..." }      // turn starts AFTER subscription is registered
3. read: wait for agent_end event
```

The server processes both commands synchronously before queuing the agent turn,
so the subscription is guaranteed to exist when the event fires.

`send_to_session` with `wait_until` and `send.ts --wait` both use this pattern
internally. `wait.ts` subscribes to `agent_end` with a `get_message` fallback
for the case where the agent already finished before connection (outputs a
warning when fallback is used).

## Scripts

All scripts live in `scripts/` and are written in TypeScript for Deno using the
[Effect-TS](https://effect.website/) framework for structured error handling,
resource safety, and composability. Run with
`deno run --allow-all scripts/<script>.ts`.

### spawn.ts — Spawn a new swarm member

```bash
deno run --allow-all scripts/spawn.ts [--tmux-socket <path>] [--cwd <path>] [--session <name>] <name> "<initial-prompt>"
```

Options:

- `--tmux-socket <path>` — Path to the tmux server socket (default: computed
  from `$PI_TMUX_SOCKET_DIR` or `$TMPDIR`)
- `--cwd <path>` — Working directory for the subagent (default: current
  directory of the parent process)
- `--session <name>` — Swarm session name. The tmux session is always
  `pi-swarm-<name>` (default: `default`, producing session `pi-swarm-default`).
  All agents spawned with the same `--session` share one tmux session.

Creates a window named `<name>` in the tmux session `pi-swarm-<session>`
(default: `pi-swarm-default`), starts `pi --session-control`, waits for the
control socket, then sends the initial prompt via the control socket. Outputs
JSON:

```json
{
  "sessionId": "abc123...",
  "sessionName": "researcher",
  "tmuxSession": "pi-swarm-explore",
  "windowName": "researcher",
  "tmuxSocket": "/tmp/pi-tmux-sockets/pi-swarm.sock",
  "controlSocket": "/home/user/.pi/session-control/abc123.sock",
  "cwd": "/home/user/project"
}
```

Store the `sessionId` — you'll need it for `send_to_session` calls.

**Working directory**: The `--cwd` flag sets the working directory for the tmux
window (via `tmux -c`). This is essential when the parent Pi is running inside a
git worktree or a specific project directory — the spawned subagent must start
in the same directory to access the project files. Default: inherits the
parent's CWD.

For very long prompts (>100KB), write the prompt to a temp file and pipe it, or
use `@file` syntax with pi.

### list.ts — List running swarm members

```bash
deno run --allow-all scripts/list.ts [--json] [--session <name>]
```

Shows all pi-swarm sessions and their agent windows grouped by session, with
attached control sockets. Pass `--json` for machine-readable output. Pass
`--session <name>` to show only one session.

### send.ts — Send a raw message to a control socket (for scripts/debugging)

```bash
deno run --allow-all scripts/send.ts <session-id> <message> [--mode steer|follow_up] [--wait]
```

Sends a message directly to a control socket. Use `--wait` to block until
`agent_end` using the subscribe-before-send pattern (see Event Synchronization).
The connection is managed via `acquireRelease` for guaranteed cleanup.

### kill.ts — Terminate a swarm member

```bash
deno run --allow-all scripts/kill.ts [--session <name>] <agent-name>
```

Kills the agent window. Accepts the window name (e.g., `researcher`) and
optionally the session with `--session`. If it was the last window in the
session, the session is also killed. Also sweeps orphaned symlinks in
`~/.pi/session-control/`.

### wait.ts — Wait for a swarm member to finish

```bash
deno run --allow-all scripts/wait.ts <session-id> [--timeout <seconds>]
```

Blocks until the agent completes all turns. Subscribes to `agent_end` with a
`get_message` fallback: if the agent already finished before connection, the
cached message is used (with a warning to stderr). Times out after the given
seconds (default 300). Call immediately after `spawn.ts` to minimize the race
window.

## Swarm Workflow Example

```bash
# ── Spawn agents in parallel ──────────────────────────────────────

deno run --allow-all scripts/spawn.ts --cwd /home/user/project --session explore researcher \
  "You are in a Pi swarm. Research best practices for Rust error handling."
# → {"sessionId":"abc-123","tmuxSession":"pi-swarm-explore","windowName":"researcher",...}

deno run --allow-all scripts/spawn.ts --cwd /home/user/project --session explore implementer \
  "You are in a Pi swarm. Implement error types in src/errors.rs. Coordinate with researcher at abc-123."
# → {"sessionId":"def-456","tmuxSession":"pi-swarm-explore","windowName":"implementer",...}

# ── Wait for results (subscribe-before-send atomic pattern) ───────
# wait.ts subscribes to agent_end FIRST, then the agent turn proceeds.
# If the agent already finished, the get_message fallback is used with a warning.

deno run --allow-all scripts/wait.ts abc-123
# → (researcher's final output)

deno run --allow-all scripts/wait.ts def-456
# → (implementer's final output)

# ── Follow-up with send_to_session ────────────────────────────────
# The send_to_session tool uses the same atomic subscribe-before-send pattern
# via sendRpcCommand(waitForEvent) — no race between send and subscribe.
#
# Pi should use: send_to_session(
#   sessionId: "abc-123",
#   action: "send",
#   message: "Can you also check async error handling?",
#   wait_until: "agent_end"
# )

# Or via the CLI script (also subscribe-before-send internally):
deno run --allow-all scripts/send.ts abc-123 "Check async error handling too" --wait
# → (researcher's response)

# ── Clean up ──────────────────────────────────────────────────────

deno run --allow-all scripts/kill.ts --session explore researcher
deno run --allow-all scripts/kill.ts --session explore implementer
# (session pi-swarm-explore is automatically killed when last window dies)
```

## Best Practices

1. **Always record session IDs** returned by `spawn.ts`. You need them for all
   subsequent communication.
2. **Use the `--session` flag** to group related agents. All agents for one task
   should share a session for easy monitoring.
3. **Pass `--cwd` when spawning in worktrees or specific project directories**.
   The subagent's working directory determines which files it can access.
   Default: inherits the parent's CWD.
4. **Provide clear, self-contained prompts**. Swarm members have their own
   context — tell them everything they need.
5. **For swarms, include full coordination instructions** in prompts. Pass all
   other members' session IDs and describe the communication topology.
6. **Choose the right pattern**: use simple delegation when the parent should
   coordinate; use swarm mode when agents should communicate peer-to-peer.
7. **Wait appropriately**:
   - Use `wait_until: "agent_end"` on `send_to_session` for multi-turn tasks,
     `"turn_end"` for single-response calls. Both use atomic subscribe-before-send.
   - `wait.ts <id>` blocks until the agent finishes (call right after `spawn.ts`).
   - Use `send_to_session` with `mode: "follow_up"` for fire-and-forget background messages.
8. **Clean up**. Always kill swarm members when their work is done.
9. **Limit parallelism**. Never spawn more than 5 members concurrently unless
   the user explicitly asks for massive parallelism.
10. **Verify liveness** before sending. Tmux sessions can die; use `list.ts` to
    confirm a member is still running.
11. **Handle failures gracefully**. If a member doesn't respond or its socket is
    gone, check the tmux pane output with
    `tmux capture-pane -t pi-swarm-<session>:<window>` and restart if needed.
12. **Close the swarm loop**: when a swarm's work is complete, have members
    report back to the parent with final results before being killed.
