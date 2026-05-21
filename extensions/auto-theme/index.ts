/**
 * Auto-theme extension for pi.
 *
 * Detects terminal color scheme (DEC mode 2031 → OSC 11 → COLORFGBG)
 * and automatically applies the configured dark or light theme.
 *
 * Provides /theme-auto command for interactive settings.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config";
import type { AutoThemeConfig } from "./config";
import {
  cancelAllPending,
  detectColorScheme,
  disableMode2031,
  enableMode2031,
  handleTerminalInput,
  resolveTheme,
} from "./detection";
import { showSettingsMenu } from "./menu";

// ─── Shared module-level state ────────────────────────────────────────────

let config: AutoThemeConfig = {
  enabled: true,
  darkTheme: "dark",
  lightTheme: "light",
};
let currentScheme: "dark" | "light" | null = null;
let unsubStdin: (() => void) | null = null;
let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Theme helpers ────────────────────────────────────────────────────────

/** Apply a theme with fallback to the built-in dark/light defaults. */
function applyTheme(theme: string, ctx: ExtensionContext): boolean {
  let result = ctx.ui.setTheme(theme);
  if (!result.success) {
    const fallback = theme === config.darkTheme ? "dark" : "light";
    if (fallback !== theme) {
      result = ctx.ui.setTheme(fallback);
    }
  }
  if (!result.success) {
    console.error(
      `[auto-theme] Failed to set theme "${theme}": ${
        result.error ?? "unknown"
      }`,
    );
    return false;
  }
  return true;
}

// ─── Stdin handler ────────────────────────────────────────────────────────

/** Register the onTerminalInput handler for the current context. */
function registerStdinHandler(ctx: ExtensionContext): void {
  unsubStdin = ctx.ui.onTerminalInput((data) => {
    const pushEvent = handleTerminalInput(data);

    if (data.startsWith("\x1b[?2031;")) {
      if (pushEvent !== undefined) handlePush(pushEvent, ctx);
      return { consume: true };
    }

    if (data.startsWith("\x1b]11;")) {
      if (pushEvent !== undefined) handlePush(pushEvent, ctx);
      return { consume: true };
    }

    return undefined;
  });
}

// ─── Detection & switching ────────────────────────────────────────────────

async function detectAndApply(ctx: ExtensionContext): Promise<void> {
  if (!config.enabled) return;

  try {
    const scheme = await detectColorScheme();
    currentScheme = scheme;
    const theme = resolveTheme(scheme, config);

    if (applyTheme(theme, ctx)) {
      ctx.ui.notify(`Auto-theme: ${scheme} → ${theme}`, "info");
    }
  } catch (err) {
    console.error("[auto-theme] Detection error:", err);
  }
}

/** Handle a mode 2031 push notification with debounce. */
function handlePush(
  darkOrLight: "dark" | "light",
  ctx: ExtensionContext,
): void {
  if (!config.enabled) return;

  if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => {
    try {
      if (darkOrLight === currentScheme) return;

      currentScheme = darkOrLight;
      const theme = resolveTheme(darkOrLight, config);

      if (applyTheme(theme, ctx)) {
        ctx.ui.notify(`Auto-theme: ${darkOrLight} → ${theme}`, "info");
      }
    } catch (err) {
      console.error("[auto-theme] Push handling error:", err);
    }
  }, 200);
}

// ─── Extension entry point ────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  // ── Lifecycle: session_start ──

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    config = readConfig(ctx.cwd);

    if (!config.enabled) return;

    // Clean up any stale subscription (e.g. from reload)
    if (unsubStdin) {
      unsubStdin();
      unsubStdin = null;
    }

    enableMode2031();
    registerStdinHandler(ctx);

    await detectAndApply(ctx);
  });

  // ── Lifecycle: session_shutdown ──

  pi.on("session_shutdown", (_event) => {
    disableMode2031();
    cancelAllPending();

    if (unsubStdin) {
      unsubStdin();
      unsubStdin = null;
    }

    if (pushDebounceTimer) {
      clearTimeout(pushDebounceTimer);
      pushDebounceTimer = null;
    }
  });

  // ── Command: /theme-auto ──

  pi.registerCommand("theme-auto", {
    description: "Configure automatic theme detection",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Auto-theme requires interactive mode", "error");
        return;
      }

      // Re-read config (may have changed since startup)
      config = readConfig(ctx.cwd);

      const detectNow = async (
        cfg: AutoThemeConfig,
      ): Promise<"dark" | "light"> => {
        const scheme = await detectColorScheme();
        currentScheme = scheme;
        const theme = resolveTheme(scheme, cfg);
        applyTheme(theme, ctx);
        return scheme;
      };

      const onToggle = (enabled: boolean): void => {
        if (enabled) {
          enableMode2031();
          if (!unsubStdin) registerStdinHandler(ctx);
        } else {
          disableMode2031();
          if (unsubStdin) {
            unsubStdin();
            unsubStdin = null;
          }
          cancelAllPending();
        }
      };

      const onThemeApply = (theme: string): boolean => {
        return applyTheme(theme, ctx);
      };

      config = await showSettingsMenu(
        ctx,
        config,
        currentScheme,
        detectNow,
        onToggle,
        onThemeApply,
      );
    },
  });
}
