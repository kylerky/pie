/**
 * Terminal color scheme detection.
 *
 * Multi-tier fallback chain:
 *   1. DEC mode 2031  (CSI ? 2031 $ p)
 *   2. OSC 11          (\x1b]11;?\x1b\\)
 *   3. COLORFGBG env   (xterm palette position)
 *   4. Default "dark"
 *
 * Uses shared internal state for Promise-based response waiting.
 * The stdin handler in index.ts delegates to handleTerminalInput().
 *
 * Also provides periodic OSC 11 polling with exponential backoff
 * for terminals that support OSC 11 queries but not mode 2031 push
 * notifications.
 */

import {
  classifyLuminance,
  parseOsc11Response,
  relativeLuminance,
} from "./luminance";
import type { AutoThemeConfig } from "./config";

// ─── Types ───────────────────────────────────────────────────────────────

export type DetectionMethod =
  | "mode2031"
  | "osc11"
  | "colorfgbg"
  | "default";

export type DetectionResult = {
  scheme: "dark" | "light";
  method: DetectionMethod;
};

// ─── Internal state for response waiting ──────────────────────────────────

const POLLING_BACKOFF_CAP_MS = 300_000; // 5 minutes

let pending2031Resolve: ((v: "dark" | "light" | null) => void) | null = null;
let pending2031Timer: ReturnType<typeof setTimeout> | null = null;

let pendingOsc11Resolve: ((v: "dark" | "light" | null) => void) | null = null;
let pendingOsc11Timer: ReturnType<typeof setTimeout> | null = null;

// Polling state (used by startOsc11Polling)
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveTimeouts = 0;

// ─── Internal helpers ────────────────────────────────────────────────────

function clearPending2031(): void {
  if (pending2031Timer) clearTimeout(pending2031Timer);
  pending2031Resolve = null;
  pending2031Timer = null;
}

function clearPendingOsc11(): void {
  if (pendingOsc11Timer) clearTimeout(pendingOsc11Timer);
  pendingOsc11Resolve = null;
  pendingOsc11Timer = null;
}

export function cancelAllPending(): void {
  if (pending2031Resolve) pending2031Resolve(null);
  if (pendingOsc11Resolve) pendingOsc11Resolve(null);
  clearPending2031();
  clearPendingOsc11();
}

// ─── Terminal I/O ─────────────────────────────────────────────────────────

export function enableMode2031(): void {
  process.stdout.write("\x1b[?2031h");
}

export function disableMode2031(): void {
  process.stdout.write("\x1b[?2031l");
}

// ─── Stdin handler (delegated from index.ts) ─────────────────────────────

/**
 * Process incoming terminal data for color scheme responses.
 *
 * Returns:
 *   - `"dark" | "light"` — mode 2031 push or spontaneous OSC 11
 *     broadcast (caller should switch theme)
 *   - `undefined` — consumed internally (query response) or not a match
 */
export function handleTerminalInput(
  data: string,
): "dark" | "light" | undefined {
  // Mode 2031: CSI ? 2031 ; 0/1 $ y  (same format for query & push)
  if (data.startsWith("\x1b[?2031;")) {
    const match = data.match(/\x1b\[\?2031;([01])\$/);
    if (match) {
      const value: "dark" | "light" = match[1] === "1" ? "dark" : "light";

      if (pending2031Resolve) {
        const resolve = pending2031Resolve;
        clearPending2031();
        resolve(value);
        return undefined; // Query response — resolved internally
      }

      return value; // Push notification — caller should apply theme
    }
  }

  // OSC 11: \x1b]11;rgb:rrrr/gggg/bbbb\x1b\\
  if (data.startsWith("\x1b]11;")) {
    const rgb = parseOsc11Response(data);
    const scheme = rgb
      ? classifyLuminance(relativeLuminance(rgb.r, rgb.g, rgb.b))
      : null;

    if (pendingOsc11Resolve) {
      const resolve = pendingOsc11Resolve;
      clearPendingOsc11();
      resolve(scheme);
      return undefined; // Query response — resolved internally
    }

    // Spontaneous OSC 11 broadcast — treat as push event
    return scheme ?? undefined;
  }

  return undefined;
}

// ─── Query functions ──────────────────────────────────────────────────────

export function queryMode2031(
  timeoutMs: number = 200,
): Promise<"dark" | "light" | null> {
  return new Promise((resolve) => {
    clearPending2031();

    const timer = setTimeout(() => {
      pending2031Resolve = null;
      pending2031Timer = null;
      resolve(null);
    }, timeoutMs);

    pending2031Resolve = resolve;
    pending2031Timer = timer;

    process.stdout.write("\x1b[?2031$p");
  });
}

export function queryOsc11(
  timeoutMs: number = 200,
): Promise<"dark" | "light" | null> {
  return new Promise((resolve) => {
    clearPendingOsc11();

    const timer = setTimeout(() => {
      pendingOsc11Resolve = null;
      pendingOsc11Timer = null;
      resolve(null);
    }, timeoutMs);

    pendingOsc11Resolve = resolve;
    pendingOsc11Timer = timer;

    process.stdout.write("\x1b]11;?\x1b\\");
  });
}

// ─── COLORFGBG fallback ───────────────────────────────────────────────────

export function detectColorFgBg(): "dark" | "light" | null {
  const raw = process.env.COLORFGBG;
  if (!raw) return null;

  const parts = raw.split(";");
  if (parts.length < 2) return null;

  const bg = parseInt(parts[1], 10);
  if (isNaN(bg)) return null;

  // Standard xterm 16-color palette: 0–7 dark, 8–15 light
  return bg < 8 ? "dark" : "light";
}

// ─── Orchestration ────────────────────────────────────────────────────────

export async function detectColorScheme(): Promise<DetectionResult> {
  // 1. DEC mode 2031
  const mode2031 = await queryMode2031(200);
  if (mode2031) return { scheme: mode2031, method: "mode2031" };

  // 2. OSC 11
  const osc11 = await queryOsc11(200);
  if (osc11) return { scheme: osc11, method: "osc11" };

  // 3. COLORFGBG
  const fgbg = detectColorFgBg();
  if (fgbg) return { scheme: fgbg, method: "colorfgbg" };

  // 4. Default
  return { scheme: "dark", method: "default" };
}

// ─── OSC 11 periodic polling ─────────────────────────────────────────────

/**
 * Start periodic OSC 11 polling to detect runtime color scheme changes.
 *
 * Uses `setTimeout` chaining with exponential backoff on repeated timeouts.
 * The returned cleanup function stops polling and cancels any pending timer.
 *
 * @param intervalMs  Base polling interval in milliseconds.
 * @param getCurrentScheme  Callback returning the current scheme for dedup.
 * @param onSchemeChange  Called when a poll detects a scheme change.
 * @returns  Cleanup function that permanently stops polling.
 */
export function startOsc11Polling(
  intervalMs: number,
  getCurrentScheme: () => "dark" | "light" | null,
  onSchemeChange: (scheme: "dark" | "light") => void,
): () => void {
  consecutiveTimeouts = 0;
  let stopped = false;

  function scheduleNext(delayMs: number): void {
    if (stopped) return;

    pollingTimer = setTimeout(async () => {
      if (stopped) return;

      // Overlapping poll prevention: skip if a query is already in flight
      if (pendingOsc11Resolve !== null) {
        scheduleNext(delayMs);
        return;
      }

      const result = await queryOsc11(200);

      if (stopped) return;

      if (result === null) {
        // Timeout — apply exponential backoff
        consecutiveTimeouts++;
        const backoffMs = Math.min(
          intervalMs * Math.pow(2, consecutiveTimeouts),
          POLLING_BACKOFF_CAP_MS,
        );
        scheduleNext(backoffMs);
      } else {
        // Success — reset backoff to configured interval
        consecutiveTimeouts = 0;

        // Deduplicate against current scheme
        if (result !== getCurrentScheme()) {
          onSchemeChange(result);
        }

        scheduleNext(intervalMs);
      }
    }, delayMs);
  }

  scheduleNext(intervalMs);

  return () => {
    stopped = true;
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
  };
}

export function resolveTheme(
  darkOrLight: "dark" | "light",
  config: AutoThemeConfig,
): string {
  return darkOrLight === "dark" ? config.darkTheme : config.lightTheme;
}
