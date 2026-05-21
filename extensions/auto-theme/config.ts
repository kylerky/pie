/**
 * Configuration module for auto-theme extension.
 *
 * Reads/writes `.pi/auto-theme-config.json` in the project root.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface AutoThemeConfig {
  enabled: boolean;
  darkTheme: string;
  lightTheme: string;
  /** Polling interval in ms for OSC 11 (0 = disabled). Default 30000. */
  osc11PollIntervalMs?: number;
}

const DEFAULT_CONFIG: AutoThemeConfig = {
  enabled: true,
  darkTheme: "dark",
  lightTheme: "light",
  osc11PollIntervalMs: 30000,
};

function configPath(cwd: string): string {
  return path.join(cwd, ".pi", "auto-theme-config.json");
}

export function readConfig(cwd: string): AutoThemeConfig {
  try {
    const raw = fs.readFileSync(configPath(cwd), "utf-8");
    const parsed = JSON.parse(raw);
    const osc11PollIntervalMs =
      typeof parsed.osc11PollIntervalMs === "number" &&
        Number.isFinite(parsed.osc11PollIntervalMs) &&
        Number.isInteger(parsed.osc11PollIntervalMs) &&
        parsed.osc11PollIntervalMs >= 0
        ? parsed.osc11PollIntervalMs
        : DEFAULT_CONFIG.osc11PollIntervalMs!;
    return {
      enabled: typeof parsed.enabled === "boolean"
        ? parsed.enabled
        : DEFAULT_CONFIG.enabled,
      darkTheme: typeof parsed.darkTheme === "string"
        ? parsed.darkTheme
        : DEFAULT_CONFIG.darkTheme,
      lightTheme: typeof parsed.lightTheme === "string"
        ? parsed.lightTheme
        : DEFAULT_CONFIG.lightTheme,
      osc11PollIntervalMs,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(cwd: string, config: AutoThemeConfig): void {
  const filePath = configPath(cwd);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}
