/**
 * lib/common.ts — Shared utilities and shell execution for pi-swarm scripts.
 *
 * Uses Effect-TS for structured error handling and composability.
 * Environment variables: Effect's Config.
 * Path manipulation: @std/path (JSR).
 * Shell commands: @effect/platform/Command (via our CommandExecutor layer).
 */

import { join, resolve as pathResolve } from "jsr:@std/path";
import {
  Chunk,
  Config,
  Data,
  Duration,
  Effect,
  pipe,
  Scope,
  Stream,
} from "npm:effect";
import { Command, CommandExecutor } from "npm:@effect/platform";

// ── Error types ──────────────────────────────────────────────────────────────
export class ShellError extends Data.TaggedError("ShellError")<{
  readonly cmd: string;
  readonly args: readonly string[];
  readonly stderr: string;
}> {
  override get message(): string {
    return `${this.cmd} ${this.args.join(" ")}: ${this.stderr}`;
  }
}

export class SocketError extends Data.TaggedError("SocketError")<{
  readonly message: string;
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly message: string;
  readonly waitedMs: number;
}> {}

// ── Path computation ─────────────────────────────────────────────────────────
export interface PiSwarmPaths {
  readonly controlDir: string;
  readonly tmuxSocketDir: string;
  readonly defaultTmuxSocket: string;
}

export const computePaths = Effect.gen(function* () {
  const home = yield* Config.string("HOME").pipe(
    Config.withDefault("/tmp"),
  );
  const socketDir = yield* Config.string("PI_TMUX_SOCKET_DIR").pipe(
    Config.orElse(() =>
      Config.string("TMPDIR").pipe(Config.withDefault("/tmp"))
    ),
  );
  const tmuxSocketDir = join(socketDir, "pi-tmux-sockets");

  return {
    controlDir: join(home, ".pi", "session-control"),
    tmuxSocketDir,
    defaultTmuxSocket: join(tmuxSocketDir, "pi-swarm.sock"),
  };
});

// ── Shell execution ──────────────────────────────────────────────────────────

const textDecoder = new TextDecoder();

/** Helper: drain an Effect stream of Uint8Array into a single string. */
const drainToText = <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E> =>
  pipe(
    Stream.runCollect(stream),
    Effect.map((chunk) =>
      Chunk.toReadonlyArray(chunk)
        .map((u) => textDecoder.decode(u))
        .join("")
    ),
  );

/**
 * Run a shell command via @effect/platform/Command, returning raw output.
 * Never fails the Effect — errors are captured in the returned object.
 */
export const shRaw = (
  cmd: string,
  args: string[],
): Effect.Effect<
  { ok: boolean; stdout: string; stderr: string },
  never,
  CommandExecutor.CommandExecutor
> =>
  pipe(
    Effect.scoped(
      Effect.gen(function* () {
        const proc = yield* Command.start(Command.make(cmd, ...args));

        const [stdout, stderr, exit] = yield* Effect.all(
          [drainToText(proc.stdout), drainToText(proc.stderr), proc.exitCode],
          { concurrency: 3 },
        );

        return {
          ok: exit === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      }),
    ),
    Effect.catchAll(() =>
      Effect.succeed({
        ok: false,
        stdout: "",
        stderr: "failed to spawn process",
      })
    ),
  );

/**
 * Run a shell command. Fails the Effect with ShellError on non-zero exit.
 */
export const sh = (
  cmd: string,
  args: string[],
): Effect.Effect<string, ShellError, CommandExecutor.CommandExecutor> =>
  pipe(
    shRaw(cmd, args),
    Effect.flatMap((result) =>
      result.ok ? Effect.succeed(result.stdout) : Effect.fail(
        new ShellError({
          cmd,
          args: [...args],
          stderr: result.stderr || "(no stderr)",
        }),
      )
    ),
  );

// ── Utilities ────────────────────────────────────────────────────────────────
/** Resolve a user-provided path to an absolute path. */
export const resolvePath = (raw: string): Effect.Effect<string> =>
  Effect.sync(() => pathResolve(raw));

/** Return the parent's current working directory wrapped in Effect. */
export const defaultCwd = (): Effect.Effect<string> =>
  Effect.sync(() => Deno.cwd());

/** Sanitize a name for use as a tmux session name. */
export const sanitizeName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") ||
  "subagent";

/**
 * Ensure a directory exists (creates recursively if needed). Never fails.
 */
export const ensureDir = (dirPath: string): Effect.Effect<void> =>
  pipe(
    Effect.promise(() => Deno.mkdir(dirPath, { recursive: true })),
    Effect.catchAll(() => Effect.void),
  );

/**
 * Recursively remove a file or directory if it exists. Never fails.
 */
export const removeIfExists = (target: string): Effect.Effect<void> =>
  pipe(
    Effect.promise(() => Deno.remove(target, { recursive: true })),
    Effect.catchAll(() => Effect.void),
  );

/** Simple sleep effect. */
export const sleep = (ms: number): Effect.Effect<void> =>
  Effect.sleep(Duration.millis(ms));
