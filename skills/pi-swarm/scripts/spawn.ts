#!/usr/bin/env -S deno run --allow-all
/**
 * spawn.ts — Spawn a Pi subagent as a window in a swarm tmux session.
 *
 * Usage:
 *   deno run --allow-all spawn.ts [--tmux-socket <path>] [--cwd <path>] [--session <name>]
 *     [--no-tools | -nt] [--no-builtin-tools | -nbt] [--tools | -t <tools>]
 *     [--no-extensions | -ne] [--extension | -e <path>]...
 *     [--no-skills | -ns] [--skill <path>]...
 *     [--no-context-files | -nc]
 *     [--provider <name> --model <model>]
 *     <name> <initial-prompt>
 *
 * The agent is started as a window in the given session. If no session is
 * specified, a random session name is generated for isolation.
 * The initial prompt is sent via the session-control socket after the agent
 * starts, rather than as a CLI argument to pi.
 *
 * Tool/extension restriction flags are forwarded to the spawned Pi process.
 * Use these to create read-only agents, limit capabilities, or isolate context.
 */

import { join } from "jsr:@std/path";
import { Console, Effect } from "npm:effect";
import {
  computePaths,
  defaultCwd,
  ensureDir,
  sanitizeName,
  ShellError,
  SocketError,
} from "./lib/common.ts";
import { createWindow, killWindow, swarmSessionName } from "./lib/tmux.ts";
import { sendInitialPrompt, waitForSocket } from "./lib/control.ts";
import { platformLayer } from "./lib/cli.ts";

// ── Argument parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
  tmuxSocket: string | null;
  cwd: string | null;
  session: string;
  name: string;
  prompt: string;
  /** Tool restriction flags */
  noTools: boolean;
  noBuiltinTools: boolean;
  toolsAllowlist: string | null;
  /** Extension restriction flags */
  noExtensions: boolean;
  extensionPaths: string[];
  /** Skill restriction flags */
  noSkills: boolean;
  skillPaths: string[];
  /** Context file restriction flags */
  noContextFiles: boolean;
  /** Model/provider override */
  model: string | null;
  provider: string | null;
}

function parseArgs(raw: string[]): Effect.Effect<ParsedArgs> {
  return Effect.sync(() => {
    const args = [...raw];
    let tmuxSocket: string | null = null;
    let cwd: string | null = null;
    let session = "";

    // Restriction flags (default: no restrictions)
    let noTools = false;
    let noBuiltinTools = false;
    let toolsAllowlist: string | null = null;
    let noExtensions = false;
    const extensionPaths: string[] = [];
    let noSkills = false;
    const skillPaths: string[] = [];
    let noContextFiles = false;
    let model: string | null = null;
    let provider: string | null = null;

    const remaining: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        // ── session / cwd ──
        case "--tmux-socket":
          if (i + 1 < args.length) tmuxSocket = args[++i];
          break;
        case "--cwd":
          if (i + 1 < args.length) cwd = args[++i];
          break;
        case "--session":
          if (i + 1 < args.length) session = args[++i];
          break;
        // ── tools ──
        case "--no-tools":
        case "-nt":
          noTools = true;
          break;
        case "--no-builtin-tools":
        case "-nbt":
          noBuiltinTools = true;
          break;
        case "--tools":
        case "-t":
          if (i + 1 < args.length) toolsAllowlist = args[++i];
          break;
        // ── extensions ──
        case "--no-extensions":
        case "-ne":
          noExtensions = true;
          break;
        case "--extension":
        case "-e":
          if (i + 1 < args.length) extensionPaths.push(args[++i]);
          break;
        // ── skills ──
        case "--no-skills":
        case "-ns":
          noSkills = true;
          break;
        case "--skill":
          if (i + 1 < args.length) skillPaths.push(args[++i]);
          break;
        // ── context files ──
        case "--no-context-files":
        case "-nc":
          noContextFiles = true;
          break;
        // ── model / provider ──
        case "--provider":
          if (i + 1 < args.length) provider = args[++i];
          break;
        case "--model":
          if (i + 1 < args.length) model = args[++i];
          break;
        // ── positional ──
        default:
          remaining.push(arg);
      }
    }

    const name = remaining[0] ?? "";
    const prompt = remaining.slice(1).join(" ");
    return {
      tmuxSocket,
      cwd,
      session,
      name,
      prompt,
      noTools,
      noBuiltinTools,
      toolsAllowlist,
      noExtensions,
      extensionPaths,
      noSkills,
      skillPaths,
      noContextFiles,
      model,
      provider,
    };
  });
}

// ── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const parsed = yield* parseArgs(Deno.args);

  if (!parsed.name || !parsed.prompt.trim()) {
    yield* Console.error(
      "Usage: spawn.ts [--tmux-socket <path>] [--cwd <path>] [--session <name>]",
    );
    yield* Console.error(
      "  [--no-tools | -nt] [--no-builtin-tools | -nbt] [--tools | -t <tools>]",
    );
    yield* Console.error(
      "  [--no-extensions | -ne] [--extension | -e <path>]...",
    );
    yield* Console.error(
      "  [--no-skills | -ns] [--skill <path>]...",
    );
    yield* Console.error(
      "  [--no-context-files | -nc]",
    );
    yield* Console.error(
      "  [--provider <name> --model <model>]",
    );
    yield* Console.error(
      "  <name> <initial-prompt>",
    );
    return yield* Effect.fail(
      new ShellError({
        cmd: "spawn.ts",
        args: [],
        stderr: "Missing required arguments: name and initial-prompt",
      }),
    );
  }

  // --provider requires --model
  if (parsed.provider && !parsed.model) {
    yield* Console.error(
      "Error: --provider requires --model to specify which model to use.",
    );
    return yield* Effect.fail(
      new ShellError({
        cmd: "spawn.ts",
        args: [],
        stderr: "--provider specified without --model",
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

  // Pre-generate a session ID so we know the control socket path up front.
  // Passing --session-id to pi ensures the session-control extension creates
  // the socket at ~/.pi/session-control/<sessionId>.sock — no pane scraping needed.
  const sessionId = crypto.randomUUID();

  // Build pi shell args with restriction flags forwarded from spawn.ts
  const piArgs = buildPiArgs(parsed, sessionId);

  // Start the agent as a window in the swarm session.
  // pi is started with --session-control --session-id <id> plus any restriction flags.
  yield* createWindow({
    tmuxSocket,
    sessionName,
    windowName,
    cwd,
    shellCommand: "pi",
    shellArgs: piArgs,
  });

  // Wait for the known control socket to appear (no pane scraping needed).
  yield* waitForSocket(paths.controlDir, sessionId, 30_000).pipe(
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
      })
    ),
  );

  // Send the initial prompt via the control socket
  yield* Console.error(`Sending initial prompt to ${parsed.name}...`);
  yield* sendInitialPrompt(paths.controlDir, sessionId, parsed.prompt, 15_000)
    .pipe(
      Effect.catchAll((e) =>
        Effect.gen(function* () {
          yield* Console.error(
            `Warning: Failed to send initial prompt: ${e.message}`,
          );
          yield* Console.error(
            "The agent is running but may be idle. You can send a prompt with send.ts.",
          );
        })
      ),
    );

  const restrictions = summarizeRestrictions(parsed);
  const result = {
    sessionId,
    sessionName: parsed.name,
    tmuxSession: sessionName,
    windowName,
    tmuxSocket,
    controlSocket: join(paths.controlDir, `${sessionId}.sock`),
    cwd,
    ...(restrictions ? { restrictions } : {}),
  };

  yield* Console.log(JSON.stringify(result));
  yield* Console.error(
    `\nTo monitor all swarm agents:\n  tmux -S ${tmuxSocket} attach -t ${sessionName}\n`,
  );
  yield* Console.error(
    `Or attach directly to this agent:\n  tmux -S ${tmuxSocket} attach -t ${sessionName}:${windowName}\n`,
  );
});

// ── Pi args builder ─────────────────────────────────────────────────────────

/** Build the pi shell arguments from parsed spawn flags. */
function buildPiArgs(parsed: ParsedArgs, sessionId: string): string[] {
  const args: string[] = ["--session-control", "--session-id", sessionId];

  if (parsed.noTools) args.push("--no-tools");
  if (parsed.noBuiltinTools) args.push("--no-builtin-tools");
  if (parsed.toolsAllowlist) args.push("--tools", parsed.toolsAllowlist);

  if (parsed.noExtensions) args.push("--no-extensions");
  for (const ext of parsed.extensionPaths) args.push("--extension", ext);

  if (parsed.noSkills) args.push("--no-skills");
  for (const skill of parsed.skillPaths) args.push("--skill", skill);

  if (parsed.noContextFiles) args.push("--no-context-files");

  if (parsed.provider) args.push("--provider", parsed.provider);
  if (parsed.model) args.push("--model", parsed.model);

  return args;
}

/** Build a human-readable summary of active restrictions. */
function summarizeRestrictions(
  parsed: ParsedArgs,
): Record<string, unknown> | null {
  const r: Record<string, unknown> = {};

  if (parsed.noTools) {
    r.tools = "none";
  } else {
    if (parsed.noBuiltinTools) r.builtinTools = false;
    if (parsed.toolsAllowlist) {
      r.tools = parsed.toolsAllowlist.split(",").map((s) => s.trim());
    }
  }

  if (parsed.noExtensions) {
    r.extensions = "none";
  } else if (parsed.extensionPaths.length > 0) {
    r.extensions = parsed.extensionPaths;
  }

  if (parsed.noSkills) {
    r.skills = "none";
  } else if (parsed.skillPaths.length > 0) {
    r.skills = parsed.skillPaths;
  }

  if (parsed.noContextFiles) r.contextFiles = "none";

  return Object.keys(r).length > 0 ? r : null;
}

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
