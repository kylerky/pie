#!/usr/bin/env -S deno run --allow-all
/**
 * list.ts — List running Pi swarm agents (windows in pi-swarm sessions).
 *
 * Usage:
 *   deno run --allow-all list.ts [--json] [--session <name>]
 */

import { Effect, Console, pipe } from "npm:effect";
import { computePaths, ShellError, SocketError } from "./lib/common.ts";
import { listAllWindows, listWindows, swarmSessionName } from "./lib/tmux.ts";
import { listControlSockets } from "./lib/control.ts";
import { platformLayer } from "./lib/cli.ts";

// ── Types ────────────────────────────────────────────────────────────────────
interface SubagentInfo {
  name: string;
  session: string;
  window: string;
  tmuxStatus: string;
  sessionId: string | null;
  controlAlive: boolean;
}

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const args = Deno.args.filter((a) => a !== "--json");
  const jsonMode = Deno.args.includes("--json");

  let filterSession: string | null = null;
  const sessionIdx = args.indexOf("--session");
  if (sessionIdx !== -1 && sessionIdx + 1 < args.length) {
    filterSession = swarmSessionName(args[sessionIdx + 1]);
  }

  const paths = yield* computePaths;

  // Fetch windows and control sockets in parallel
  const [allWindows, controlSockets] = yield* Effect.all(
    [
      filterSession
        ? pipe(
            listWindows(paths.defaultTmuxSocket, filterSession),
            Effect.map((ws) =>
              ws.map((w) => ({
                sessionName: filterSession!,
                windowName: w.name,
                active: w.active,
              })),
            ),
          )
        : listAllWindows(paths.defaultTmuxSocket),
      listControlSockets(paths.controlDir),
    ],
    { concurrency: 2 },
  );

  const aliveSockets = controlSockets.filter((c) => c.alive);
  const result: SubagentInfo[] = [];
  let socketIdx = 0;

  for (const w of allWindows) {
    const matched =
      socketIdx < aliveSockets.length ? aliveSockets[socketIdx++] : null;
    result.push({
      name: w.windowName,
      session: w.sessionName,
      window: w.windowName,
      tmuxStatus: w.active ? "active" : "idle",
      sessionId: matched?.sessionId ?? null,
      controlAlive: matched !== null,
    });
  }

  while (socketIdx < aliveSockets.length) {
    const cs = aliveSockets[socketIdx++];
    result.push({
      name: `(orphan-${cs.sessionId.slice(0, 8)})`,
      session: "?",
      window: "?",
      tmuxStatus: "gone",
      sessionId: cs.sessionId,
      controlAlive: true,
    });
  }

  if (jsonMode) {
    yield* Console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.length === 0) {
    yield* Console.log("No swarm agents running.");
    return;
  }

  // Group by session
  const bySession = new Map<string, SubagentInfo[]>();
  for (const r of result) {
    const existing = bySession.get(r.session) ?? [];
    existing.push(r);
    bySession.set(r.session, existing);
  }

  for (const [session, agents] of bySession) {
    yield* Console.log(`Session: ${session}`);
    yield* Console.log("─".repeat(70));

    const nameWidth = Math.max(...agents.map((r) => r.name.length), "AGENT".length);
    const idWidth = Math.max(
      ...agents.map((r) => (r.sessionId ?? "\u2014").length),
      "SESSION ID".length,
    );
    const sep = "  ";

    yield* Console.log(
      "  " + "AGENT".padEnd(nameWidth) + sep +
        "SESSION ID".padEnd(idWidth) + sep +
        "STATUS",
    );

    for (const r of agents) {
      const status = r.controlAlive
        ? "\u{1F7E2} alive"
        : r.tmuxStatus === "gone"
          ? "\u{1F534} dead"
          : "\u{1F7E1} waiting";

      yield* Console.log(
        "  " + r.name.padEnd(nameWidth) + sep +
          (r.sessionId ?? "\u2014").padEnd(idWidth) + sep +
          status,
      );
    }
    yield* Console.log("");
  }

  // Print attach info
  const sessions = [...new Set(result.map((r) => r.session).filter((s) => s !== "?"))];
  if (sessions.length > 0) {
    yield* Console.log("Attach commands:");
    for (const session of sessions) {
      yield* Console.log(
        `  tmux -S ${paths.defaultTmuxSocket} attach -t ${session}`,
      );
    }
  }
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