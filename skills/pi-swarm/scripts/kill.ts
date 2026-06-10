#!/usr/bin/env -S deno run --allow-all
/**
 * kill.ts — Terminate a Pi swarm agent, attempting graceful shutdown first.
 *
 * Usage:
 *   deno run --allow-all kill.ts [--session <name>] [--force] [--timeout <seconds>] <agent-name>
 *
 * Attempts graceful shutdown by sending Escape (abort work) then C-d (exit TUI)
 * via tmux send-keys. Waits up to --timeout seconds (default 5s) for the window
 * to close. Falls back to tmux kill-window if the window persists.
 * Use --force to skip the graceful phase and hard-kill immediately.
 * Also sweeps orphaned symlinks in the session-control directory.
 */

import { dirname, join, resolve } from "jsr:@std/path";
import { Console, Effect, pipe } from "npm:effect";
import {
  computePaths,
  removeIfExists,
  ShellError,
  sleep,
  SocketError,
} from "./lib/common.ts";
import { getWindowOption, killWindow, listAllWindows, sendKeys, swarmSessionName, waitForWindowDeath } from "./lib/tmux.ts";
import { platformLayer } from "./lib/cli.ts";

// ── Orphan cleanup ───────────────────────────────────────────────────────────

const cleanOrphanedSymlinks = (
  controlDir: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const entries = yield* pipe(
      Effect.promise(async () => {
        const result: Deno.DirEntry[] = [];
        for await (const entry of Deno.readDir(controlDir)) {
          result.push(entry);
        }
        return result;
      }),
      Effect.catchAll((): Effect.Effect<Deno.DirEntry[]> => Effect.succeed([])),
    );

    for (const entry of entries) {
      if (!entry.isSymlink) continue;
      const aliasPath = join(controlDir, entry.name);

      const target = yield* pipe(
        Effect.tryPromise(() => Deno.readLink(aliasPath)),
        Effect.catchAll(
          (): Effect.Effect<string | null> => Effect.succeed(null),
        ),
      );
      if (target === null) {
        yield* removeIfExists(aliasPath);
        continue;
      }

      const resolved = resolve(dirname(aliasPath), target);
      yield* pipe(
        Effect.promise(() => Deno.stat(resolved)),
        Effect.catchAll(() => removeIfExists(aliasPath)),
      );
    }
  });

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const args = [...Deno.args];
  let sessionName: string | null = null;

  // Parse --session flag
  const sessionIdx = args.indexOf("--session");
  if (sessionIdx !== -1 && sessionIdx + 1 < args.length) {
    sessionName = swarmSessionName(args[sessionIdx + 1]);
    args.splice(sessionIdx, 2);
  }

  // Parse --force flag
  const forceIdx = args.indexOf("--force");
  const force = forceIdx !== -1;
  if (force) {
    args.splice(forceIdx, 1);
  }

  // Parse --timeout flag
  let timeoutSec = 5;
  const timeoutIdx = args.indexOf("--timeout");
  if (timeoutIdx !== -1 && timeoutIdx + 1 < args.length) {
    const val = parseInt(args[timeoutIdx + 1], 10);
    if (!isNaN(val) && val >= 0) {
      timeoutSec = val;
    } else {
      yield* Console.error(
        `Invalid timeout value "${args[timeoutIdx + 1]}". Using default (5s).`,
      );
    }
    args.splice(timeoutIdx, 2);
  }

  const raw = args[0];
  if (!raw) {
    yield* Console.error(
      "Usage: kill.ts [--session <name>] [--force] [--timeout <seconds>] <agent-name>",
    );
    return yield* Effect.fail(
      new ShellError({
        cmd: "kill.ts",
        args: [],
        stderr: "Missing required argument: agent name",
      }),
    );
  }

  const paths = yield* computePaths;

  // Resolve which session and window to kill
  let resolveTarget: { session: string; window: string } | null = null;

  if (sessionName) {
    // Explicit session — look up window in that session
    resolveTarget = { session: sessionName, window: raw };
  } else {
    // Search all pi-swarm sessions for a window matching the name
    const allWindows = yield* listAllWindows(paths.defaultTmuxSocket);

    for (const w of allWindows) {
      if (w.windowName === raw) {
        resolveTarget = { session: w.sessionName, window: w.windowName };
        break;
      }
    }
  }

  if (!resolveTarget) {
    yield* Console.error(`No agent found matching "${raw}".`);
    yield* Console.error("Use list.ts to see running agents.");
    return yield* Effect.fail(
      new ShellError({
        cmd: "kill.ts",
        args: [raw],
        stderr: "No matching agent",
      }),
    );
  }

  const target = `${resolveTarget.session}:${resolveTarget.window}`;

  // Read the session ID from tmux window metadata for post-termination cleanup.
  // If the read fails (e.g., window already gone), sessionId is null and we fall
  // back to the orphan symlink sweep.
  const sessionId = yield* pipe(
    getWindowOption(paths.defaultTmuxSocket, target, "@pi-session-id"),
    Effect.catchAll(() => Effect.succeed(null)),
  );

  if (force) {
    // --force: skip graceful phase, go straight to hard kill
    yield* killWindow(
      paths.defaultTmuxSocket,
      resolveTarget.session,
      resolveTarget.window,
    );
    yield* Console.log(
      `Agent "${resolveTarget.window}" in session "${resolveTarget.session}" force-killed.`,
    );
  } else {
    // Attempt graceful shutdown first
    yield* Console.log(
      `Attempting graceful shutdown of "${resolveTarget.window}"...`,
    );

    const goneGracefully = yield* pipe(
      Effect.gen(function* () {
        // Phase 1: send Escape to abort in-flight work, then C-d to exit TUI
        yield* sendKeys(paths.defaultTmuxSocket, target, "Escape");
        yield* sleep(500);
        yield* sendKeys(paths.defaultTmuxSocket, target, "C-d");
        // Phase 2: poll for window death
        return yield* waitForWindowDeath(
          paths.defaultTmuxSocket,
          resolveTarget.session,
          resolveTarget.window,
          timeoutSec * 1000,
        );
      }),
      Effect.tapError((e) =>
        Console.error(
          `Graceful shutdown error: ${e instanceof Error ? e.message : String(e)}`,
        )
      ),
      Effect.catchAll(() => Effect.succeed(false)),
    );

    if (goneGracefully) {
      yield* Console.log(
        `Agent "${resolveTarget.window}" exited gracefully.`,
      );
    } else {
      // Fall through to hard kill
      yield* Console.log(
        `Graceful shutdown timed out. Hard-killing "${resolveTarget.window}"...`,
      );
      const killed = yield* killWindow(
        paths.defaultTmuxSocket,
        resolveTarget.session,
        resolveTarget.window,
      );
      if (killed) {
        yield* Console.log(
          `Agent "${resolveTarget.window}" in session "${resolveTarget.session}" hard-killed.`,
        );
      } else {
        yield* Console.error(
          `Failed to kill agent "${resolveTarget.window}" in session "${resolveTarget.session}".`,
        );
      }
    }
  }

  // Remove the control socket file if we know the session ID (from @pi-session-id).
  // This closes the lifecycle loop: spawn creates → kill removes.
  if (sessionId) {
    const sockPath = join(paths.controlDir, `${sessionId}.sock`);
    yield* pipe(
      removeIfExists(sockPath),
      Effect.catchAll(() => Effect.void),
    );
  }

  // Clean up orphaned symlinks in all termination paths (legacy fallback)
  yield* pipe(
    cleanOrphanedSymlinks(paths.controlDir),
    Effect.catchAll(() => Effect.void),
  );
});

// ── Entry point ──────────────────────────────────────────────────────────────
Effect.runPromise(program.pipe(Effect.provide(platformLayer))).catch(
  (e: unknown) => {
    if (
      e instanceof ShellError || e instanceof SocketError || e instanceof Error
    ) {
      console.error(e.message);
    } else {
      console.error("Unexpected error:", e);
    }
    Deno.exit(1);
  },
);
