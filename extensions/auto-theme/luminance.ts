/**
 * sRGB luminance utilities for terminal background classification.
 *
 * Used to parse OSC 11 RGB responses and classify them as dark or light
 * via the WCAG relative luminance formula.
 */

/**
 * Convert a single sRGB channel to linear space.
 * Input: 0–65535 (16-bit). Output: 0–1 (linear).
 */
export function srgbChannelToLinear(value: number): number {
  const normalized = value / 65535;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.x relative luminance from 16-bit sRGB channels.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * Parse an OSC 11 response into RGB channel values.
 *
 * Handles both formats:
 *   - 16-bit: `\x1b]11;rgb:1a1a/2e2e/3c3c\x1b\\`
 *   - 8-bit:  `\x1b]11;rgb:1a/2e/3c\x1b\\`
 *
 * Returns null if the string doesn't match.
 */
export function parseOsc11Response(
  data: string,
): { r: number; g: number; b: number } | null {
  const match = data.match(
    /\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/,
  );
  if (!match) return null;

  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);

  // Scale 8-bit (1–2 hex digits) to full 16-bit range
  const scale = match[1].length <= 2 ? 257 : 1;

  return { r: r * scale, g: g * scale, b: b * scale };
}

/**
 * Classify a relative luminance value as dark or light.
 * Threshold: 0.5 (WCAG guidance).
 */
export function classifyLuminance(luminance: number): "dark" | "light" {
  return luminance > 0.5 ? "light" : "dark";
}