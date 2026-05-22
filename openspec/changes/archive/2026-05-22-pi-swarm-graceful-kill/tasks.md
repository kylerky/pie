## 1. Add tmux helpers for graceful shutdown

- [x] 1.1 Add `sendKeys` helper to `lib/tmux.ts` — wraps `tmux send-keys -t session:window` for sending keystrokes (Escape, C-d) to a pane
- [x] 1.2 Add `windowExists` helper to `lib/tmux.ts` — checks if a specific window still exists in a session (reuses `listWindows`)
- [x] 1.3 Add `waitForWindowDeath` helper to `lib/tmux.ts` — polls `windowExists` at intervals until the window is gone or timeout reached, returns `boolean` (true if gone)

## 2. Implement graceful kill logic in kill.ts

- [x] 2.1 Parse `--force` and `--timeout <seconds>` flags from CLI arguments alongside existing `--session` flag
- [x] 2.2 Implement the graceful shutdown phase: send `Escape`, sleep 500ms, send `C-d` via `sendKeys`
- [x] 2.3 After sending keystrokes, call `waitForWindowDeath` with the configured timeout (default 5s)
- [x] 2.4 If window is gone after grace period, report successful graceful termination and skip hard kill
- [x] 2.5 If window persists, fall through to `killWindow` for hard termination
- [x] 2.6 If `--force` is set, skip the graceful phase entirely and call `killWindow` directly
- [x] 2.7 Preserve existing orphan symlink cleanup — run `cleanOrphanedSymlinks` in all termination paths

## 3. Update documentation

- [x] 3.1 Update `skills/pi-swarm/SKILL.md` kill.ts section to document `--force` and `--timeout` flags and describe the graceful shutdown behavior
- [x] 3.2 Commit the change with a conventional commit message (e.g., `feat(pi-swarm): graceful kill with C-d before hard fallback`)