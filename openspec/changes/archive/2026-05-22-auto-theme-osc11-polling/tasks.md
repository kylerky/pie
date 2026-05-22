## 1. Detection method tracking

- [x] 1.1 Define `DetectionResult` type in `detection.ts`: `{ scheme: "dark" | "light"; method: "mode2031" | "osc11" | "colorfgbg" | "default" }`
- [x] 1.2 Refactor `detectColorScheme()` to return `DetectionResult`, tracking which tier succeeded (Tier 1 → `"mode2031"`, Tier 2 → `"osc11"`, Tier 3 → `"colorfgbg"`, Tier 4 → `"default"`)
- [x] 1.3 Update `index.ts` callers of `detectColorScheme()` to destructure `.scheme` from the new return type
- [x] 1.4 Verify existing startup detection behavior is unchanged (scheme resolves correctly, fallback chain order preserved)

## 2. Config: polling interval field

- [x] 2.1 Add `osc11PollIntervalMs?: number` (optional, default 30000, 0 = disabled) to `AutoThemeConfig` interface in `config.ts`
- [x] 2.2 Update `DEFAULT_CONFIG` in `config.ts` to include `osc11PollIntervalMs: 30000`
- [x] 2.3 Update `readConfig()` to parse `osc11PollIntervalMs` from JSON with validation (must be non-negative integer; invalid/negative → fall back to 30000)
- [x] 2.4 Verify `writeConfig()` already serializes the new field (transparent since `JSON.stringify` on the full object)
- [x] 2.5 Commit config changes

## 3. Polling core: query loop with backoff

- [x] 3.1 Implement `startOsc11Polling(intervalMs, onSchemeChange)` in `detection.ts`:
  - Set up `setInterval` at `intervalMs`
  - On each tick: skip if `pendingOsc11Resolve !== null` (overlapping poll prevention)
  - Call `queryOsc11(200)`, compare result against `currentScheme`, call `onSchemeChange(scheme)` if different
  - Return a cleanup function `() => clearInterval(timer)`
- [x] 3.2 Implement exponential backoff on repeated timeouts:
  - Track consecutive timeout count
  - On timeout: double effective interval (30s → 60s → 120s → 240s → 300s cap)
  - On successful response: reset counter and interval to `intervalMs`
  - Use `setTimeout` chaining (not `setInterval`) to support dynamic interval changes
- [x] 3.3 Export `cancelAllPending()` coverage for polling — ensure `session_shutdown` and `/theme-auto` disable clear the polling timer
- [x] 3.4 Verify polling deduplication: poll result matching `currentScheme` does not trigger `onSchemeChange`

## 4. Lifecycle integration

- [x] 4.1 Add `stopPolling` module-level variable in `index.ts` (mirroring existing `unsubStdin` pattern)
- [x] 4.2 Modify `session_start` handler: after `detectAndApply()`, check detection method. If `"osc11"` and `config.osc11PollIntervalMs > 0`, call `startOsc11Polling(config.osc11PollIntervalMs, (scheme) => handlePush(scheme, ctx))` and store cleanup
- [x] 4.3 Modify `session_shutdown` handler: call `stopPolling?.()` alongside existing cleanup
- [x] 4.4 Modify `/theme-auto` toggle handler (`onToggle`): call `stopPolling?.()` when disabling; when enabling, re-run detection and conditionally start polling
- [x] 4.5 Verify polling respects `config.enabled` — polling never starts when auto-theme is disabled at startup

## 5. Verification

- [x] 5.1 Manual smoke test: start pi in a terminal WITH mode 2031 support (Kitty, recent WezTerm). Verify startup detection still works via mode 2031; verify polling is NOT started (no OSC 11 queries in logs)
- [x] 5.2 Manual smoke test: start pi in a terminal WITHOUT mode 2031 but WITH OSC 11 support (iTerm2, Alacritty, VS Code, GNOME Terminal). Verify startup detection works via OSC 11; verify polling starts and detects runtime theme changes
- [x] 5.3 Manual smoke test: change terminal background while pi is running (e.g., switch system from dark to light). Verify theme switches within 30 seconds (or configured interval)
- [x] 5.4 Manual smoke test: toggle auto-theme off via `/theme-auto`. Verify polling stops (no OSC 11 queries). Toggle back on. Verify polling resumes.
- [x] 5.5 Manual smoke test: set `osc11PollIntervalMs: 0` in config. Start pi. Verify polling is NOT started even when OSC 11 is the detection method.
- [x] 5.6 Manual smoke test: start pi in a terminal that supports NEITHER mode 2031 nor OSC 11 (e.g., tmux, xterm). Verify startup falls through to COLORFGBG or default, and polling is NOT started.
- [x] 5.7 Commit with conventional commit message: `feat(auto-theme): add periodic OSC 11 polling for runtime theme detection`