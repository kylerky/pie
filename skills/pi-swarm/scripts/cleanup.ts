#!/usr/bin/env -S deno run --allow-all
/**
 * cleanup.ts — Detect and clean up stale control sockets and orphan agents.
 *
 * Usage:
 *   deno run --allow-all cleanup.ts [--dry-run]
 *
 * --dry-run: Report what would be done without making changes.
 *
 * Actions:
 *   - Dead sockets (no live listener): removed automatically.
 *   - Live orphan sockets (no matching tmux window): reported as warnings.
 *   - Healthy sockets (matching tmux window): reported as healthy.
 */

import { join } from "jsr:@std/path";
import { Console, Effect, pipe } from "npm:effect";
import {
	computePaths,
	removeIfExists,
	ShellError,
	SocketError,
} from "./lib/common.ts";
import { getWindowOption, listAllWindows } from "./lib/tmux.ts";
import { isSocketAlive, listSocketFiles } from "./lib/control.ts";
import { platformLayer } from "./lib/cli.ts";

// ── Types ────────────────────────────────────────────────────────────────────

interface SocketInfo {
	sessionId: string;
	sockPath: string;
	alive: boolean;
	/** Matching tmux window, or null if orphan */
	window: { sessionName: string; windowName: string } | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a set of all session IDs found in @pi-session-id options across
 * all pi-swarm tmux windows. Returns a map from sessionId to window info.
 */
const buildWindowSessionMap = (tmuxSocket: string) =>
	Effect.gen(function* () {
		const allWindows = yield* listAllWindows(tmuxSocket);
		const map = new Map<string, { sessionName: string; windowName: string }>();

		for (const w of allWindows) {
			const target = `${w.sessionName}:${w.windowName}`;
			const sid = yield* pipe(
				getWindowOption(tmuxSocket, target, "@pi-session-id"),
				Effect.catchAll(() => Effect.succeed(null)),
			);
			if (sid) {
				map.set(sid, { sessionName: w.sessionName, windowName: w.windowName });
			}
		}
		return map;
	});

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
	const args = Deno.args;
	const dryRun = args.includes("--dry-run");

	const paths = yield* computePaths;
	const controlDir = paths.controlDir;
	const tmuxSocket = paths.defaultTmuxSocket;

	// 1. Build the window → session ID map from all pi-swarm sessions
	const windowMap = yield* buildWindowSessionMap(tmuxSocket);

	// 2. Scan all socket files in the control directory
	const sockFiles = yield* listSocketFiles(controlDir);
	const sockets: SocketInfo[] = [];

	for (const sockName of sockFiles) {
		const sessionId = sockName.slice(0, -".sock".length);
		const sockPath = join(controlDir, sockName);
		const alive = yield* isSocketAlive(sockPath);
		const window = windowMap.get(sessionId) ?? null;

		sockets.push({ sessionId, sockPath, alive, window });
	}

	// 3. Categorize and act
	const dead = sockets.filter((s) => !s.alive);
	const liveOrphans = sockets.filter((s) => s.alive && s.window === null);
	const healthy = sockets.filter((s) => s.alive && s.window !== null);

	// ── Dead sockets: remove ──
	if (dead.length > 0) {
		if (dryRun) {
			yield* Console.log(`\nWould remove ${dead.length} dead socket(s):`);
			for (const s of dead) {
				yield* Console.log(`  - ${s.sessionId}`);
			}
		} else {
			yield* Console.log(`\nRemoving ${dead.length} dead socket(s):`);
			for (const s of dead) {
				yield* removeIfExists(s.sockPath);
				yield* Console.log(`  - ${s.sessionId} (removed)`);
			}
		}
	} else {
		yield* Console.log("\nNo dead sockets found.");
	}

	// ── Live orphans: warn ──
	if (liveOrphans.length > 0) {
		yield* Console.log(
			`\n⚠ Found ${liveOrphans.length} live orphan socket(s) (no matching tmux window):`,
		);
		for (const s of liveOrphans) {
			yield* Console.log(
				`  - ${s.sessionId} — socket is alive but no pi-swarm window has this session ID`,
			);
		}
		yield* Console.log(
			"\n  These may be agents from deleted sessions or non-pi-swarm sessions.",
		);
		yield* Console.log("  Use kill.ts to terminate them if they are unwanted.");
	} else {
		yield* Console.log("\nNo live orphan sockets found.");
	}

	// ── Healthy: report ──
	if (healthy.length > 0) {
		yield* Console.log(`\n✓ ${healthy.length} healthy agent(s):`);
		for (const s of healthy) {
			yield* Console.log(
				`  - ${s.window!.windowName} (${s.window!.sessionName}) → ${s.sessionId}`,
			);
		}
	} else {
		yield* Console.log("\nNo healthy agents found.");
	}

	if (dryRun) {
		yield* Console.log("\n[DRY RUN] No changes were made.");
	}
});

// ── Entry point ──────────────────────────────────────────────────────────────
Effect.runPromise(program.pipe(Effect.provide(platformLayer))).catch(
	(e: unknown) => {
		if (e instanceof ShellError || e instanceof SocketError) {
			console.error(e.message);
		} else {
			console.error("Unexpected error:", e);
		}
		Deno.exit(1);
	},
);
