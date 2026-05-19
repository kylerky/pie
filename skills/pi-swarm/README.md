# Pi Swarm

Spawn and manage swarms of Pi instances — isolated subagents and cooperative
multi-agent swarms — in tmux sessions with inter-session communication via Unix
domain socket control channels.

## Installation

```bash
# Install as a Pi skill
cp -r pi-swarm ~/.agents/skills/pi-swarm

# Or install from git
pi install git:github.com/your-org/pi-swarm
```

## Requirements

- Pi with session-control extension enabled (`pi --session-control`)
- tmux installed and available in PATH
- Deno runtime (`deno`) for helper scripts

## Usage

Pi automatically loads this skill. When working on complex or parallelizable
tasks, Pi will proactively spawn subagents or orchestrate swarms.

```bash
# Spawn a swarm member
deno run --allow-all scripts/spawn.ts my-agent "Investigate the auth module and report back"

# List running swarm members
deno run --allow-all scripts/list.ts

# Send a message to a member
deno run --allow-all scripts/send.ts <session-id> "How is the investigation going?" --wait

# Wait for a member to finish its current turn
deno run --allow-all scripts/wait.ts <session-id>

# Kill a member
deno run --allow-all scripts/kill.ts my-agent
```
