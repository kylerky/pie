## Context

The `auto-theme` extension provides automatic terminal color scheme detection and theme switching as a pi extension. It uses only public ExtensionAPI methods (`ctx.ui.setTheme()`, `ctx.ui.onTerminalInput()`, `ctx.ui.select()`) and Node.js built-ins (`process.stdout`, `process.stdin`, `fs`). No pi core modifications are needed.

The extension lives at `~/.pi/agent/extensions/auto-theme/` (global) or `.pi/extensions/auto-theme/` (project-local) and is auto-discovered by pi.

## Goals / Non-Goals

**Goals:**
- Detect terminal color scheme on startup and apply the appropriate theme
- Receive push notifications via DEC mode 2031 when the terminal color scheme changes
- Fall back through OSC 11 → COLORFGBG → "dark" default
- Provide a `/theme-auto` slash command with an interactive settings menu
- Persist user preferences (auto dark/light theme choices, enabled state) to `auto-theme-config.json`
- Pure extension — no core code changes

**Non-Goals:**
- Platform-specific OS dark mode watchers
- Integration with pi's built-in settings selector (`/settings`)
- Continuous polling
- Interpolation between themes based on RGB values

## Decisions

### Decision 1: Extension Architecture

**Choice:** Multi-file extension directory with `index.ts` entry point, separate modules for detection, config, and menu.

```
~/.pi/agent/extensions/auto-theme/
├── index.ts                  # Entry point — registers hooks & command
├── detection.ts              # detectColorScheme(), queryMode2031(), queryOsc11()
├── luminance.ts              # sRGB luminance calculation for OSC 11
├── config.ts                 # readConfig(), writeConfig(), defaults
└── menu.ts                   # showSettingsMenu() — interactive dialogs

.pi/auto-theme-config.json    # Persisted user preferences (project root)
```

**Rationale:** Single-file would be ~500+ lines. Separation keeps each module focused and testable. pi's extension loader handles `index.ts` in subdirectories automatically.

### Decision 2: Configuration File Schema

**Choice:** JSON file alongside the extension, with a simple flat schema:

```json
{
  "enabled": true,
  "darkTheme": "dark",
  "lightTheme": "light"
}
```

**Rationale:** Flat file is simpler than `pi.appendEntry()` for this use case (configuration, not session state). The file is read on startup and written on settings changes. Located at `.pi/auto-theme-config.json` (project root) so it's independent of the extension directory and survives extension updates.

### Decision 3: Stdin Interception via onTerminalInput()

**Choice:** Use `ctx.ui.onTerminalInput()` to register a handler that pattern-matches `\x1b[?2031;` CSI sequences. Matched sequences return `{ consume: true }` to prevent them from reaching the TUI's key handler (though the key handler would ignore them anyway). Unmatched sequences pass through by returning `undefined`.

```typescript
ctx.ui.onTerminalInput((data) => {
  if (data.startsWith("\x1b[?2031;")) {
    const match = data.match(/\x1b\[\?2031;([01])\$y/);
    if (match) {
      handleColorSchemeChange(match[1] === "1" ? "dark" : "light");
      return { consume: true };
    }
  }
  // Pass through all other input
});
```

**Rationale:** `onTerminalInput()` is the official extension API for raw stdin access. It provides clean consumption semantics. The handler only fires for complete sequences (the StdinBuffer emits complete sequences after buffering). Mode 2031 responses are short CSI sequences that the TUI key handler doesn't recognize, making consumption safe.

### Decision 4: Initial OSC 11 Query — Pre-TUI Approach

**Choice:** The initial query chain runs inside the `session_start` event handler. Mode 2031 enable and query are written to stdout. For OSC 11 fallback, write the query to stdout and let the `onTerminalInput()` handler catch the response with a timeout-based retry flow.

```typescript
async function detectOnStartup(ctx) {
  // 1. Write mode 2031 enable
  process.stdout.write("\x1b[?2031h");
  // 2. Write mode 2031 query
  process.stdout.write("\x1b[?2031$p");
  // 3. Wait for response via onTerminalInput (already registered)
  //    If no response within 200ms → fall through to OSC 11
  // 4. Write OSC 11 query
  process.stdout.write("\x1b]11;?\x1b\\");
  // 5. Wait for response via onTerminalInput
  //    If no response within 200ms → fall through to COLORFGBG
}
```

**Rationale:** The `session_start` event fires after the TUI is initialized but before the user starts interacting. The `onTerminalInput()` handler is already registered and ready to receive responses. This avoids the need for pre-TUI synchronous stdin reading.

**Alternative considered:** Doing OSC 11 query synchronously before TUI initialization. Rejected because it would require reading stdin outside the extension's `session_start` lifecycle, which happens after the TUI is already consuming stdin.

### Decision 5: Detection Chain with Promises + Timeouts

The detection chain uses a sequential try-await pattern with per-method timeouts:

```
detectColorScheme():
  ┌─ try queryMode2031(200ms) ─┐
  │  if "dark"|"light" → return │
  │  if null → continue         │
  └─────────────────────────────┘
  ┌─ try queryOsc11(200ms) ────┐
  │  if "dark"|"light" → return │
  │  if null → continue         │
  └─────────────────────────────┘
  ┌─ try detectColorFgBg() ────┐
  │  if "dark"|"light" → return │
  │  if null → continue         │
  └─────────────────────────────┘
  return "dark"
```

Each `queryX()` function creates a Promise that resolves when the `onTerminalInput` handler catches the expected response, or rejects on timeout. The chain stops at the first successful result.

### Decision 6: Slash Command Menu

**Choice:** Register `/theme-auto` via `pi.registerCommand()`. The command handler uses `ctx.ui.select()` dialogs to present a multi-step settings interface:

1. **Main menu:** Show current status + options:
   - `[✓] Auto theme: enabled` / `[ ] Auto theme: disabled` (toggle)
   - `Auto dark theme: nord-dark` (select)
   - `Auto light theme: solarized-light` (select)
   - `Detect now` (trigger detection)

2. **Select dark/light theme:** Sub-dialog listing all themes from `ctx.ui.getAllThemes()`, pre-selecting current value.

3. **Toggle:** Flips `enabled` in config. When disabling, reverts to the default theme.

**Rationale:** `ctx.ui.select()` provides a simple list-based selection that works in all modes. It's less rich than the built-in settings UI but sufficient for 3-4 options. The command pattern follows existing pi extension conventions (e.g., `/model`).

### Decision 7: No Settings Manager Integration

**Choice:** The extension manages its own config file separately from pi's `settings.json`. The theme setting in pi's core settings (`settings.theme`) is NOT modified by the extension.

**Rationale:** This keeps the extension self-contained and avoids interference with pi's core theme flow. The extension uses `ctx.ui.setTheme()` at runtime but doesn't write to pi's settings. When the extension is removed, pi falls back to its default theme behavior.

## Risks / Trade-offs

- **[No settings UI integration]** The `/theme-auto` command provides a menu, but it's not in the built-in `/settings` panel. Users must discover the command. → **Mitigation:** Document the command. The extension can notify on startup.

- **[onTerminalInput in non-interactive modes]** `onTerminalInput` only works in interactive mode. In print/RPC mode, auto-detection is skipped. → **Mitigation:** Check `ctx.hasUI` before registering handlers.

- **[Mode 2031 in tmux]** tmux may intercept or not pass through mode 2031. → **Mitigation:** The fallback chain degrades to OSC 11, then COLORFGBG.

- **[Theme flicker on startup]** If detection is slow, the TUI renders with the default theme briefly before switching. → **Mitigation:** The `session_start` handler runs before the first render. If detection completes quickly (most terminals respond in <10ms), there's no visible flicker.

## Open Questions

- Should the extension write to `settings.json`'s `theme` field when disabled (so pi remembers the last manually-set theme)?
- Should auto-detection be enabled by default, or should the user explicitly run `/theme-auto enable` first?
- Should the config file use a `.json` extension or a different format?