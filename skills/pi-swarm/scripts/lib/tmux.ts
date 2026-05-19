/**
 * lib/tmux.ts — Tmux session and window management for pi-swarm.
 *
 * Each swarm lives in its own tmux session named `pi-swarm-<name>`.
 * Within a session, each agent is a window. The first agent in a swarm
 * creates the session; subsequent agents add windows to it.
 */

import { Effect, pipe } from "npm:effect";
import { CommandExecutor } from "npm:@effect/platform";
import { sanitizeName, sh, ShellError, shRaw } from "./common.ts";

// ── Session naming ───────────────────────────────────────────────────────────

/** Build a full pi-swarm session name: `pi-swarm-<name>`. */
export const swarmSessionName = (name: string): string =>
  `pi-swarm-${sanitizeName(name)}`;

// ── Session helpers ──────────────────────────────────────────────────────────

/** Check whether a named tmux session exists. */
export const hasSession = (
  tmuxSocket: string,
  sessionName: string,
): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  pipe(
    shRaw("tmux", ["-S", tmuxSocket, "has-session", "-t", sessionName]),
    Effect.map((result) => result.ok),
  );

// ── Window CRUD ──────────────────────────────────────────────────────────────

/**
 * Create a window (agent) in a swarm session.
 * If the session doesn't exist yet, it is created with this window as
 * the first window. Subsequent agents create additional windows in the
 * same session.
 */
export const createWindow = (params: {
  tmuxSocket: string;
  sessionName: string;
  windowName: string;
  cwd: string;
  shellCommand: string;
  shellArgs: string[];
}): Effect.Effect<string, ShellError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const exists = yield* hasSession(params.tmuxSocket, params.sessionName);

    if (!exists) {
      // Try to create the session first. If another concurrent spawn created
      // the session between our hasSession check and now, catch the "duplicate
      // session" error and fall through to new-window.
      const newSessionResult = yield* shRaw("tmux", [
        "-S",
        params.tmuxSocket,
        "new-session",
        "-d",
        "-s",
        params.sessionName,
        "-c",
        params.cwd,
        "-n",
        params.windowName,
        "--",
        params.shellCommand,
        ...params.shellArgs,
      ]);

      if (newSessionResult.ok) {
        return `${params.sessionName}:${params.windowName}`;
      }

      // new-session failed — check if it was because the session already
      // exists (race with concurrent spawn). If so, retry as new-window.
      if (newSessionResult.stderr.includes("duplicate session")) {
        yield* sh("tmux", [
          "-S",
          params.tmuxSocket,
          "new-window",
          "-t",
          params.sessionName,
          "-n",
          params.windowName,
          "-c",
          params.cwd,
          "--",
          params.shellCommand,
          ...params.shellArgs,
        ]);
        return `${params.sessionName}:${params.windowName}`;
      }

      // Some other error — propagate it
      return yield* Effect.fail(
        new ShellError({
          cmd: "tmux",
          args: [
            "new-session",
            "-d",
            "-s",
            params.sessionName,
            "-n",
            params.windowName,
          ],
          stderr: newSessionResult.stderr || "(no stderr)",
        }),
      );
    } else {
      yield* sh("tmux", [
        "-S",
        params.tmuxSocket,
        "new-window",
        "-t",
        params.sessionName,
        "-n",
        params.windowName,
        "-c",
        params.cwd,
        "--",
        params.shellCommand,
        ...params.shellArgs,
      ]);
    }
    return `${params.sessionName}:${params.windowName}`;
  });

/**
 * List windows in all pi-swarm-* sessions.
 * Returns an array of { sessionName, windowName, active }.
 */
export const listAllWindows = (
  tmuxSocket: string,
): Effect.Effect<
  Array<{ sessionName: string; windowName: string; active: boolean }>,
  never,
  CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const sessionsResult = yield* shRaw("tmux", [
      "-S",
      tmuxSocket,
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);

    if (!sessionsResult.ok) return [];

    const sessions = sessionsResult.stdout
      .split("\n")
      .filter((line) => line.trim().startsWith("pi-swarm"));

    if (sessions.length === 0) return [];

    const results: Array<
      { sessionName: string; windowName: string; active: boolean }
    > = [];
    for (const session of sessions) {
      const windowsResult = yield* shRaw("tmux", [
        "-S",
        tmuxSocket,
        "list-windows",
        "-t",
        session,
        "-F",
        "#{window_name}\t#{window_active}",
      ]);
      if (windowsResult.ok) {
        for (const line of windowsResult.stdout.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const [name, rawActive] = trimmed.split("\t");
          results.push({
            sessionName: session,
            windowName: name,
            active: rawActive === "1",
          });
        }
      }
    }
    return results;
  });

/**
 * List windows in a specific swarm session.
 * Returns empty array when the session doesn't exist.
 */
export const listWindows = (
  tmuxSocket: string,
  sessionName: string,
): Effect.Effect<
  Array<{ name: string; active: boolean }>,
  never,
  CommandExecutor.CommandExecutor
> =>
  pipe(
    shRaw("tmux", [
      "-S",
      tmuxSocket,
      "list-windows",
      "-t",
      sessionName,
      "-F",
      "#{window_name}\t#{window_active}",
    ]),
    Effect.map((result) => {
      if (!result.ok) return [];
      return result.stdout
        .split("\n")
        .filter((line: string) => line.trim().length > 0)
        .map((line: string) => {
          const [name, rawActive] = line.split("\t");
          return {
            name: name.trim(),
            active: rawActive === "1",
          };
        });
    }),
  );

/**
 * Kill a specific window in a swarm session.
 * If no windows remain after killing, the session is also killed.
 * Returns true if the window was killed, false if it didn't exist.
 */
export const killWindow = (
  tmuxSocket: string,
  sessionName: string,
  windowName: string,
): Effect.Effect<boolean, ShellError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const exists = yield* hasSession(tmuxSocket, sessionName);
    if (!exists) return false;

    const windows = yield* listWindows(tmuxSocket, sessionName);
    const target = windows.find((w) => w.name === windowName);
    if (!target) return false;

    yield* sh("tmux", [
      "-S",
      tmuxSocket,
      "kill-window",
      "-t",
      `${sessionName}:${windowName}`,
    ]);

    // If no windows left, kill the session too
    const remaining = yield* listWindows(tmuxSocket, sessionName);
    if (remaining.length === 0) {
      yield* sh("tmux", [
        "-S",
        tmuxSocket,
        "kill-session",
        "-t",
        sessionName,
      ]).pipe(Effect.catchAll(() => Effect.void));
    }

    return true;
  });
