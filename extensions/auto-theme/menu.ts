/**
 * Interactive settings menu for /theme-auto command.
 *
 * Uses ctx.ui.select() dialogs to present a multi-level settings interface.
 * Manages toggle, dark/light theme selection, and "Detect now".
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { writeConfig } from "./config";
import type { AutoThemeConfig } from "./config";
import { resolveTheme } from "./detection";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeMainOptions(
  config: AutoThemeConfig,
): string[] {
  const status = config.enabled
    ? "✓ Auto Theme: enabled"
    : "✗ Auto Theme: disabled";
  return [
    status,
    `Auto dark theme: ${config.darkTheme}`,
    `Auto light theme: ${config.lightTheme}`,
    "Detect now",
  ];
}

function parseMainChoice(
  choice: string,
): "toggle" | "dark" | "light" | "detect" | null {
  if (choice.startsWith("✓") || choice.startsWith("✗")) return "toggle";
  if (choice.startsWith("Auto dark theme:")) return "dark";
  if (choice.startsWith("Auto light theme:")) return "light";
  if (choice === "Detect now") return "detect";
  return null;
}

// ─── Menu entry point ─────────────────────────────────────────────────────

export async function showSettingsMenu(
  ctx: ExtensionCommandContext,
  config: AutoThemeConfig,
  currentScheme: "dark" | "light" | null,
  detectNow: (cfg: AutoThemeConfig) => Promise<"dark" | "light">,
  onToggle: (enabled: boolean) => void,
  onThemeApply: (theme: string) => boolean,
): Promise<AutoThemeConfig> {
  let cfg = { ...config };
  let scheme = currentScheme;
  const cwd = ctx.cwd;

  while (true) {
    const options = makeMainOptions(cfg);
    const choice = await ctx.ui.select("Auto Theme Settings", options);
    if (choice === undefined) break; // cancelled

    const action = parseMainChoice(choice);
    if (!action) continue;

    switch (action) {
      case "toggle": {
        cfg.enabled = !cfg.enabled;
        writeConfig(cwd, cfg);
        onToggle(cfg.enabled);

        if (cfg.enabled) {
          // Re-detect and apply on toggle-on
          const detected = await detectNow(cfg);
          scheme = detected;
          ctx.ui.notify(
            `Auto-theme enabled — detected: ${detected} → ${
              resolveTheme(detected, cfg)
            }`,
            "info",
          );
        } else {
          ctx.ui.notify("Auto-theme disabled", "info");
        }
        break;
      }

      case "dark": {
        const themes = ctx.ui.getAllThemes();
        const themeNames = themes.map((t) => t.name);
        const selected = await ctx.ui.select("Select Dark Theme", themeNames);
        if (selected !== undefined) {
          cfg.darkTheme = selected;
          writeConfig(cwd, cfg);

          if (scheme === "dark") {
            if (!onThemeApply(selected)) {
              ctx.ui.notify(`Failed to apply theme "${selected}"`, "error");
            }
          }
        }
        break;
      }

      case "light": {
        const themes = ctx.ui.getAllThemes();
        const themeNames = themes.map((t) => t.name);
        const selected = await ctx.ui.select("Select Light Theme", themeNames);
        if (selected !== undefined) {
          cfg.lightTheme = selected;
          writeConfig(cwd, cfg);

          if (scheme === "light") {
            if (!onThemeApply(selected)) {
              ctx.ui.notify(`Failed to apply theme "${selected}"`, "error");
            }
          }
        }
        break;
      }

      case "detect": {
        const detected = await detectNow(cfg);
        scheme = detected;
        ctx.ui.notify(
          `Detected: ${detected} → ${resolveTheme(detected, cfg)}`,
          "info",
        );
        break;
      }
    }
  }

  return cfg;
}
