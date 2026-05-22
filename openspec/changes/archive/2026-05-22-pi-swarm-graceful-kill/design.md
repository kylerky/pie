## Context

The pi-swarm skill's `kill.ts` currently terminates agents by calling `tmux kill-window`, which sends SIGHUP to the pi process. This is a hard termination — the session doesn't flush, the control socket becomes stale (cleaned up later by orphan symlink sweep), and any child processes spawned via pi's tools may survive.

Pi runs in interactive TUI mode inside the tmux window. Its TUI has two relevant keybindings:
- `app.interrupt` — bound to `Escape` — cancels/aborts in-flight work
- `app.exit` — bound to `Ctrl+D` — exits the TUI when the editor is empty

These keybindings work at the application layer: `app.exit` calls `session.dispose()`, flushes the session file, closes the control socket, and exits cleanly. When the pi process exits, the tmux window self-closes since the window's command (`pi --session-control`) has completed.

There is no `exit` or `quit` command in pi's session-control socket protocol, and adding one is out of scope for this change.

## Goals / Non-Goals

**Goals:**

- Make `kill.ts` attempt a graceful shutdown before falling back to hard kill
- Use only existing TUI keybindings (`Escape` + `C-d`) — no changes to pi
- Add `--force` flag to preserve the current hard-kill behavior
- Add configurable timeout for the graceful phase
- Keep backward compatibility: same CLI interface, same JSON output, same exit codes

**Non-Goals:**

- Adding new control socket commands to pi
- Final state capture or session summarization before kill
- Tracking or reaping orphaned child processes
- Changing `spawn.ts`, `wait.ts`, or any other swarm script
- Handling concurrent kills (callers are responsible for serialization)

## Decisions

### Decision 1: Use C-d via tmux send-keys instead of signals

**Chosen**: Send `Escape` then `C-d` using `tmux send-keys -t session:window`

**Rationale**: Pi's TUI natively handles these keys — `Escape` to abort, `C-d` to exit. This triggers the same cleanup path as a human typing C-d in the terminal. Signals (SIGTERM, SIGINT, SIGHUP) are unreliable: pi doesn't have signal handlers for graceful shutdown, Node.js signal handling is async and fragile, and there's no guarantee the session flushes.

**Alternatives considered**:
- *SIGTERM/SIGINT*: Rejected — pi has no signal handlers, would be identical to SIGHUP (hard kill)
- *Control socket "quit" command*: Rejected — requires changes to pi's session-control protocol, which is out of scope
- *Sending `exit` text through the editor*: Rejected — too fragile (what if editor has text, what if pi is processing)

### Decision 2: Two-phase shutdown (graceful → hard fallback)

**Chosen**: Phase 1 sends keystrokes and polls for window death. If the window is still alive after timeout, Phase 2 calls `tmux kill-window`.

**Rationale**: C-d may not work if pi is in a state where the editor doesn't have focus (e.g., tree view, model selector, or a custom extension overlay). Escape should close overlays, but some extension UIs may not handle Escape gracefully. The fallback ensures termination is guaranteed.

```
Phase 1 (graceful, up to timeout):
  tmux send-keys Escape   → abort any in-flight work
  sleep 500ms
  tmux send-keys C-d       → exit the TUI
  poll: tmux list-windows -F "#{window_name}" → check if window exists
  if window gone within timeout → DONE

Phase 2 (hard fallback):
  tmux kill-window         → SIGHUP to anything still alive
  sweep orphaned symlinks  → existing cleanup logic
```

### Decision 3: Window liveness detection via tmux list-windows

**Chosen**: Poll for the window's existence using `tmux list-windows -t session -F "#{window_name}"`. If the window name no longer appears, pi exited and the window self-closed.

**Rationale**: Simpler than checking for pi's process (no /proc dependency), and directly answers the question we care about: did the window close? Uses the existing `shRaw` pattern from `lib/common.ts`.

**Alternative considered**:
- *Check control socket liveness*: Rejected — the socket may become stale before the process actually exits; timing is unpredictable

### Decision 4: Default timeout of 5 seconds

**Chosen**: 5 seconds for the graceful phase, configurable via `--timeout <seconds>`.

**Rationale**: Pi typically exits within 1-2 seconds of receiving C-d (flush session, close socket, exit). 5 seconds gives headroom for slow filesystems or session compaction. Callers who want to wait longer (or not at all) can override.

### Decision 5: --force flag preserves old behavior

**Chosen**: `--force` skips Phase 1 entirely and calls `tmux kill-window` directly.

**Rationale**: Callers who want the old behavior (immediate termination) use `--force`. The default behavior changes to graceful. This is a conscious tradeoff: new users get safe behavior by default, existing scripts add `--force` if the latency is undesirable.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Agent is in tree view or overlay**: C-d is consumed as `app.tree.filter.default` instead of `app.exit` | Escape first (closes overlays, returns to editor), then C-d works. If still stuck, timeout → hard kill. |
| **Agent is mid-LLM-stream**: C-d is ignored (editor not focused) | Escape first aborts the stream, editor gets focus, then C-d exits |
| **Extension overrides C-d keybinding**: C-d doesn't trigger exit | Custom keybindings are project-level. Swarm agents use minimal config. If still broken, timeout → hard kill. |
| **Race: agent received a new steer message between Escape and C-d**: Agent starts processing again | After Escape, agent is idle. C-d arrives before any new prompt is accepted (editor empty). Window of vulnerability is ~500ms (the sleep). If a steer arrives exactly then, the agent won't start processing until the current "turn" is complete — but C-d exits immediately so no race. |
| **Slow session flush**: Agent hangs on file I/O | Timeout catches this. Hard kill as fallback. Session file may be partially written (same as current behavior). |
| **Tmux socket unavailable**: `send-keys` fails | Catch the error, fall through to Phase 2 (`kill-window` may also fail, but that's expected) |
| **Default behavior change**: Existing scripts relying on immediate kill now have a 5s delay | Document the `--force` flag. Users who need instant kill add `--force`. |

## Open Questions

- **Should the sleep between Escape and C-d be configurable?** Currently 500ms is hardcoded. Seems adequate for aborting an LLM stream or tool execution. Could be exposed as `--grace-delay <ms>` if needed.
- **Should we send Escape multiple times?** Some TUI states (like a nested dialog) might need two Escapes (close dialog, then abort). Starting with one and relying on timeout + hard fallback seems simpler. Can iterate if this proves insufficient.