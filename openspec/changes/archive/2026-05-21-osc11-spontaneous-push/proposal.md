## Why

The auto-theme extension has no fallback mechanism to detect terminal background color changes for the vast majority of terminals that do not support DEC private mode 2031 push notifications. However, several modern terminals (Kitty, Ghostty, and others) broadcast OSC 11 escape sequences when their background color changes. The extension currently receives these broadcasts but silently discards them when no query is pending. This change turns those spontaneous broadcasts into a second push-notification channel, giving most users real-time theme switching without relying on the rarely-supported DEC 2031 protocol.

## What Changes

- **Spontaneous OSC 11 broadcast handling**: When an OSC 11 escape sequence arrives on stdin without a pending query, the extension computes the background luminance, classifies it as dark or light, and triggers a theme change — acting as a push notification equivalent to DEC mode 2031 push.
- **Deduplication of consecutive push events**: The extension SHALL ignore OSC 11 pushes that resolve to the same scheme as the current one, preventing redundant theme switches.
- **No change to existing query-based OSC 11 detection**: The existing startup query flow (OSC 11 as Tier 2 fallback) remains untouched. The new behavior only applies when `pendingOsc11Resolve` is null.

## Capabilities

### New Capabilities

<!-- None — this is purely a behavior change to an existing capability -->

### Modified Capabilities

- `terminal-color-detection`: OSC 11 stdin interception now treats unmatched broadcasts as push events instead of silently consuming them. Adds a requirement for classifying and acting on spontaneous OSC 11 messages.

## Impact

- **Affected code**: `extensions/auto-theme/detection.ts` — the `handleTerminalInput()` function and the stdin handler in `index.ts`
- **No API changes**: The `ctx.ui.onTerminalInput()` handler signature is unchanged
- **No config changes**: No new settings needed; behavior is always active when auto-theme is enabled
- **No breaking changes**: Existing DEC 2031 query/push behavior is untouched; OSC 11 query responses with pending resolvers still work identically