/**
 * lib/control.ts — Session-control socket operations for pi-swarm.
 *
 * Manages Unix domain socket connections to Pi session-control endpoints.
 * Uses Effect-TS acquireRelease with Effect.scoped for guaranteed cleanup.
 * Directory enumeration uses Deno APIs directly wrapped in Effect
 * (@effect/platform layers aren't available in the installed version).
 */

import { join } from "jsr:@std/path";
import { Effect, pipe } from "npm:effect";
import { sh, ShellError, sleep, SocketError } from "./common.ts";
import { CommandExecutor } from "npm:@effect/platform";

// ── Connection management ────────────────────────────────────────────────────

/** Open a Unix domain socket connection with a timeout. */
const tryConnect = (
  socketPath: string,
  timeoutMs: number,
): Effect.Effect<Deno.Conn, SocketError> =>
  pipe(
    Effect.tryPromise({
      try: () => Deno.connect({ path: socketPath, transport: "unix" }),
      catch: (e) => new SocketError({ message: `connect: ${String(e)}` }),
    }),
    Effect.timeout(timeoutMs),
    Effect.catchAll((e) =>
      Effect.fail(
        e instanceof SocketError ? e : new SocketError({
          message: `connection timed out after ${timeoutMs}ms`,
        }),
      )
    ),
  );

/** Release a connection, swallowing any errors. */
const releaseConn = (conn: Deno.Conn): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      conn.close();
    } catch {
      /* best effort */
    }
  });

/**
 * Acquire a connection, use it, and release it.
 */
export const useConnection = <A, E, R>(
  socketPath: string,
  timeoutMs: number,
  use: (conn: Deno.Conn) => Effect.Effect<A, E, R>,
): Effect.Effect<A, SocketError | E, R> =>
  Effect.scoped(
    pipe(
      Effect.acquireRelease(
        tryConnect(socketPath, timeoutMs),
        releaseConn,
      ),
      Effect.flatMap(use),
    ),
  );

// ── I/O ──────────────────────────────────────────────────────────────────────

const textEncoder = new TextEncoder();

/** Write a newline-terminated string to a connection. */
export const writeLine = (
  conn: Deno.Conn,
  data: string,
): Effect.Effect<void, SocketError> =>
  Effect.tryPromise({
    try: async () => {
      await conn.write(textEncoder.encode(data + "\n"));
    },
    catch: (e) => new SocketError({ message: `write failed: ${String(e)}` }),
  });

/** Async generator yielding newline-delimited JSON lines from a connection. */
export async function* readLines(
  conn: Deno.Conn,
): AsyncGenerator<string, void, undefined> {
  const buf = new Uint8Array(65536);
  let leftover = "";
  const decoder = new TextDecoder();

  while (true) {
    let n: number | null;
    try {
      n = await conn.read(buf);
    } catch {
      break;
    }
    if (n === null) break;
    const chunk = decoder.decode(buf.subarray(0, n));
    leftover += chunk;
    const lines = leftover.split("\n");
    leftover = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) yield trimmed;
    }
  }
  const remainder = leftover.trim();
  if (remainder.length > 0) yield remainder;
}

// ── Socket discovery ─────────────────────────────────────────────────────────

/**
 * Enumerate .sock file basenames in the session-control directory.
 */
export const listSocketFiles = (
  controlDir: string,
): Effect.Effect<Set<string>> =>
  pipe(
    Effect.promise(async () => {
      const socks = new Set<string>();
      for await (const entry of Deno.readDir(controlDir)) {
        if (!entry.isDirectory && entry.name.endsWith(".sock")) {
          socks.add(entry.name);
        }
      }
      return socks;
    }),
    Effect.catchAll((): Effect.Effect<Set<string>> =>
      Effect.succeed(new Set())
    ),
  );

/**
 * Get the session ID of a pi instance running in a tmux window.
 *
 * The control extension displays "session <uuid>" in the TUI footer
 * when --session-control is enabled. We capture the pane output and
 * parse the session ID from it — no /proc or socket polling needed.
 */
export const getSessionIdFromPane = (
  tmuxSocket: string,
  sessionName: string,
  windowName: string,
  timeoutMs = 30_000,
): Effect.Effect<
  string,
  SocketError | ShellError,
  CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    const uuidRe =
      /session\s+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

    while (Date.now() < deadline) {
      const output = yield* sh("tmux", [
        "-S",
        tmuxSocket,
        "capture-pane",
        "-p",
        "-t",
        `${sessionName}:${windowName}`,
      ]);

      const match = output.match(uuidRe);
      if (match) {
        return match[1];
      }

      yield* sleep(500);
    }

    return yield* Effect.fail(
      new SocketError({
        message:
          `Timed out after ${timeoutMs}ms waiting for session ID in pane output`,
      }),
    );
  });

/**
 * Poll until a new .sock file appears.
 * Returns the session ID (filename without `.sock`).
 */
export const waitForNewSocket = (
  before: Set<string>,
  timeoutMs: number,
  controlDir: string,
): Effect.Effect<string, SocketError> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const after: Set<string> = yield* listSocketFiles(controlDir);
      for (const sock of after) {
        if (!before.has(sock)) {
          return sock.slice(0, -".sock".length);
        }
      }
      yield* sleep(500);
    }

    return yield* Effect.fail(
      new SocketError({
        message: `timed out after ${timeoutMs}ms waiting for control socket`,
      }),
    );
  });

/**
 * List all .sock files in the control directory and check liveness.
 */
export const listControlSockets = (
  controlDir: string,
): Effect.Effect<Array<{ sessionId: string; alive: boolean }>> =>
  Effect.gen(function* () {
    const socks: Array<{ sessionId: string; alive: boolean }> = [];

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
      if (entry.isDirectory || !entry.name.endsWith(".sock")) continue;
      const sessionId = entry.name.slice(0, -".sock".length);
      const fullPath = join(controlDir, entry.name);
      const alive = yield* isSocketAlive(fullPath);
      socks.push({ sessionId, alive });
    }
    return socks;
  });

/**
 * Check whether a Unix domain socket is accepting connections.
 */
export const isSocketAlive = (
  socketPath: string,
  timeoutMs = 500,
): Effect.Effect<boolean> =>
  Effect.scoped(
    pipe(
      Effect.acquireRelease(
        tryConnect(socketPath, timeoutMs),
        releaseConn,
      ),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    ),
  );

// ── Message sending ──────────────────────────────────────────────────────────

/**
 * Send an initial prompt to a spawned agent via its control socket.
 * Writes a JSON send command and waits for acknowledgement.
 */
export const sendInitialPrompt = (
  controlDir: string,
  sessionId: string,
  message: string,
  timeoutMs = 10_000,
): Effect.Effect<void, SocketError> =>
  useConnection(
    socketPath(controlDir, sessionId),
    timeoutMs,
    (conn) =>
      Effect.gen(function* () {
        const cmd = JSON.stringify({
          type: "send",
          message,
          mode: "steer",
        });
        yield* writeLine(conn, cmd);

        // Wait for acknowledgement
        yield* Effect.async<void, SocketError>((resolve) => {
          (async () => {
            try {
              for await (const line of readLines(conn)) {
                const msg = JSON.parse(line);
                if (
                  msg.type === "response" &&
                  msg.command === "send"
                ) {
                  if (msg.success) {
                    resolve(Effect.succeed(undefined));
                  } else {
                    resolve(
                      Effect.fail(
                        new SocketError({
                          message: `Send failed: ${msg.error}`,
                        }),
                      ),
                    );
                  }
                  return;
                }
              }
              resolve(
                Effect.fail(
                  new SocketError({
                    message:
                      "Connection closed before receiving acknowledgement",
                  }),
                ),
              );
            } catch (e) {
              resolve(
                Effect.fail(
                  new SocketError({
                    message: `sendInitialPrompt: ${String(e)}`,
                  }),
                ),
              );
            }
          })();
        });
      }),
  );

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Build the full path to a session's control socket. */
export const socketPath = (
  controlDir: string,
  sessionId: string,
): string => join(controlDir, `${sessionId}.sock`);
