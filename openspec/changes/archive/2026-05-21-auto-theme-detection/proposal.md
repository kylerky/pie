## Why

Pi's current auto-theme detection relies solely on the `COLORFGBG` environment variable, which is increasingly unreliable — modern terminals like Kitty, WezTerm, foot, and VS Code's integrated terminal do not set it. When `COLORFGBG` is absent, pi defaults to dark mode, giving users who switch between light and dark terminal setups a poor first-run experience. Furthermore, the settings UI offers no "auto" option, so once a user manually selects a theme, the detection is permanently disabled with no way to opt back in.

The terminal ecosystem has since standardized better detection mechanisms (DEC mode 2031 for push-based notifications, OSC 11 for RGB color queries) that pi should adopt. Rather than modifying pi's core source, this can be implemented as a **pi extension** using the existing `ctx.ui.setTheme()`, `ctx.ui.onTerminalInput()`, and `process.stdout.write()` APIs — no core changes required.

## What Changes

A new pi extension `auto-theme` that:

- **Active detection**: On load and on demand, queries the terminal's color scheme via a multi-tier fallback chain: DEC mode 2031 (`CSI ? 2031 $ p`) → OSC 11 (`\x1b]11;?\x1b\\`) → `COLORFGBG` env var → default "dark".
- **Push notifications**: Enables DEC mode 2031 (`CSI ? 2031 h`) so the terminal pushes `CSI ? 2031 ; 0/1 $ y` when its color scheme changes. Intercepted via `ctx.ui.onTerminalInput()`.
- **Automatic theme switching**: Resolves "dark" or "light" to a configured concrete theme (defaults to built-in `dark`/`light`). Calls `ctx.ui.setTheme()` to apply.
- **`/theme-auto` slash command**: Opens an interactive settings menu (using `ctx.ui.select()` dialogs) showing:
  - Current auto-detection status (active/detected scheme/resolved theme)
  - Auto mode toggle (on/off)
  - Auto dark theme selector (all installed themes)
  - Auto light theme selector (all installed themes)
- **Persistent configuration**: Reads/writes `.pi/auto-theme-config.json` in the project root, independent of the extension directory.
- **No core changes**: Uses only public ExtensionAPI and Node.js built-ins. Zero modifications to pi source.

## Capabilities

### New Capabilities

- `terminal-color-detection` (extension): Detects terminal background using DEC mode 2031, OSC 11, and COLORFGBG. Intercepts terminal responses via `onTerminalInput()`. Computes luminance from OSC 11 RGB values.

- `auto-theme-config` (extension): Configuration file (`auto-theme-config.json`) with `enabled`, `darkTheme`, `lightTheme`. Slash command settings menu using `ctx.ui.select()` dialogs. Theme resolution and switching via `ctx.ui.setTheme()`.

### Modified Capabilities

*None — implemented entirely as a pi extension using public APIs.*

## Impact

- **New file(s)**: `~/.pi/agent/extensions/auto-theme/index.ts` (entry point), plus supporting modules (detection.ts, config.ts, menu.ts, luminance.ts)
- **New file**: `.pi/auto-theme-config.json` (persisted config in project root)
- **New command**: `/theme-auto` registered via `pi.registerCommand()`
- **Startup hook**: `pi.on("session_start")` — enable mode 2031, register stdin listener, detect and apply theme
- **Shutdown hook**: `pi.on("session_shutdown")` — disable mode 2031, unregister stdin listener
- **Stdin interception**: `ctx.ui.onTerminalInput()` with pattern matching for `CSI ? 2031 ;`
- **Theme switching**: `ctx.ui.setTheme()` called on detection events
- **No npm dependencies required** — uses only Node.js built-ins (`fs`, `path`, `process`) and `@earendil-works/pi-coding-agent` types