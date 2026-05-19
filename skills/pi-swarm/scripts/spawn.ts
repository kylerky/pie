#!/usr/bin/env -S deno run --allow-all
/**
 * spawn.ts — Spawn a Pi subagent as a window in a swarm tmux session.
 *
 * Usage:
 *   deno run --allow-all spawn.ts [--tmux-socket <path>] [--cwd <path>] [--session <name>] <name> <initial-prompt>
 *
 * The agent is started as a window in the given session. If no session is
 * specified, a random session name is generated for isolation.
 * The initial prompt is sent via the session-control socket after the agent
 * starts, rather than as a CLI argument to pi.
 */

import { join } from "jsr:@std/path";
import { Effect, Console } from "npm:effect";
import {
  computePaths,
  ShellError,
  SocketError,
  ensureDir,
  sanitizeName,
  defaultCwd,
} from "./lib/common.ts";
import { createWindow, killWindow, swarmSessionName } from "./lib/tmux.ts";
import {
  getSessionIdFromPane,
  sendInitialPrompt,
} from "./lib/control.ts";
import { platformLayer } from "./lib/cli.ts";

// ── Argument parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
  tmuxSocket: string | null;
  cwd: string | null;
  session: string;
  name: string;
  prompt: string;
}

function parseArgs(raw: string[]): Effect.Effect<ParsedArgs> {
  return Effect.sync(() => {
    const args = [...raw];
    let tmuxSocket: string | null = null;
    let cwd: string | null = null;
    let session = "";

    const sockIdx = args.indexOf("--tmux-socket");
    if (sockIdx !== -1 && sockIdx + 1 < args.length) {
      tmuxSocket = args[sockIdx + 1];
      args.splice(sockIdx, 2);
    }

    const cwdIdx = args.indexOf("--cwd");
    if (cwdIdx !== -1 && cwdIdx + 1 < args.length) {
      cwd = args[cwdIdx + 1];
      args.splice(cwdIdx, 2);
    }

    const sessionIdx = args.indexOf("--session");
    if (sessionIdx !== -1 && sessionIdx + 1 < args.length) {
      session = args[sessionIdx + 1];
      args.splice(sessionIdx, 2);
    }

    const name = args[0] ?? "";
    const prompt = args.slice(1).join(" ");
    return { tmuxSocket, cwd, session, name, prompt };
  });
}

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const parsed = yield* parseArgs(Deno.args);

  if (!parsed.name || !parsed.prompt.trim()) {
    yield* Console.error(
      "Usage: spawn.ts [--tmux-socket <path>] [--cwd <path>] [--session <name>] <name> <initial-prompt>",
    );
    return yield* Effect.fail(
      new ShellError({
        cmd: "spawn.ts",
        args: [],
        stderr: "Missing required arguments: name and initial-prompt",
      }),
    );
  }

  const paths = yield* computePaths;
  const tmuxSocket = parsed.tmuxSocket ?? paths.defaultTmuxSocket;
  const cwd = parsed.cwd ?? (yield* defaultCwd());
  // Build session name: if none provided, generate a random one for isolation
  const sessionSuffix = parsed.session || crypto.randomUUID().slice(0, 8);
  const sessionName = swarmSessionName(sessionSuffix);
  const windowName = sanitizeName(parsed.name);

  yield* ensureDir(paths.tmuxSocketDir);
  yield* ensureDir(paths.controlDir);

  // Start the agent as a window in the swarm session.
  // pi is started with --session-control only — no prompt arg.
  yield* createWindow({
    tmuxSocket,
    sessionName,
    windowName,
    cwd,
    shellCommand: "pi",
    shellArgs: ["--session-control"],
  });

  // Get the session ID directly from the spawned pi process.
  // The control extension sets PI_SESSION_ID in the process environment
  // when the session-control socket is ready — we read it from
  // /proc/<pid>/environ. No socket-directory polling needed.
  const sessionId = yield* getSessionIdFromPane(
    tmuxSocket,
    sessionName,
    windowName,
    30_000,
  ).pipe(
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        yield* Console.error(
          `Failed to get session ID for subagent: ${e.message}`,
        );
        // Clean up the window
        yield* killWindow(tmuxSocket, sessionName, windowName).pipe(
          Effect.catchAll(() => Effect.void),
        );
        return yield* Effect.fail(e);
      }),
    ),
  );

  // Send the initial prompt via the control socket
  yield* Console.error(`Sending initial prompt to ${parsed.name}...`);
  yield* sendInitialPrompt(paths.controlDir, sessionId, parsed.prompt, 15_000).pipe(
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        yield* Console.error(
          `Warning: Failed to send initial prompt: ${e.message}`,
        );
        yield* Console.error(
          "The agent is running but may be idle. You can send a prompt with send.ts.",
        );
      }),
    ),
  );

  const result = {
    sessionId,
    sessionName: parsed.name,
    tmuxSession: sessionName,
    windowName,
    tmuxSocket,
    controlSocket: join(paths.controlDir, `${sessionId}.sock`),
    cwd,
  };

  yield* Console.log(JSON.stringify(result));
  yield* Console.error(
    `\nTo monitor all swarm agents:\n  tmux -S ${tmuxSocket} attach -t ${sessionName}\n`,
  );
  yield* Console.error(
    `Or attach directly to this agent:\n  tmux -S ${tmuxSocket} attach -t ${sessionName}:${windowName}\n`,
  );
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