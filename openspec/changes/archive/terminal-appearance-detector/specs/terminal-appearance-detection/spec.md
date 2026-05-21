## ADDED Requirements

### Requirement: Detect terminal background appearance via OSC 11

The system SHALL provide a function that queries the terminal's background color
using OSC 11 (`\x1b]11;?\x07`) followed by a DA1 sentinel (`\x1b[c`), parses the
response to extract R/G/B hex components, computes BT.601 relative luminance,
and returns `"dark"` when luminance < 0.5 or `"light"` otherwise.

#### Scenario: Dark terminal background detected via OSC 11

- **WHEN** the terminal responds with `\x1b]11;rgb:0000/0000/0000\x07` then
  `\x1b[?1;2c`
- **THEN** the function returns `"dark"`

#### Scenario: Light terminal background detected via OSC 11

- **WHEN** the terminal responds with `\x1b]11;rgb:ffff/ffff/ffff\x07` then
  `\x1b[?1;2c`
- **THEN** the function returns `"light"`

### Requirement: Handle unsupporting terminals via DA1 sentinel

The system SHALL recognize terminals that do not support OSC 11 by observing the
DA1 sentinel response arriving before the OSC 11 response. When the DA1 response
arrives first, the system SHALL return `"dark"` as default without waiting
further.

#### Scenario: DA1 arrives before OSC 11 on unsupporting terminal

- **WHEN** the terminal responds with `\x1b[?1;2c` without any prior OSC 11
  response
- **THEN** the function returns `"dark"` and does not continue waiting for an
  OSC 11 response

### Requirement: Parse varying hex precision in OSC 11 response

The system SHALL normalize hex components of any digit count (1 through 4) to
[0, 1] by dividing the parsed integer value by the maximum value for that digit
count. It SHALL handle both `rgb:` and `rgba:` prefixes.

#### Scenario: 2-digit hex response correctly normalized

- **WHEN** the terminal responds with `\x1b]11;rgb:1a/00/ff\x07`
- **THEN** R is normalized as `0x1a / 0xff`, G as `0x00 / 0xff`, B as
  `0xff / 0xff`

#### Scenario: 1-digit hex response correctly normalized

- **WHEN** the terminal responds with `\x1b]11;rgb:0/0/0\x07`
- **THEN** R is normalized as `0x0 / 0xf`, G as `0x0 / 0xf`, B as `0x0 / 0xf`,
  and the result is `"dark"`

#### Scenario: rgba-prefixed response handled identically

- **WHEN** the terminal responds with `\x1b]11;rgba:ffff/ffff/ffff\x07`
- **THEN** the function parses R, G, B identically and returns `"light"`

### Requirement: Continuous monitoring via Mode 2031

The system SHALL provide a function that subscribes to Mode 2031 (`\x1b[?2031h`)
terminal appearance change notifications. When the terminal sends `\x1b[?997;1n`
(dark) or `\x1b[?997;2n` (light), the system SHALL re-query OSC 11 and invoke a
caller-provided callback if the appearance changed. Multiple rapid notifications
SHALL be debounced to a single re-query within 100ms.

#### Scenario: Mode 2031 notification triggers re-query

- **WHEN** Mode 2031 is active and the terminal sends `\x1b[?997;1n`
- **THEN** the system re-queries OSC 11 within 100ms

#### Scenario: Multiple Mode 2031 notifications coalesce

- **WHEN** three `\x1b[?997;1n` notifications arrive within 20ms of each other
- **THEN** the system sends exactly one OSC 11 re-query after the debounce
  period

### Requirement: Polling fallback for terminals without Mode 2031

The system SHALL support periodic OSC 11 re-queries at 2-second intervals for
terminals that do not support Mode 2031. When Mode 2031 is detected (first
notification received), polling SHALL stop.

#### Scenario: Polling starts by default and stops when Mode 2031 fires

- **WHEN** monitoring is started on a terminal without Mode 2031 support
- **THEN** OSC 11 queries are sent every 2 seconds until a `\x1b[?997;`
  notification arrives, at which point polling stops

### Requirement: Deduplication of appearance callbacks

The system SHALL invoke the caller-provided callback only when the computed
appearance changes from the previously reported value. Consecutive queries that
produce the same result SHALL NOT trigger the callback.

#### Scenario: Same appearance does not re-fire callback

- **WHEN** appearance is already `"dark"` and a subsequent OSC 11 query also
  returns `"dark"`
- **THEN** the callback is not invoked
