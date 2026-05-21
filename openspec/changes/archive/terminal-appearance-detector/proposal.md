## Why

The oh-my-pi coding agent already implements Tier 1 terminal background color
detection (OSC 11 query + DA1 sentinel + BT.601 luminance) to auto-detect
dark/light mode. This capability should be extracted into a standalone, reusable
Pi extension so other agents, tools, and scripts can detect terminal appearance
without reimplementing the OSC 11 protocol, sentinel logic, and luminance math.

## What Changes

- A new Pi extension (`terminal-appearance-detection`) that detects whether the
  terminal background is dark or light
- Sends OSC 11 (`\x1b]11;?\x07`) to query the terminal's background color with a
  DA1 (`\x1b[c`) sentinel to detect unsupporting terminals
- Parses the OSC 11 response (supports both `rgb:` and `rgba:` prefixes, any hex
  digit count) and computes BT.601 luminance
- Returns `"dark"` when luminance < 0.5, `"light"` otherwise
- Optionally supports Mode 2031 (`\x1b[?2031h`) push-based change notifications
  for terminals that support it
- Falls back to periodic polling (2s interval) for terminals without Mode 2031
- Works across Unix and Windows platforms
- Targets Deno as primary runtime

## Capabilities

### New Capabilities

- `terminal-appearance-detection`: A standalone module/script that exposes OSC
  11-based terminal background detection. Accepts stdin/stdout handles as input,
  sends OSC 11 query with DA1 sentinel, parses the hex RGB response, computes
  BT.601 luminance, and classifies the result as dark or light. Supports
  optional continuous monitoring via Mode 2031 or polling.

### Modified Capabilities

<!-- No existing capabilities are modified. -->

## Impact

- New source files in the `extensions/` directory (standard Pi extension
  auto-discovery path)
- Runtime-agnostic: targets Deno as primary runtime, using standard Web APIs
  (`ReadableStream`, `WritableStream`, `TextEncoder`, `setInterval`) available
  in Deno, Node.js 18+, and Bun. Raw mode and stdio setup are abstracted behind
  a reader/writer interface so callers on any runtime can provide streams.
- No external dependencies beyond the runtime's standard library
- Compatible with any terminal emulator that supports OSC 11 (most modern
  terminals: Kitty, WezTerm, Alacritty, iTerm2, Windows Terminal, Ghostty, etc.)
