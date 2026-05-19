#!/usr/bin/env -S deno run --allow-all
/**
 * send.ts — Send a message to a Pi session via its control socket.
 *
 * Usage:
 *   deno run --allow-all send.ts <session-id> <message> [--mode steer|follow_up] [--wait]
 */

import { Effect, Console } from "npm:effect";
import { computePaths, ShellError, SocketError } from "./lib/common.ts";
import {
  useConnection,
  writeLine,
  readLines,
  socketPath as makeSocketPath,
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

      // --wait mode: subscribe to agent_end
      const subCmd = JSON.stringify({
        type: "subscribe",
        event: "agent_end",
      });
      yield* writeLine(conn, subCmd);

      let sendOk = false;

      yield* Effect.tryPromise({
        try: async () => {
          for await (const line of lines) {
            const msg = JSON.parse(line);

            if (
              msg.type === "response" &&
              msg.command === "send"
            ) {
              if (!msg.success) {
                console.error(`Send failed: ${msg.error}`);
                Deno.exit(1);
              }
              sendOk = true;
              continue;
            }

            if (
              msg.type === "response" &&
              msg.command === "subscribe"
            ) {
              if (!msg.success) {
                console.error(`Subscribe failed: ${msg.error}`);
                Deno.exit(1);
              }
              continue;
            }

            if (
              msg.type === "event" &&
              msg.event === "agent_end"
            ) {
              if (sendOk) {
                // agent_end carries messages directly (RPC format) or in .data (session-control format)
                const messages: Array<Record<string, unknown>> | undefined =
                  msg.messages || msg.data?.messages;
                if (messages && messages.length > 0) {
                  const lastAssistant = [...messages]
                    .reverse()
                    .find(
                      (m: Record<string, unknown>) =>
                        m.role === "assistant",
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
          }
          console.error(
            "Connection closed before receiving agent_end event.",
          );
          Deno.exit(1);
        },
        catch: (e) =>
          new SocketError({
            message: `wait for agent_end: ${String(e)}`,
          }),
      });
    }),
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
});