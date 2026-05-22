## ADDED Requirements

### Requirement: Graceful shutdown via TUI keystrokes

The kill script SHALL attempt a graceful shutdown of the agent before using hard termination. It SHALL send the `Escape` key to abort any in-flight work, wait for the agent to return to an idle state, then send `C-d` to trigger the TUI's exit handler.

#### Scenario: Agent is idle

- **WHEN** kill.ts is invoked for an agent that is idle (editor empty, waiting for input)
- **THEN** the script sends `Escape` followed by `C-d` via `tmux send-keys`
- **AND** the pi process exits cleanly, flushing its session and closing its control socket
- **AND** the tmux window self-closes because the window's command has completed

#### Scenario: Agent is processing a turn

- **WHEN** kill.ts is invoked for an agent that is mid-turn (streaming LLM response or executing tools)
- **THEN** the `Escape` keystroke aborts the in-flight operation
- **AND** after a brief wait, the `C-d` keystroke triggers the TUI exit handler
- **AND** the pi process exits cleanly

### Requirement: Timeout with hard kill fallback

If the tmux window still exists after the graceful shutdown attempt, the script SHALL fall back to `tmux kill-window` after a configurable timeout period.

#### Scenario: Agent exits within timeout

- **WHEN** kill.ts sends the graceful shutdown keystrokes
- **AND** the tmux window closes within the timeout period (default 5 seconds)
- **THEN** the script reports success without calling `tmux kill-window`

#### Scenario: Agent does not exit within timeout

- **WHEN** kill.ts sends the graceful shutdown keystrokes
- **AND** the tmux window still exists after the timeout period
- **THEN** the script calls `tmux kill-window` to force termination
- **AND** reports that the agent was hard-killed after a failed graceful attempt

#### Scenario: Graceful keystrokes fail to send

- **WHEN** kill.ts attempts to send `Escape` or `C-d` via `tmux send-keys`
- **AND** the tmux socket is unavailable or the send fails
- **THEN** the script falls through to `tmux kill-window` immediately
- **AND** reports that graceful shutdown could not be attempted

### Requirement: Force flag for immediate hard kill

The script SHALL accept a `--force` flag that skips the graceful shutdown phase entirely and calls `tmux kill-window` directly.

#### Scenario: Force flag is set

- **WHEN** kill.ts is invoked with `--force`
- **THEN** no graceful shutdown keystrokes are sent
- **AND** the script calls `tmux kill-window` immediately
- **AND** the orphan symlink sweep runs afterward

#### Scenario: Force flag is not set

- **WHEN** kill.ts is invoked without `--force`
- **THEN** the graceful shutdown keystrokes are sent before any hard kill attempt
- **AND** the timeout governs the fallback to hard kill

### Requirement: Configurable timeout

The script SHALL accept a `--timeout <seconds>` option that controls how long the graceful phase waits before falling back to hard kill.

#### Scenario: Custom timeout provided

- **WHEN** kill.ts is invoked with `--timeout 10`
- **THEN** the graceful phase polls for window closure for up to 10 seconds before falling back to hard kill

#### Scenario: No timeout provided

- **WHEN** kill.ts is invoked without `--timeout`
- **THEN** the graceful phase uses a default timeout of 5 seconds

### Requirement: Orphan symlink cleanup after termination

After the agent is terminated (whether graceful or hard), the script SHALL sweep orphaned control socket symlinks in `~/.pi/session-control/`.

#### Scenario: Cleanup after graceful exit

- **WHEN** an agent exits gracefully via C-d
- **AND** its control socket symlink is no longer valid
- **THEN** the orphan symlink sweep removes the stale symlink

#### Scenario: Cleanup after hard kill

- **WHEN** an agent is hard-killed via `tmux kill-window`
- **AND** its control socket symlink is no longer valid
- **THEN** the orphan symlink sweep removes the stale symlink

### Requirement: Window liveness polling

The script SHALL determine whether the tmux window has closed by polling `tmux list-windows` for the target window name at regular intervals during the graceful phase.

#### Scenario: Window disappears

- **WHEN** the graceful shutdown keystrokes have been sent
- **AND** polling detects that the window name no longer appears in the session's window list
- **THEN** the script reports successful graceful termination

#### Scenario: Window persists

- **WHEN** the graceful shutdown keystrokes have been sent
- **AND** polling continues to find the window name in the session's window list
- **THEN** the script continues polling until the timeout is reached