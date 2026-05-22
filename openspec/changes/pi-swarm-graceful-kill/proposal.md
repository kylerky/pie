## Why

Currently `kill.ts` terminates swarm agents with `tmux kill-window`, sending SIGHUP directly to the pi process. This is a brute-force termination: the pi session doesn't flush, the control socket becomes stale, and any child processes may be orphaned. By leveraging pi's built-in `app.exit` TUI keybinding (Ctrl+D), we can trigger a graceful shutdown before falling back to the hard kill — making cleanup reliable without changing pi's session-control protocol.

## What Changes

- **`kill.ts` attempts graceful shutdown first**: Sends `Escape` (abort in-flight work) then `C-d` (exit the TUI) via `tmux send-keys` before resorting to `tmux kill-window`
- **New `--force` flag**: Skips the graceful phase and directly kills the tmux window (current behavior), for use when the agent is unresponsive or the caller wants immediate termination
- **Configurable timeout**: Graceful phase times out after 5 seconds, falling through to hard kill
- **No changes to pi or the session-control protocol**: Uses only existing TUI keybindings (`app.interrupt` = Escape, `app.exit` = C-d)

## Capabilities

### New Capabilities

- `swarm-graceful-shutdown`: Kill a swarm agent by sending TUI exit keystrokes (Escape + C-d) before falling back to `tmux kill-window`, with a `--force` flag to skip the graceful phase

### Modified Capabilities

<!-- None. This is a new capability only; no existing specs change their requirements. -->

## Impact

- **Affected code**: `skills/pi-swarm/scripts/kill.ts` (new graceful logic, `--force` flag), `skills/pi-swarm/scripts/lib/tmux.ts` (possibly a new helper for checking window liveness)
- **APIs**: CLI interface gains `--force` flag and `--timeout <seconds>` option
- **Backward compatibility**: Default behavior changes from hard kill to graceful-then-hard. Users who want the old behavior use `--force`. The JSON output and exit codes remain unchanged.
- **Dependencies**: None new — uses only `tmux send-keys` (already required) and existing `killWindow` helper