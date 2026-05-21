## ADDED Requirements

### Requirement: DEC mode 2031 detection

The extension SHALL detect terminal color scheme using DEC private mode 2031. On startup, the extension SHALL enable push notifications by writing `CSI ? 2031 h` to stdout and SHALL query the current scheme by writing `CSI ? 2031 $ p`. The extension SHALL interpret responses `CSI ? 2031 ; 0 $ y` as light and `CSI ? 2031 ; 1 $ y` as dark.

#### Scenario: Mode 2031 query on startup

- **WHEN** the extension loads during `session_start`
- **THEN** it SHALL write `CSI ? 2031 h` then `CSI ? 2031 $ p` to stdout
- **AND** if response `CSI ? 2031 ; 0 $ y` arrives, resolve to "light"
- **AND** if response `CSI ? 2031 ; 1 $ y` arrives, resolve to "dark"
- **AND** if no response within 200ms, fall through to next detection method

#### Scenario: Mode 2031 push notification

- **WHEN** mode 2031 is enabled and the terminal's color scheme changes
- **THEN** the terminal emits `CSI ? 2031 ; 0/1 $ y` on stdin
- **AND** the `onTerminalInput` handler SHALL intercept this sequence and return `{ consume: true }`
- **AND** the extension SHALL re-resolve and apply the appropriate theme

#### Scenario: Mode 2031 disable on shutdown

- **WHEN** pi emits `session_shutdown`
- **THEN** the extension SHALL write `CSI ? 2031 l` to stdout

#### Scenario: Mode 2031 disable when auto-theme turned off

- **WHEN** the user disables auto-theme via `/theme-auto`
- **THEN** the extension SHALL write `CSI ? 2031 l` to stdout

### Requirement: OSC 11 RGB detection

The extension SHALL query the terminal background color via OSC 11 as a fallback when mode 2031 is unavailable. The extension SHALL parse the RGB response, compute relative luminance using the sRGB WCAG formula, and classify backgrounds with luminance > 0.5 as light and ≤ 0.5 as dark.

#### Scenario: OSC 11 query as fallback

- **WHEN** mode 2031 query times out
- **THEN** the extension SHALL write `\x1b]11;?\x1b\\` to stdout
- **AND** await a response via the `onTerminalInput` handler for up to 200ms

#### Scenario: OSC 11 RGB response parsing (16-bit)

- **WHEN** the terminal responds with `\x1b]11;rgb:1a1a/2e2e/3c3c\x1b\\`
- **THEN** the extension SHALL extract channels as 16-bit values from `/`-delimited hex
- **AND** compute sRGB relative luminance: `0.2126·R + 0.7152·G + 0.0722·B`
- **AND** classify: luminance > 0.5 → "light", otherwise "dark"

#### Scenario: OSC 11 RGB response parsing (8-bit)

- **WHEN** the terminal responds with `\x1b]11;rgb:1a/2e/3c\x1b\\`
- **THEN** the extension SHALL scale each channel from 0-255 to 0-65535 before luminance calculation

#### Scenario: OSC 11 timeout

- **WHEN** no OSC 11 response arrives within 200ms
- **THEN** the extension SHALL fall through to COLORFGBG detection

### Requirement: COLORFGBG fallback

The extension SHALL use the `COLORFGBG` environment variable as the final detection fallback. The extension SHALL parse the format `fg;bg` and classify background index < 8 as dark and ≥ 8 as light.

#### Scenario: COLORFGBG detection

- **WHEN** both mode 2031 and OSC 11 are unavailable
- **THEN** the extension SHALL read `process.env.COLORFGBG`
- **AND** parse `bg` from `fg;bg` format
- **AND** if `bg < 8` return "dark", otherwise "light"

#### Scenario: No detection available

- **WHEN** all detection methods fail
- **THEN** the extension SHALL return "dark"

### Requirement: Detection chain ordering

The extension SHALL execute detection methods sequentially: mode 2031 first, OSC 11 second, COLORFGBG third, "dark" default last. Each method SHALL only be attempted if the previous returned null (failed).

#### Scenario: Chain stops at first success

- **WHEN** mode 2031 returns "light" within its timeout
- **THEN** the extension SHALL NOT attempt OSC 11 or COLORFGBG

### Requirement: Stdin interception via onTerminalInput

The extension SHALL register a handler via `ctx.ui.onTerminalInput()` that checks incoming data for mode 2031 and OSC 11 response patterns. The handler SHALL return `{ consume: true }` for matched sequences and `undefined` (pass through) for all other data.

#### Scenario: Mode 2031 response intercepted

- **WHEN** `\x1b[?2031;1$y` arrives on stdin
- **THEN** the handler SHALL match the `\x1b[?2031;` prefix, parse the scheme digit, and return `{ consume: true }`

#### Scenario: OSC 11 response intercepted

- **WHEN** `\x1b]11;rgb:1a1a/2e2e/3c3c\x1b\\` arrives on stdin
- **THEN** the handler SHALL match the `\x1b]11;` prefix, extract RGB channels, and return `{ consume: true }`

#### Scenario: Normal keyboard input passes through

- **WHEN** any non-2031/non-OSC11 sequence arrives (e.g., `a`, `\x1b[A`)
- **THEN** the handler SHALL return `undefined` so the TUI processes it normally

### Requirement: Theme resolution and switching

When auto-detection resolves "dark" or "light", the extension SHALL map the result to a concrete theme: `config.darkTheme` (default `"dark"`) for dark, `config.lightTheme` (default `"light"`) for light. The extension SHALL apply the theme via `ctx.ui.setTheme()`.

#### Scenario: Dark detection applies darkTheme

- **WHEN** detection resolves "dark" and config.darkTheme is "nord-dark"
- **THEN** the extension SHALL call `ctx.ui.setTheme("nord-dark")`

#### Scenario: Light detection applies lightTheme

- **WHEN** detection resolves "light" and config.lightTheme is unset (default "light")
- **THEN** the extension SHALL call `ctx.ui.setTheme("light")`

#### Scenario: Auto-theme disabled skips switching

- **WHEN** config.enabled is false
- **THEN** the extension SHALL NOT switch themes on detection events