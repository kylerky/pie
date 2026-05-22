## ADDED Requirements

### Requirement: Periodic OSC 11 polling

When DEC mode 2031 push notifications are unavailable, the extension SHALL periodically query the terminal background color via OSC 11 to detect runtime color scheme changes. Each poll SHALL send `\x1b]11;?\x1b\\` to stdout and await a response via the existing stdin handler for up to 200ms. If the detected scheme differs from the current scheme, the extension SHALL trigger a theme change using the existing `handlePush()` deduplication and debounce logic.

#### Scenario: Poll detects scheme change

- **WHEN** a periodic OSC 11 poll receives a response classified as "light"
- **AND** the current scheme is "dark"
- **THEN** the extension SHALL call `handlePush("light", ctx)` to switch the theme
- **AND** update `currentScheme` to "light"

#### Scenario: Poll detects same scheme

- **WHEN** a periodic OSC 11 poll receives a response classified as "dark"
- **AND** the current scheme is already "dark"
- **THEN** the extension SHALL NOT trigger a theme change

#### Scenario: Poll times out

- **WHEN** a periodic OSC 11 poll sends a query but receives no response within 200ms
- **THEN** the extension SHALL increment the consecutive timeout counter for backoff
- **AND** SHALL NOT trigger a theme change

### Requirement: Conditional polling activation

The extension SHALL activate periodic OSC 11 polling only when the startup detection chain confirms that OSC 11 is supported but DEC mode 2031 is unavailable. The extension SHALL NOT activate polling when mode 2031 succeeded (push notifications already cover runtime changes) or when OSC 11 itself failed (terminal does not support OSC 11 queries).

#### Scenario: Polling enabled when OSC 11 succeeds but mode 2031 fails

- **WHEN** startup detection falls through mode 2031 (timeout) but OSC 11 query succeeds
- **THEN** the extension SHALL start periodic OSC 11 polling

#### Scenario: Polling disabled when mode 2031 succeeds

- **WHEN** startup detection returns a result via mode 2031
- **THEN** the extension SHALL NOT start periodic OSC 11 polling

#### Scenario: Polling disabled when OSC 11 fails

- **WHEN** startup detection falls through both mode 2031 and OSC 11, reaching COLORFGBG or default
- **THEN** the extension SHALL NOT start periodic OSC 11 polling

### Requirement: Overlapping poll prevention

The extension SHALL NOT initiate a new OSC 11 poll while a previous poll is still awaiting a response. If the polling interval fires while a query is in flight, that tick SHALL be skipped.

#### Scenario: Poll skipped when query in flight

- **WHEN** the polling interval fires
- **AND** a previous OSC 11 query has been sent but has not yet resolved or timed out
- **THEN** the extension SHALL skip this polling tick

#### Scenario: Poll proceeds when no query in flight

- **WHEN** the polling interval fires
- **AND** no OSC 11 query is pending (previous poll completed or timed out)
- **THEN** the extension SHALL send a new OSC 11 query

### Requirement: Polling interval configuration

The extension SHALL read the polling interval from `osc11PollIntervalMs` in `auto-theme-config.json`, defaulting to 30000 milliseconds (30 seconds) if not specified. A value of 0 SHALL disable periodic polling.

#### Scenario: Default interval when unset

- **WHEN** `auto-theme-config.json` does not contain `osc11PollIntervalMs`
- **THEN** the extension SHALL use 30000 milliseconds as the polling interval

#### Scenario: Custom interval from config

- **WHEN** `auto-theme-config.json` specifies `osc11PollIntervalMs: 60000`
- **THEN** the extension SHALL poll every 60 seconds

#### Scenario: Polling disabled via config

- **WHEN** `auto-theme-config.json` specifies `osc11PollIntervalMs: 0`
- **THEN** the extension SHALL NOT start periodic OSC 11 polling regardless of detection results

### Requirement: Polling exponential backoff on repeated timeouts

When consecutive OSC 11 polls time out (no response within 200ms), the extension SHALL progressively increase the polling interval. Each consecutive timeout SHALL double the effective interval, capped at 300000 milliseconds (5 minutes). On the first successful response after timeouts, the interval SHALL reset to the configured `osc11PollIntervalMs`.

#### Scenario: First timeout doubles interval

- **WHEN** a poll times out (1st consecutive timeout)
- **THEN** the next poll SHALL be scheduled after 60000 milliseconds instead of the configured 30000

#### Scenario: Second timeout doubles again

- **WHEN** a poll times out (2nd consecutive timeout)
- **THEN** the next poll SHALL be scheduled after 120000 milliseconds

#### Scenario: Interval capped at 5 minutes

- **WHEN** consecutive timeouts reach the cap
- **THEN** the next poll SHALL be scheduled after 300000 milliseconds

#### Scenario: Successful response resets interval

- **WHEN** a poll succeeds after one or more timeouts
- **THEN** the consecutive timeout counter SHALL reset to 0
- **AND** the next poll SHALL be scheduled after the configured `osc11PollIntervalMs`

### Requirement: Polling lifecycle

The extension SHALL start periodic polling during `session_start` (after detection completes and conditional activation is determined) and SHALL stop polling during `session_shutdown`. The `/theme-auto` toggle SHALL also stop polling when auto-theme is disabled and restart it (with a fresh detection and conditional check) when re-enabled.

#### Scenario: Polling starts at session start

- **WHEN** `session_start` fires and startup detection completes with OSC 11 as the successful method
- **THEN** the extension SHALL begin periodic OSC 11 polling

#### Scenario: Polling stops at session shutdown

- **WHEN** `session_shutdown` fires
- **THEN** the extension SHALL clear the polling interval timer

#### Scenario: Polling stops when auto-theme disabled

- **WHEN** the user toggles auto-theme off via `/theme-auto`
- **THEN** the extension SHALL clear the polling interval timer

#### Scenario: Polling restarts when auto-theme re-enabled

- **WHEN** the user toggles auto-theme on via `/theme-auto`
- **AND** the re-detection confirms OSC 11 support without mode 2031
- **THEN** the extension SHALL begin periodic OSC 11 polling