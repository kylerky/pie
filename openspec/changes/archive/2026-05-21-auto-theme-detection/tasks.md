## 1. Extension Scaffold

- [x] 1.1 Create directory `auto-theme/` in `~/.pi/agent/extensions/` or `.pi/extensions/`
- [x] 1.2 Create `index.ts` entry point exporting default factory function `(pi: ExtensionAPI)`
- [x] 1.3 Verify pi discovers the extension: appearance of `/theme-auto` in command list or startup behavior
- [ ] 1.4 Commit scaffold

## 2. Configuration Module (config.ts)

- [x] 2.1 Define `AutoThemeConfig` interface: `{ enabled: boolean; darkTheme: string; lightTheme: string }`
- [x] 2.2 Implement `readConfig(cwd: string): AutoThemeConfig` — reads `.pi/auto-theme-config.json`, returns defaults if missing
- [x] 2.3 Implement `writeConfig(cwd: string, config: AutoThemeConfig): void` — writes JSON to `.pi/auto-theme-config.json`
- [x] 2.4 Get project root from `ctx.cwd` available in `session_start` and command handlers
- [ ] 2.5 Commit config module

## 3. Luminance Utilities (luminance.ts)

- [x] 3.1 Implement `srgbChannelToLinear(value: number): number` — sRGB transfer function
- [x] 3.2 Implement `relativeLuminance(r: number, g: number, b: number): number` — WCAG formula over 0-65535 range
- [x] 3.3 Implement `parseOsc11Response(data: string): {r,g,b} | null` — parse both 8-bit and 16-bit OSC 11 formats
- [x] 3.4 Implement `classifyLuminance(luminance: number): "dark" | "light"` — threshold at 0.5
- [ ] 3.5 Commit luminance module

## 4. Detection Chain (detection.ts)

- [x] 4.1 Implement `queryMode2031(timeoutMs: number): Promise<"dark" | "light" | null>` — writes `CSI ? 2031 $ p`, returns Promise that resolves on response or timeout
- [x] 4.2 Implement `queryOsc11(timeoutMs: number): Promise<"dark" | "light" | null>` — writes `\x1b]11;?\x1b\\`, returns Promise resolved on response or timeout
- [x] 4.3 Implement `detectColorFgBg(): "dark" | "light" | null` — reads `COLORFGBG` env var
- [x] 4.4 Implement `detectColorScheme(): Promise<"dark" | "light">` — orchestrates chain: 2031 → OSC11 → COLORFGBG → "dark"
- [x] 4.5 Implement `resolveTheme(darkOrLight: "dark" | "light", config: AutoThemeConfig): string`
- [ ] 4.6 Commit detection chain

## 5. Stdin Interception & Terminal I/O (in index.ts)

- [x] 5.1 Implement `enableMode2031()` — writes `CSI ? 2031 h`
- [x] 5.2 Implement `disableMode2031()` — writes `CSI ? 2031 l`
- [x] 5.3 Register `ctx.ui.onTerminalInput()` handler that pattern-matches `\x1b[?2031;` and `\x1b]11;` prefixes
- [x] 5.4 Implement Promise-based response waiting: pending query stores resolve/reject; handler resolves when matching response arrives
- [x] 5.5 Wire mode 2031 push events directly to theme resolution and switching (no pending query needed)
- [x] 5.6 Wire OSC 11 responses to pending query resolution
- [x] 5.7 Return `{ consume: true }` for matched sequences, `undefined` for pass-through
- [ ] 5.8 Commit stdin interception

## 6. Theme Switching Logic (in index.ts)

- [x] 6.1 Implement `detectAndApply(config, ctx)` — runs detection chain, resolves theme, calls `ctx.ui.setTheme()`
- [x] 6.2 Show notification via `ctx.ui.notify()` on successful detection (e.g., "Auto-theme: dark → nord-dark")
- [x] 6.3 Handle `setTheme()` error case: log to console, don't crash
- [x] 6.4 Skip detection and switching when `config.enabled === false`
- [ ] 6.5 Commit theme switching

## 7. Startup & Shutdown Lifecycle (in index.ts)

- [x] 7.1 On `pi.on("session_start")`: read config, if enabled: enableMode2031(), register stdin handler, run detectAndApply()
- [x] 7.2 On `pi.on("session_shutdown")`: disableMode2031(), clean up stdin handler
- [x] 7.3 Guard against non-interactive mode: check `ctx.hasUI` before registering terminal handlers
- [x] 7.4 Handle extension reload (`session_start` with `reason: "reload"`) — re-initialize cleanly
- [ ] 7.5 Commit lifecycle hooks

## 8. /theme-auto Slash Command & Menu (menu.ts)

- [x] 8.1 Register `/theme-auto` command via `pi.registerCommand()` with description
- [x] 8.2 Implement main menu dialog: show enabled/disabled status + options list
- [x] 8.3 Implement toggle handler: flip `enabled`, write config, enable/disable mode 2031
- [x] 8.4 Implement dark theme selector: `ctx.ui.select()` with all themes from `ctx.ui.getAllThemes()`, pre-select current
- [x] 8.5 Implement light theme selector: same pattern for `lightTheme`
- [x] 8.6 Implement "Detect now" option: run detection regardless of `enabled`, show result
- [x] 8.7 After any config change, call `writeConfig()` to persist
- [ ] 8.8 Commit command & menu

## 9. Error Handling & Edge Cases

- [x] 9.1 Gracefully handle missing/invalid config file (use defaults, don't crash)
- [x] 9.2 Handle theme name not found in available themes (fall back to "dark" or "light")
- [x] 9.3 Handle rapid color scheme changes (debounce push events by 200ms?)
- [x] 9.4 Handle `onTerminalInput` unsubscribe properly on reload/shutdown
- [x] 9.5 Log errors to console without disrupting the TUI
- [ ] 9.6 Commit error handling

## 10. Manual Testing

- [ ] 10.1 Test in Kitty: mode 2031 query, push on color change, `/theme-auto` menu
- [ ] 10.2 Test in WezTerm: mode 2031 query, push on color change
- [ ] 10.3 Test in Alacritty: OSC 11 fallback, no mode 2031
- [ ] 10.4 Test in VS Code terminal: COLORFGBG fallback, graceful degradation
- [ ] 10.5 Test `/theme-auto` command: toggle, theme selection, detect now
- [ ] 10.6 Test persistence: config survives pi restart
- [ ] 10.7 Test extension reload via `/reload`
- [ ] 10.8 Commit after testing fixes