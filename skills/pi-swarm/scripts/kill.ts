#!/usr/bin/env -S deno run --allow-all
/**
 * kill.ts — Terminate a Pi swarm agent by killing its tmux window.
 *
 * Usage:
 *   deno run --allow-all kill.ts [--session <name>] <agent-name>
 *
 * Kills the named agent window. If it was the last window in the
 * session, the session is also killed. Also sweeps orphaned symlinks
 * in the session-control directory.
 */

import { join, resolve, dirname } from "jsr:@std/path";
import { Effect, Console, pipe } from "npm:effect";
import {
  computePaths,
  ShellError,
  SocketError,
  removeIfExists,
} from "./lib/common.ts";
import { killWindow, listAllWindows, swarmSessionName } from "./lib/tmux.ts";
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
      Effect.catchAll((): Effect.Effect<Deno.DirEntry[]> =>
        Effect.succeed([]),
      ),
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

  const sessionIdx = args.indexOf("--session");
  if (sessionIdx !== -1 && sessionIdx + 1 < args.length) {
    sessionName = swarmSessionName(args[sessionIdx + 1]);
    args.splice(sessionIdx, 2);
  }

  const raw = args[0];
  if (!raw) {
    yield* Console.error(
      "Usage: kill.ts [--session <name>] <agent-name>",
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

  const killed = yield* killWindow(
    paths.defaultTmuxSocket,
    resolveTarget.session,
    resolveTarget.window,
  );

  if (killed) {
    yield* Console.log(
      `Agent "${resolveTarget.window}" in session "${resolveTarget.session}" killed.`,
    );
  } else {
    yield* Console.error(
      `Failed to kill agent "${resolveTarget.window}" in session "${resolveTarget.session}".`,
    );
  }

  yield* pipe(cleanOrphanedSymlinks(paths.controlDir), Effect.catchAll(() => Effect.void));
});

// ── Entry point ──────────────────────────────────────────────────────────────
Effect.runPromise(program.pipe(Effect.provide(platformLayer))).catch(
  (e: unknown) => {
  if (e instanceof ShellError || e instanceof SocketError || e instanceof Error) {
    console.error(e.message);
  } else {
    console.error("Unexpected error:", e);
  }
  Deno.exit(1);
});