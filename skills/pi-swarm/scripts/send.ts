#!/usr/bin/env -S deno run --allow-all
/**
 * send.ts — Send a message to a Pi session via its control socket.
 *
 * Usage:
 *   deno run --allow-all send.ts <session-id> <message> [--mode steer|follow_up] [--wait]
 */

import { Console, Effect } from "npm:effect";
import { computePaths, ShellError, SocketError } from "./lib/common.ts";
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
  message: string;
  mode: "steer" | "follow_up";
  shouldWait: boolean;
}

function parseArgs(raw: string[]): Effect.Effect<ParsedArgs> {
  return Effect.sync(() => {
    const args = [...raw];
    let mode: "steer" | "follow_up" = "steer";
    let shouldWait = false;

    const modeIdx = args.indexOf("--mode");
    if (modeIdx !== -1 && modeIdx + 1 < args.length) {
      const m = args[modeIdx + 1];
      if (m === "steer" || m === "follow_up") mode = m;
      else {
        console.error(`Invalid mode: ${m}. Use steer or follow_up.`);
        Deno.exit(1);
      }
      args.splice(modeIdx, 2);
    }

    if (args.includes("--wait")) {
      shouldWait = true;
      args.splice(args.indexOf("--wait"), 1);
    }

    const sessionId = args[0] ?? "";
    const message = args.slice(1).join(" ");
    return { sessionId, message, mode, shouldWait };
  });
}

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const parsed = yield* parseArgs(Deno.args);

  if (!parsed.sessionId || !parsed.message.trim()) {
    yield* Console.error(
      "Usage: send.ts <session-id> <message> [--mode steer|follow_up] [--wait]",
    );
    return yield* Effect.fail(
      new ShellError({
        cmd: "send.ts",
        args: [],
        stderr: "Missing required arguments: session-id and message",
      }),
    );
  }

  const paths = yield* computePaths;
  const path = makeSocketPath(paths.controlDir, parsed.sessionId);

  yield* useConnection(path, 5_000, (conn) =>
    Effect.gen(function* () {
      const sendCmd = JSON.stringify({
        type: "send",
        message: parsed.message,
        mode: parsed.mode,
      });
      yield* writeLine(conn, sendCmd);

      const lines = readLines(conn);

      if (!parsed.shouldWait) {
        yield* Effect.tryPromise({
          try: async () => {
            for await (const line of lines) {
              const msg = JSON.parse(line);
              if (
                msg.type === "response" &&
                msg.command === "send"
              ) {
                if (msg.success) {
                  console.log(
                    JSON.stringify({
                      delivered: true,
                      mode: msg.data?.mode,
                    }),
                  );
                } else {
                  console.error(`Send failed: ${msg.error}`);
                  Deno.exit(1);
                }
                return;
              }
            }
            console.error("No response received from session.");
            Deno.exit(1);
          },
          catch: (e) =>
            new SocketError({
              message: `send acknowledgement: ${String(e)}`,
            }),
        });
        return;
      }

      // --wait mode: atomic subscribe-before-send
      // Write subscribe FIRST so the subscription is registered before
      // the send triggers the turn. Both writes happen before we start
      // reading, so the server processes them in the same receive buffer
      // — no race window between subscription and turn start.
      const subCmd = JSON.stringify({
        type: "subscribe",
        event: "agent_end",
      });
      yield* writeLine(conn, subCmd);

      const waitSendCmd = JSON.stringify({
        type: "send",
        message: parsed.message,
        mode: parsed.mode,
      });
      yield* writeLine(conn, waitSendCmd);

      let subscribeOk = false;
      let sendOk = false;

      yield* Effect.tryPromise({
        try: async () => {
          for await (const line of lines) {
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
              msg.command === "send"
            ) {
              if (!msg.success) {
                throw new SocketError({
                  message: `Send failed: ${msg.error}`,
                });
              }
              sendOk = true;
              continue;
            }

            if (
              msg.type === "event" &&
              msg.event === "agent_end"
            ) {
              if (subscribeOk && sendOk) {
                // agent_end event carries a single message in .data.message
                // (the control extension sends { message: ExtractedMessage })
                const message = msg.data?.message;
                if (message && typeof message.content === "string") {
                  console.log(message.content || "(assistant message is empty)");
                } else {
                  console.log(
                    "(agent completed, no assistant message)",
                  );
                }
                Deno.exit(0);
              }
            }
          }

          throw new SocketError({
            message:
              "Connection closed before receiving agent_end event.",
          });
        },
        catch: (e) =>
          e instanceof SocketError
            ? e
            : new SocketError({
              message: `wait for agent_end: ${String(e)}`,
            }),
      });
    }));
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
