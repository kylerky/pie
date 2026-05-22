## Context

The auto-theme extension (`extensions/auto-theme/`) detects terminal color scheme via a multi-tier chain: DEC mode 2031 (query + push), OSC 11 (one-shot query), COLORFGBG, and default "dark". Runtime theme changes are handled by two push channels: DEC mode 2031 push notifications and spontaneous OSC 11 broadcasts from terminals like Kitty and Ghostty. See `detection.ts` for the current implementation.

However, most modern terminals (iTerm2, Alacritty, VS Code, Windows Terminal, GNOME Terminal, foot) support OSC 11 queries but do **not** send mode 2031 push notifications or spontaneous OSC 11 broadcasts. For these terminals, the extension only detects the color scheme at startup — it has no way to respond to runtime changes. The OSC 11 one-shot query at startup confirms that these terminals *can* respond to OSC 11, but the extension never asks again after startup.

The existing `handleTerminalInput()` function already handles OSC 11 responses in both "query response" mode (when `pendingOsc11Resolve` is set) and "push" mode (spontaneous broadcasts when nothing is pending). Adding periodic polling reuses this machinery — it simply creates a recurring query that goes through the same response path.

## Goals / Non-Goals

**Goals:**

- Add periodic OSC 11 polling so terminals without push notifications can detect runtime theme changes
- Activate polling only when startup detection proves OSC 11 works but mode 2031 is unavailable
- Reuse existing `queryOsc11()` and `handleTerminalInput()` infrastructure — no new stdin parsing
- Deduplicate poll results against current scheme (same as existing push dedup)
- Prevent overlapping polls (skip if a query is already in flight)
- Back off polling frequency on repeated timeouts to avoid wasted work on unresponsive terminals
- Respect the `enabled` toggle in `/theme-auto` — stop polling when disabled, start when re-enabled

**Non-Goals:**

- Polling for COLORFGBG (environment variable rarely changes at runtime)
- Polling when mode 2031 push is available (unnecessary)
- New configuration UI elements (config field is file-only for now)
- Changing the luminance threshold or OSC 11 parsing logic
- Supporting non-RGB OSC 11 formats

## Decisions

### Decision 1: Conditional polling — only when mode 2031 is unavailable

**Choice:** After startup detection completes, check which tier succeeded. If Tier 1 (mode 2031) succeeded, polling is NOT started. If Tier 2 (OSC 11) succeeded, polling IS started. If Tier 3 (COLORFGBG) or Tier 4 (default), polling is NOT started (terminal can't answer OSC 11).

**Alternatives considered:**
- *Always poll regardless*: Simpler code, but wastes I/O when push already works. Adds unnecessary risk of interleaved queries with push events.
- *Poll on all terminals unconditionally*: Even simpler, but terminals that don't support OSC 11 would poll infinitely with timeouts.

**Rationale:** The startup detection chain already tells us exactly which methods the terminal supports. Extracting this signal requires minimal code change (returning a `method` field alongside `scheme` from `detectColorScheme()`). The conditional check is a one-line `if`.

---

### Decision 2: Polling interval — 30 seconds default, configurable

**Choice:** Default polling interval of 30 seconds (`osc11PollIntervalMs: 30000` in config). User can override via `auto-theme-config.json`. Setting to 0 disables polling entirely.

**Alternatives considered:**
- *5 seconds*: Faster response to theme changes, but 720 polls/hr feels excessive for a change that happens at human timescales.
- *60 seconds*: Minimal, but users might wonder why the theme didn't switch for a full minute.
- *Adaptive (fast after user activity, slow when idle)*: More responsive but adds significant complexity. Premature optimization.

**Rationale:** 30 seconds is a good balance. Theme changes happen when users switch system appearance — a 30-second lag is barely noticeable. At 120 polls per hour, the overhead is ~1 byte/second average.

---

### Decision 3: Overlapping poll prevention — skip if query already in flight

**Choice:** The `setInterval` callback checks whether `pendingOsc11Resolve` is non-null. If a previous poll hasn't resolved yet, the interval tick is skipped.

**Alternatives considered:**
- *setTimeout chaining*: Start next poll only after previous completes. This avoids overlaps but can drift — if one poll takes 200ms (timeout), the next starts later. Over hours, intervals compound.
- *Allow overlapping polls*: Multiple concurrent OSC 11 queries on stdin could interleave responses unpredictably. The Promise-based resolver might receive the wrong response.

**Rationale:** The check is trivial (`if (pendingOsc11Resolve !== null) return;`) and prevents the only real concurrency concern. Since normal response latency is 10-50ms, skipped ticks are extremely rare (only when terminal is slow to respond).

---

### Decision 4: Exponential backoff on repeated timeouts

**Choice:** Track consecutive timeout count. On each timeout, double the polling interval (30s → 60s → 120s → 240s → 300s cap). On first successful response, reset to the configured interval.

**Alternatives considered:**
- *Fixed interval regardless of timeouts*: Simpler but wastes effort on terminals that stopped responding (e.g., terminal closed and reopened in a different context).
- *Disable polling after N timeouts*: Too aggressive — user might change terminal settings and expect theme to be detected.

**Rationale:** Timeouts mean the terminal isn't responding. Backing off reduces wasted work while keeping the door open for recovery. The 5-minute cap ensures polling eventually resumes at a reasonable rate even if the terminal stays unresponsive.

---

### Decision 5: Return detection method from `detectColorScheme()`

**Choice:** Change `detectColorScheme()` return type from `Promise<"dark" | "light">` to `Promise<{ scheme: "dark" | "light"; method: "mode2031" | "osc11" | "colorfgbg" | "default" }>`.

**Alternatives considered:**
- *Separate function to query method*: Would require running detection twice or restructuring the chain. Adds duplication.
- *Module-level variable tracking last method*: Less explicit, harder to test, implicit dependency.

**Rationale:** The change is small (modify the return type and add `method` tracking in the `detectColorScheme` function body). Callers that only need the scheme can destructure `.scheme`. This is a local, well-contained API change.

---

### Decision 6: Poll lifecycle management in index.ts

**Choice:** The polling interval timer is started in `session_start` (after detection completes) and stopped in `session_shutdown` (via cleanup function). The `/theme-auto` toggle handler also starts/stops polling inline with the existing `enableMode2031()`/`disableMode2031()` calls.

**Alternatives considered:**
- *Manage polling entirely in detection.ts*: Would require detection.ts to know about `ctx`, coupling concerns.
- *Web Worker / separate process*: Over-engineering for a 30-second interval timer.

**Rationale:** index.ts already manages the overall lifecycle and is the bridge between detection.ts (pure logic) and the Pi extension API. Adding polling timer management here follows the existing pattern.

## Risks / Trade-offs

- **[Risk] Terminal echoes OSC 11 query back as keystrokes**: Some terminals might not recognize the query and pass it through as text input. → **Mitigation**: This is a pre-existing risk for the one-shot startup query. If a terminal doesn't support OSC 11, it won't respond and the 200ms timeout will fire. The query string itself (7 bytes) doesn't match any OSC response pattern, so the stdin handler ignores it. No new risk introduced.

- **[Risk] Poll response arrives during a mode 2031 push**: Both events converge on `handlePush()`, which deduplicates by comparing against `currentScheme`. Whichever wins the race determines whether a theme switch occurs; the other becomes a no-op. → **Mitigation**: Existing dedup logic handles this correctly without modification.

- **[Risk] Polling overhead on battery-powered devices**: At 30-second intervals, ~120 polls per hour, each taking < 1ms CPU. → **Mitigation**: Negligible power impact. The terminal process itself consumes orders of magnitude more power for rendering. Not worth optimizing.

- **[Trade-off] No visual indicator that polling is active**: Users can't easily tell whether their terminal is using push (mode 2031) or polling (OSC 11). → **Mitigation**: This is a UX polish concern, not a correctness concern. Can be addressed in a future change (e.g., `/theme-auto` status display showing detection method).

- **[Trade-off] 30-second detection lag for non-push terminals**: A user switching system/appearance themes must wait up to 30 seconds for Pi to react. → **Mitigation**: This is inherent to polling. Users on mode-2031-capable terminals get instant push. For polling terminals, a 30-second lag on a cosmetic change is acceptable.