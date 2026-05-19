# Exa MCP

Web search and content fetching via Exa MCP, called through `mcporter`.

## Installation

Place in `~/.pi/agent/skills/exa-mcp/` or install as a Pi package:

```
pi install git:github.com/your-org/exa-mcp-skill
```

Requires `mcporter` with the `exa` server configured in `mcporter.json`:

```json
{
  "mcpServers": {
    "exa": {
      "baseUrl": "https://mcp.exa.ai/mcp"
    }
  }
}
```
