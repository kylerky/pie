## Context

The oh-my-pi coding agent's `ProcessTerminal` class in
`packages/tui/src/terminal.ts` already implements Tier 1 terminal background
color detection via OSC 11 queries. This extension extracts that detection logic
into a standalone, reusable module that any Pi tool or script can use.

### Protocol Overview

The terminal appearance detection uses the following escape sequences:

| Sequence        | Purpose                                                  |
| --------------- | -------------------------------------------------------- |
| `\x1b]11;?\x07` | OSC 11 query: ask terminal for background color          |
| `\x1b[c`        | DA1 sentinel: detect terminals that don't support OSC 11 |
| `\x1b[?2031h`   | Mode 2031: enable appearance change notifications        |
| `\x1b[?997;1n`  | Mode 2031 response: terminal reports dark mode change    |
| `\x1b[?997;2n`  | Mode 2031 response: terminal reports light mode change   |

### BT.601 Luminance

The background color is classified using relative luminance per BT.601:

```
luminance = 0.299 × R + 0.587 × G + 0.114 × B
```

Where R, G, B are normalized to [0, 1] from the OSC 11 hex response. If
luminance < 0.5, the terminal is dark; otherwise light.

## Goals / Non-Goals

**Goals:**

- Provide a single-shot function that queries the terminal background color and
  returns `"dark"` or `"light"`
- Support the DA1 sentinel to detect terminals without OSC 11 support (avoid
  hanging)
- Parse OSC 11 responses with varying hex digit counts (1-4) and both `rgb:` and
  `rgba:` prefixes
- Offer optional continuous monitoring via Mode 2031 push notifications with
  debounce
- Fall back to periodic polling for terminals without Mode 2031 support
- Work on Unix and Windows

**Non-Goals:**

- Keyboard protocol detection or raw mode management (caller handles stdin
  setup)
- COLORFGBG environment variable fallback (belongs in Tier 2)
- macOS system appearance detection (belongs in Tier 3)
- Theme switching or integration with Pi's theme system (caller decides what to
  do with the result)

## Decisions

### Decision 1: Single-function API with callback-based monitoring

A synchronous `detectAppearance()` function returns a promise-based result for
one-shot queries. A separate `watchAppearance(callback)` function handles
continuous monitoring.

**Alternatives considered:**

- EventEmitter pattern — adds unnecessary complexity for a single detection
  result
- Stream-based API — overkill for a binary dark/light output

**Rationale:** The extension is a low-level building block. Callers integrate it
into their own event loops.

### Decision 2: DA1 sentinel (not timeout-based)

Use a DA1 (`\x1b[c`) sentinel exchange to detect unsupporting terminals,
matching the technique used by Neovim, bat, and fish.

**Alternatives considered:**

- Timeout-based (wait N ms for OSC 11 response) — unreliable across slow SSH
  connections and terminal multiplexers
- Pre-check via `TERM` or `COLORTERM` — those variables don't reliably indicate
  OSC 11 support

**Rationale:** The DA1 sentinel is the only reliable way to distinguish
"terminal doesn't support OSC 11" from "response was delayed."

### Decision 3: Deno as primary runtime, Web APIs for portability

The extension targets Deno as its primary runtime. It uses only standard Web
APIs (`ReadableStream`, `WritableStream`, `TextEncoder`, `TextDecoder`,
`setInterval`, `clearInterval`) that are supported across all three major
JavaScript runtimes (Deno, Node.js 18+, Bun).

Raw mode and terminal I/O are not handled by the extension itself — callers pass
in a `ReadableStream<Uint8Array>` (for reading escape sequences) and a
`WritableStream<Uint8Array>` (for writing escape sequences), plus a mechanism to
set raw mode if needed. This keeps the extension runtime-agnostics: on Deno the
caller passes `Deno.stdin.readable` / `Deno.stdout.writable`, on Node the caller
converts `process.stdin` / `process.stdout` via `Readable.toWeb()` /
`Writable.toWeb()`, and on Bun the same Node-compat approach works.

There is no compilation or transpilation step — Deno runs TypeScript natively
via `deno run`. The extension module can be imported directly from a file path
or URL in any Deno script, or consumed via `tsx` on Node.

**Alternatives considered:**

- Node.js as primary — locks the extension to Node-specific APIs (`process`,
  `tty`, `node:stream/consumers`) that require polyfills or compat layers on
  Deno
- Bun-specific APIs — couples the extension to a single runtime
- Pure shell script — can't easily parse stdin streams or manage raw mode
- Python — would require a Python runtime alongside Pi's TypeScript ecosystem
- Rust native module — overkill for escape sequence parsing, introduces build
  complexity

**Rationale:** Deno's first-class TypeScript support and native Web Streams API
make it the cleanest target. Using only Web APIs ensures the extension works on
any JavaScript runtime Pi supports without pinning users to a specific one.

## Risks / Trade-offs

- **[Risk] Stdin buffer conflates user input with OSC 11 response** →
  Mitigation: The module uses a short-lived stdin reader that only captures the
  OSC 11 + DA1 exchange, then restores the previous handler. The query window is
  <50ms on local terminals.

- **[Risk] Slow SSH connections cause DA1 to arrive before OSC 11 on terminals
  that do support it** → Mitigation: The DA1 sentinel is consumed from the
  structured input buffer, not raw stdin. If a real DA1-like escape sequence
  arrives from another source during the query window, it would be incorrectly
  consumed. This is unlikely given DA1 is device-specific.

- **[Trade-off] Polling fallback wastes cycles on terminals that don't support
  Mode 2031** → Acceptable: 2-second polling with `unref()` on the timer means
  it won't keep the process alive. Mode 2031 disables polling when it fires.
