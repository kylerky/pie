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
      const subCmd = JSON.stringify({
        type: "subscribe",
        event: "agent_end",
      });
      yield* writeLine(conn, subCmd);

      const lines = readLines(conn);
      const deadline = Date.now() + parsed.timeoutSec * 1000;

      yield* Effect.tryPromise({
        try: async () => {
          for await (const line of lines) {
            if (Date.now() > deadline) {
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
              continue;
            }

            if (
              msg.type === "event" &&
              msg.event === "agent_end"
            ) {
              // agent_end carries messages directly (RPC format) or in .data (session-control format)
              const messages: Array<Record<string, unknown>> | undefined =
                msg.messages || msg.data?.messages;
              if (messages && messages.length > 0) {
                // Find last assistant message
                const lastAssistant = [...messages]
                  .reverse()
                  .find(
                    (m: Record<string, unknown>) => m.role === "assistant",
                  );
                if (lastAssistant) {
                  const content = lastAssistant.content;
                  if (typeof content === "string") {
                    console.log(content);
                  } else if (Array.isArray(content)) {
                    const textBlocks = (
                      content as Array<Record<string, unknown>>
                    )
                      .filter((b) => b.type === "text")
                      .map((b) => b.text as string)
                      .join("\n");
                    console.log(
                      textBlocks ||
                        "(assistant message without text)",
                    );
                  } else {
                    console.log(
                      "(assistant message without text content)",
                    );
                  }
                } else {
                  console.log(
                    "(agent completed, no assistant message)",
                  );
                }
              } else {
                console.log("(agent completed, no messages)");
              }
              Deno.exit(0);
            }
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
