## 1. Module scaffolding and test setup

- [x] 1.1 Create extension directory structure
      (`extensions/terminal-appearance/`) and entry point (`index.ts`)
- [x] 1.2 Create test file (`test/terminal-appearance.test.ts`) using Deno's
      built-in test runner (`deno test`), with a `deno.json` or `deno.jsonc`
      config if needed
- [x] 1.3 Commit initial scaffolding

## 2. OSC 11 query and response parsing (one-shot detection)

- [x] 2.1 Write failing tests: dark background (rgb:0000/0000/0000), light
      background (rgb:ffff/ffff/ffff), DA1 sentinel before OSC 11, 2-digit hex,
      1-digit hex, rgba prefix
- [x] 2.2 Implement
      `detectAppearance(reader: ReadableStream<Uint8Array>, writer: WritableStream<Uint8Array>): Promise<"dark" | "light">`
      that sends OSC 11 + DA1 and awaits response via the provided reader/writer
- [x] 2.3 Implement
      `#parseOsc11Response(sequence: string): { r: number; g: number; b: number }`
      extracting R/G/B hex, normalizing to [0,1] for any digit count (1-4)
- [x] 2.4 Implement `#computeLuminance(r: number, g: number, b: number): number`
      using BT.601 weights (0.299, 0.587, 0.114)
- [x] 2.5 Ensure tests pass for all parsing and luminance scenarios
- [x] 2.6 Commit core detection implementation

## 3. Continuous monitoring (Mode 2031 + polling fallback)

- [x] 3.1 Write failing tests: Mode 2031 notification triggers re-query,
      multiple notifications coalesce (debounce), polling fires every 2s,
      polling stops when Mode 2031 fires, same-appearance dedup does not fire
      callback
- [x] 3.2 Implement
      `watchAppearance(reader: ReadableStream<Uint8Array>, writer: WritableStream<Uint8Array>, callback: (appearance: "dark" | "light") => void): { stop(): void }`
      that enables Mode 2031, starts polling, and manages lifecycle
- [x] 3.3 Implement Mode 2031 handler: send `\x1b[?2031h`, detect `\x1b[?997;1n`
      / `\x1b[?997;2n` responses, debounce 100ms, re-query OSC 11
- [x] 3.4 Implement 2s polling fallback with `setInterval` + `Deno.unrefTimer()`
      (or equivalent) that self-disables on first Mode 2031 notification
- [x] 3.5 Implement deduplication: track last reported appearance, skip callback
      when unchanged
- [x] 3.6 Implement `stop()`: disable Mode 2031 (`\x1b[?2031l`), clear polling
      timer, clean up stdin handler
- [x] 3.7 Ensure all monitoring tests pass
- [x] 3.8 Commit continuous monitoring implementation

## 4. Export and integration

- [x] 4.1 Export `detectAppearance` and `watchAppearance` from the module entry
      point
- [x] 4.2 Add module-level TypeScript types (`TerminalAppearance`,
      `AppearanceCallback`, `AppearanceWatcher`)
- [x] 4.3 Verify exports work via a smoke test that imports the module with
      `deno run` without errors
- [x] 4.4 Commit final integration
