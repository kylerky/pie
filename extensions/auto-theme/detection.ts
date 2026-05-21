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
 */

import { parseOsc11Response, relativeLuminance, classifyLuminance } from "./luminance";
import type { AutoThemeConfig } from "./config";

// ─── Internal state for response waiting ──────────────────────────────────

let pending2031Resolve: ((v: "dark" | "light" | null) => void) | null = null;
let pending2031Timer: ReturnType<typeof setTimeout> | null = null;

let pendingOsc11Resolve: ((v: "dark" | "light" | null) => void) | null = null;
let pendingOsc11Timer: ReturnType<typeof setTimeout> | null = null;

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
 *   - `"dark" | "light"` — mode 2031 push (caller should switch theme)
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
    if (pendingOsc11Resolve) {
      const resolve = pendingOsc11Resolve;
      clearPendingOsc11();
      const rgb = parseOsc11Response(data);
      if (rgb) {
        const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
        resolve(classifyLuminance(lum));
      } else {
        resolve(null);
      }
    }
    // OSC 11 is always consumed when a query is or was pending.
    // Pass-through for unexpected OSC 11 noise.
    return undefined;
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

export async function detectColorScheme(): Promise<"dark" | "light"> {
  // 1. DEC mode 2031
  const mode2031 = await queryMode2031(200);
  if (mode2031) return mode2031;

  // 2. OSC 11
  const osc11 = await queryOsc11(200);
  if (osc11) return osc11;

  // 3. COLORFGBG
  const fgbg = detectColorFgBg();
  if (fgbg) return fgbg;

  // 4. Default
  return "dark";
}

export function resolveTheme(
  darkOrLight: "dark" | "light",
  config: AutoThemeConfig,
): string {
  return darkOrLight === "dark" ? config.darkTheme : config.lightTheme;
}