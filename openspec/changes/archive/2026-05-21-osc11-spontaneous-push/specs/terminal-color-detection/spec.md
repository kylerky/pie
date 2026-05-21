## ADDED Requirements

### Requirement: OSC 11 spontaneous push detection

The extension SHALL treat OSC 11 escape sequences that arrive without a pending query as color-scheme push notifications. When such a sequence arrives, the extension SHALL parse the RGB background color, compute relative luminance using the sRGB WCAG formula, classify the result as dark or light, and trigger a theme change via the same `handlePush()` pathway used for DEC mode 2031 push events.

#### Scenario: Spontaneous OSC 11 broadcast triggers theme change

- **WHEN** auto-theme is enabled and `pendingOsc11Resolve` is null
- **AND** an OSC 11 response `\x1b]11;rgb:ffff/ffff/ffff\x1b\\` arrives on stdin
- **THEN** `handleTerminalInput()` SHALL parse the RGB value, compute luminance, classify as "light"
- **AND** return `"light"` to the caller
- **AND** the caller SHALL invoke `handlePush("light", ctx)`, which SHALL resolve and apply the configured light theme

#### Scenario: Spontaneous OSC 11 with dark background triggers dark theme

- **WHEN** auto-theme is enabled and `pendingOsc11Resolve` is null
- **AND** an OSC 11 response `\x1b]11;rgb:0000/0000/0000\x1b\\` arrives on stdin
- **THEN** `handleTerminalInput()` SHALL classify as "dark"
- **AND** return `"dark"` to the caller
- **AND** the caller SHALL apply the configured dark theme

#### Scenario: Spontaneous OSC 11 is deduplicated

- **WHEN** auto-theme is enabled and the current detected scheme is "dark"
- **AND** a spontaneous OSC 11 response also classifies as "dark"
- **THEN** `handlePush()` SHALL detect that `darkOrLight === currentScheme` and skip the theme change

#### Scenario: Spontaneous OSC 11 does not interfere with pending query

- **WHEN** auto-theme is enabled and `pendingOsc11Resolve` is NOT null (a query is in flight)
- **AND** an OSC 11 response arrives on stdin
- **THEN** the extension SHALL resolve the pending query with the classified scheme
- **AND** SHALL NOT trigger a push event

#### Scenario: Unparseable OSC 11 is ignored

- **WHEN** auto-theme is enabled and `pendingOsc11Resolve` is null
- **AND** a malformed OSC 11 sequence arrives (e.g., `\x1b]11;invalid\x1b\\`)
- **THEN** `parseOsc11Response()` SHALL return null
- **AND** `handleTerminalInput()` SHALL return `undefined`
- **AND** no theme change SHALL be triggered

#### Scenario: Spontaneous OSC 11 with 8-bit RGB values

- **WHEN** auto-theme is enabled and `pendingOsc11Resolve` is null
- **AND** an OSC 11 response `\x1b]11;rgb:ff/ff/ff\x1b\\` arrives on stdin
- **THEN** the extension SHALL scale each 8-bit channel to 16-bit (multiply by 257)
- **AND** classify the result and trigger a theme change as normal

## MODIFIED Requirements

### Requirement: Stdin interception via onTerminalInput

The extension SHALL register a handler via `ctx.ui.onTerminalInput()` that checks incoming data for mode 2031 and OSC 11 response patterns. The handler SHALL return `{ consume: true }` for matched sequences and `undefined` (pass through) for all other data. For OSC 11 sequences, the handler SHALL additionally inspect the return value of `handleTerminalInput()` and invoke `handlePush()` when a push event is indicated.

#### Scenario: Mode 2031 response intercepted

- **WHEN** `\x1b[?2031;1$y` arrives on stdin
- **THEN** the handler SHALL match the `\x1b[?2031;` prefix, parse the scheme digit, and return `{ consume: true }`

#### Scenario: OSC 11 response intercepted (query response)

- **WHEN** `\x1b]11;rgb:1a1a/2e2e/3c3c\x1b\\` arrives on stdin and a query is pending
- **THEN** the handler SHALL match the `\x1b]11;` prefix, extract RGB channels, resolve the pending query, and return `{ consume: true }`

#### Scenario: OSC 11 response intercepted (spontaneous push)

- **WHEN** `\x1b]11;rgb:1a1a/2e2e/3c3c\x1b\\` arrives on stdin and no query is pending
- **THEN** `handleTerminalInput()` SHALL return `"dark"` or `"light"`
- **AND** the handler SHALL invoke `handlePush()` with the classified scheme
- **AND** return `{ consume: true }`

#### Scenario: Normal keyboard input passes through

- **WHEN** any non-2031/non-OSC11 sequence arrives (e.g., `a`, `\x1b[A`)
- **THEN** the handler SHALL return `undefined` so the TUI processes it normally