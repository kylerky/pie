## Context

The auto-theme extension's `handleTerminalInput()` function is the central dispatch point for terminal escape sequences arriving on stdin. It currently handles two sequence types:

- **DEC mode 2031** (`\x1b[?2031;0/1$y`): When a query is pending, it resolves the promise; otherwise it returns `"dark"` / `"light"` as a push event to the caller.
- **OSC 11** (`\x1b]11;rgb:...\x1b\\`): When a query is pending, it resolves the promise with the classified luminance. When no query is pending, it returns `undefined` — the data is silently consumed by the caller.

The caller (`registerStdinHandler` in `index.ts`) uses the return value to decide whether to trigger a theme change via `handlePush()`. For DEC 2031, it calls `handlePush()` when the return value is not `undefined`. For OSC 11, it unconditionally returns `{ consume: true }` and never calls `handlePush()`.

This change extends `handleTerminalInput()` to treat unmatched OSC 11 messages as push events, and updates the caller to act on them.

## Goals / Non-Goals

**Goals:**

- Process spontaneous OSC 11 broadcasts (no pending query) as terminal color scheme push notifications
- Parse the RGB value, compute luminance, classify as dark/light, and trigger theme switching
- Reuse the existing `handlePush()` debounce and deduplication logic
- Zero changes to the startup query flow or DEC 2031 handling

**Non-Goals:**

- Adding a polling mechanism (periodic OSC 11 queries) — that's a separate concern
- Modifying the luminance classification threshold or algorithm
- Adding new configuration options for this behavior
- Handling non-RGB OSC 11 formats (e.g., named colors)

## Decisions

### Decision 1: Extend `handleTerminalInput()` return value semantics

**Choice:** When `pendingOsc11Resolve` is null and an OSC 11 sequence arrives, parse the RGB, classify, and return `"dark"` or `"light"` (or `undefined` if parsing fails). Update the JSDoc to reflect that the return value can originate from either DEC 2031 or OSC 11.

**Alternatives considered:**
- *Separate function for OSC 11 push detection*: Adds indirection without benefit. The handler already owns both sequence types and the classification logic.
- *Signal the caller via a different mechanism* (e.g., callback): Over-engineering. The return value already encodes the scheme; extending its semantics is the simplest change.

**Rationale:** Minimizes code churn. The caller already knows how to handle `"dark" | "light"` return values. We just need it to check for OSC 11 too.

### Decision 2: Caller modification — check OSC 11 for push events

**Choice:** In `registerStdinHandler`, replace the unconditional `return { consume: true }` for OSC 11 with a check: if `pushEvent` is defined, call `handlePush(pushEvent, ctx)`.

Before:
```typescript
if (data.startsWith("\x1b]11;")) {
    return { consume: true };
}
```

After:
```typescript
if (data.startsWith("\x1b]11;")) {
    if (pushEvent !== undefined) handlePush(pushEvent, ctx);
    return { consume: true };
}
```

**Rationale:** Mirrors the existing DEC 2031 branch exactly. `handlePush()` already deduplicates (no-ops if scheme hasn't changed) and debounces (200ms), so no additional guards needed.

### Decision 3: Keep OSC 11 query response processing unchanged

**Choice:** The existing `if (pendingOsc11Resolve) { ... }` block stays first. Only the fallthrough path (no pending resolver) changes.

**Rationale:** Query responses must continue to resolve the awaiting promise. The new push path is only reached when no query is pending — exactly when we want push-like behavior.

## Risks / Trade-offs

- **[Risk] False positives from non-background OSC 11 messages**: OSC 11 is specifically for the terminal background color, so other OSC codes won't match the prefix. The regex-based parser further guards against malformed data. → **Mitigation**: `parseOsc11Response()` returns null on non-matching data, and we return `undefined` (no push triggered).

- **[Risk] Rapid OSC 11 broadcasts causing theme flicker**: Some terminals might emit multiple OSC 11 sequences in quick succession during a color transition. → **Mitigation**: The existing 200ms debounce in `handlePush()` absorbs rapid changes.

- **[Trade-off] No separate toggle for OSC 11 push vs. DEC 2031 push**: If a user's terminal emits both DEC 2031 and OSC 11, both channels are active. → **Mitigation**: `handlePush()` deduplicates by comparing against `currentScheme`. Whichever channel fires first wins; subsequent identical pushes are no-ops.