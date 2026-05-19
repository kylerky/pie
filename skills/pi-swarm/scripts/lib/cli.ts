/**
 * lib/cli.ts — Deno-backed CommandExecutor for @effect/platform.
 *
 * @effect/platform/Command needs a CommandExecutor service to actually
 * run commands.  This module provides one backed by Deno.Command, and
 * exports a platform layer that satisfies all @effect/platform service
 * requirements needed by the CLI stack.
 */

import { Effect, Layer, Scope, Stream, Sink, pipe, Chunk } from "npm:effect";
import { Command, CommandExecutor } from "npm:@effect/platform";
import { FileSystem } from "npm:@effect/platform/FileSystem";
import { Path } from "npm:@effect/platform/Path";
import { Terminal } from "npm:@effect/platform/Terminal";
import { BadArgument } from "npm:@effect/platform/Error";

// ── Deno-backed CommandExecutor ──────────────────────────────────────────────

const makeDenoCommandExecutor = (): CommandExecutor.CommandExecutor =>
  CommandExecutor.makeExecutor(
    (
      command: Command.Command,
    ): Effect.Effect<CommandExecutor.Process, BadArgument, Scope.Scope> =>
      Effect.gen(function* () {
        if (command._tag === "PipedCommand") {
          return yield* Effect.dieMessage(
            "PipedCommand not supported by the Deno command executor",
          );
        }

        const standard = command as Command.StandardCommand;
        const args = standard.args.slice();
        const env: Record<string, string> = {};
        for (const [k, v] of standard.env) {
          env[k] = v;
        }

        const cmdOptions: Deno.CommandOptions = {
          args,
          env,
          stdin: "piped",
          stdout: "piped",
          stderr: "piped",
        };

        if (standard.cwd._tag === "Some") {
          cmdOptions.cwd = standard.cwd.value;
        }

        const proc = new Deno.Command(standard.command, cmdOptions).spawn();

        const process: CommandExecutor.Process = {
          [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
          pid: CommandExecutor.ProcessId(proc.pid),
          exitCode: Effect.promise(() =>
            proc.status.then((s) => CommandExecutor.ExitCode(s.code)),
          ),
          isRunning: Effect.sync(() => true), // best effort
          kill: (signal?: CommandExecutor.Signal) =>
            Effect.promise(() =>
              Promise.resolve(
                void proc.kill((signal as Deno.Signal) ?? "SIGTERM"),
              ),
            ) as Effect.Effect<void, BadArgument>,
          stdout: Stream.fromReadableStream(
            () => proc.stdout,
            (reason) =>
              new BadArgument({
                module: "Command",
                method: "stdout",
                description: String(reason),
              }),
          ),
          stderr: Stream.fromReadableStream(
            () => proc.stderr,
            (reason) =>
              new BadArgument({
                module: "Command",
                method: "stderr",
                description: String(reason),
              }),
          ),
          stdin: Sink.forEach(
            (
              chunk: Uint8Array,
            ): Effect.Effect<void, BadArgument> =>
              Effect.promise(async () => {
                const writer = proc.stdin.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
              }),
          ),
          toJSON: () => ({ _id: "@effect/platform/Process", pid: proc.pid }),
          [Symbol.for("nodejs.util.inspect.custom")]: () =>
            `Process(${proc.pid})`,
        } as unknown as CommandExecutor.Process;

        return process;
      }),
  );

// ── Platform layer ───────────────────────────────────────────────────────────

/** Layer that satisfies all @effect/platform service requirements. */
export const platformLayer: Layer.Layer<
  CommandExecutor.CommandExecutor | FileSystem | Path | Terminal
> = Layer.mergeAll(
  Layer.succeed(CommandExecutor.CommandExecutor, makeDenoCommandExecutor()),
  Layer.succeed(FileSystem, {} as any),
  Layer.succeed(Path, {} as any),
  Layer.succeed(Terminal, {} as any),
);