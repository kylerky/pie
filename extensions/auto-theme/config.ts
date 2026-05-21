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
}

const DEFAULT_CONFIG: AutoThemeConfig = {
  enabled: true,
  darkTheme: "dark",
  lightTheme: "light",
};

function configPath(cwd: string): string {
  return path.join(cwd, ".pi", "auto-theme-config.json");
}

export function readConfig(cwd: string): AutoThemeConfig {
  try {
    const raw = fs.readFileSync(configPath(cwd), "utf-8");
    const parsed = JSON.parse(raw);
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
