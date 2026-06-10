#!/usr/bin/env -S deno run --allow-all
/**
 * wait.ts — Wait for a Pi session to finish processing (all turns).
 *
 * Usage:
 *   deno run --allow-all wait.ts <session-id> [--timeout <seconds>]
 *
 * Subscribes to agent_end to wait until the agent fully completes.
 */

import { Console, Effect } from "npm:effect";
import {
  computePaths,
  ShellError,
  SocketError,
  TimeoutError,
} from "./lib/common.ts";
import {
  readLines,
  socketPath as makeSocketPath,
  useConnection,
  writeLine,
} from "./lib/control.ts";
import { platformLayer } from "./lib/cli.ts";

// ── Argument parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
  sessionId: string;
  timeoutSec: number;
}

function parseArgs(raw: string[]): Effect.Effect<ParsedArgs> {
  return Effect.sync(() => {
    const args = [...raw];
    let timeoutSec = 300;

    const timeoutIdx = args.indexOf("--timeout");
    if (timeoutIdx !== -1 && timeoutIdx + 1 < args.length) {
      const v = parseInt(args[timeoutIdx + 1], 10);
      if (isNaN(v) || v <= 0) {
        console.error("Invalid timeout value.");
        Deno.exit(1);
      }
      timeoutSec = v;
      args.splice(timeoutIdx, 2);
    }

    const sessionId = args[0] ?? "";
    return { sessionId, timeoutSec };
  });
}

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const parsed = yield* parseArgs(Deno.args);

  if (!parsed.sessionId) {
    yield* Console.error(
      "Usage: wait.ts <session-id> [--timeout <seconds>]",
    );
    return yield* Effect.fail(
      new ShellError({
        cmd: "wait.ts",
        args: [],
        stderr: "Missing required argument: session-id",
      }),
    );
  }

  const paths = yield* computePaths;
  const path = makeSocketPath(paths.controlDir, parsed.sessionId);

  yield* useConnection(path, 5_000, (conn) =>
    Effect.gen(function* () {
      // Subscribe to agent_end first — this guarantees we catch the event
      // if the agent is still processing.
      const subCmd = JSON.stringify({
        type: "subscribe",
        event: "agent_end",
      });
      yield* writeLine(conn, subCmd);

      // Also request the current message as a fallback.
      // If the agent already finished before we connected, agent_end
      // will never fire — but get_message returns the final result.
      const getMsgCmd = JSON.stringify({
        type: "get_message",
      });
      yield* writeLine(conn, getMsgCmd);

      const lines = readLines(conn);
      const deadline = Date.now() + parsed.timeoutSec * 1000;

      let subscribeOk = false;
      let fallbackMessage: string | null = null;

      yield* Effect.tryPromise({
        try: async () => {
          for await (const line of lines) {
            if (Date.now() > deadline) {
              // Timeout — if we have a fallback message, use it.
              // This handles the case where the agent was already idle
              // when we connected (agent_end already happened).
              if (subscribeOk && fallbackMessage !== null) {
                console.error(
                  "Warning: agent_end not received within timeout (agent may have finished before wait.ts connected). Using cached get_message as fallback.",
                );
                console.log(fallbackMessage || "(assistant message is empty)");
                Deno.exit(0);
              }
              throw new TimeoutError({
                message:
                  `Timed out after ${parsed.timeoutSec}s waiting for agent_end`,
                waitedMs: parsed.timeoutSec * 1000,
              });
            }

            const msg = JSON.parse(line);

            if (
              msg.type === "response" &&
              msg.command === "subscribe"
            ) {
              if (!msg.success) {
                throw new SocketError({
                  message: `Subscribe failed: ${msg.error}`,
                });
              }
              subscribeOk = true;
              continue;
            }

            if (
              msg.type === "response" &&
              msg.command === "get_message"
            ) {
              const data = msg.data as
                | { message?: { content?: string } }
                | undefined;
              if (data?.message && typeof data.message.content === "string") {
                fallbackMessage = data.message.content;
              }
              continue;
            }

            if (
              msg.type === "event" &&
              msg.event === "agent_end"
            ) {
              // agent_end event carries the final message in .data.message
              // Prefer the event data over the fallback from get_message.
              const message = msg.data?.message;
              if (message && typeof message.content === "string") {
                console.log(message.content || "(assistant message is empty)");
              } else if (fallbackMessage !== null) {
                console.log(fallbackMessage || "(assistant message is empty)");
              } else {
                console.log(
                  "(agent completed, no assistant message)",
                );
              }
              Deno.exit(0);
            }
          }

          // Connection closed — use fallback if subscribe was ok.
          if (subscribeOk && fallbackMessage !== null) {
            console.error(
              "Warning: connection closed before agent_end (agent may have already finished). Using cached get_message as fallback.",
            );
            console.log(fallbackMessage || "(assistant message is empty)");
            Deno.exit(0);
          }

          throw new SocketError({
            message: "Connection closed before receiving agent_end event.",
          });
        },
        catch: (e) =>
          e instanceof SocketError || e instanceof TimeoutError
            ? e
            : new SocketError({
              message: `wait failed: ${String(e)}`,
            }),
      });
    }));
});

// ── Entry point ──────────────────────────────────────────────────────────────
Effect.runPromise(program.pipe(Effect.provide(platformLayer))).catch(
  (e: unknown) => {
    if (
      e instanceof ShellError ||
      e instanceof SocketError ||
      e instanceof TimeoutError
    ) {
      console.error(e.message);
    } else {
      console.error("Unexpected error:", e);
    }
    Deno.exit(1);
  },
);
