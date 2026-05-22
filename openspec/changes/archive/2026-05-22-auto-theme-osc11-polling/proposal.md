## Why

The auto-theme extension detects the terminal's color scheme on startup and reacts to runtime changes via DEC mode 2031 push notifications and spontaneous OSC 11 broadcasts. However, the majority of modern terminals (iTerm2, Alacritty, VS Code, Windows Terminal, GNOME Terminal, foot, older WezTerm) support OSC 11 queries but neither DEC mode 2031 nor spontaneous OSC 11 broadcasts. For these users, the extension only detects the scheme once at startup — it cannot respond to runtime theme changes (e.g., when the user switches their system from light to dark mode). Adding periodic OSC 11 polling closes this gap, giving the vast majority of users real-time auto-theme switching.

## What Changes

- **Periodic OSC 11 polling**: When DEC mode 2031 is unavailable (detected at startup), the extension SHALL periodically query the terminal background color via OSC 11 and switch themes when the detected scheme changes.
- **Conditional activation**: Polling SHALL only activate when startup detection confirms OSC 11 support but mode 2031 is unavailable. Terminals with mode 2031 push SHALL NOT incur polling overhead.
- **Configurable polling interval**: Poll interval defaults to 30 seconds, configurable via `auto-theme-config.json` (`osc11PollIntervalMs`). Setting it to 0 disables polling.
- **Exponential backoff on repeated timeouts**: If N consecutive polls time out (terminal stopped responding), the interval doubles up to a maximum of 5 minutes, resetting on first successful response.
- **No-op on same scheme**: Poll results that match the current scheme SHALL NOT trigger theme changes, consistent with existing deduplication in `handlePush()`.

## Capabilities

### New Capabilities

<!-- None — polling is an extension of the existing detection chain, not a new capability area -->

### Modified Capabilities

- `terminal-color-detection`: Adds periodic OSC 11 polling as a runtime detection mechanism that supplements the existing push-based channels. The detection chain SHALL now also track *which method succeeded* so polling can be conditionally enabled. Polling lifecycle (start/stop/backoff) is added as a new requirement.

## Impact

- **Affected code**: `extensions/auto-theme/detection.ts` — new polling functions, modified `detectColorScheme()` return type to expose detection method. `extensions/auto-theme/index.ts` — polling lifecycle management in `session_start`/`session_shutdown` and `/theme-auto` toggle. `extensions/auto-theme/config.ts` — new `osc11PollIntervalMs` field.
- **No API changes**: Uses existing `process.stdout.write()` and `ctx.ui.onTerminalInput()` APIs. No changes to Pi core.
- **No breaking changes**: Existing startup detection and push-based behavior is untouched. Polling is additive.
- **Config change**: New optional `osc11PollIntervalMs` field in `.pi/auto-theme-config.json` (default 30000, 0 to disable).