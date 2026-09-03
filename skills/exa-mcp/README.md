# Exa MCP

Web search and content fetching via the Exa MCP server.

Under Fabric the server is pooled by the `mcp` provider, so `fabric_exec`
programs call it directly:

```ts
const res = await mcp.exa.web_search_exa({ query: '...', numResults: 5 });
return res.text;
```

Without Fabric, the same tools are reachable through the `mcporter` CLI:

```bash
mcporter call exa.web_search_exa query="..." numResults=5
```

See `SKILL.md` for query syntax, result shape, and the research workflow.

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

Fabric's `mcp` provider discovers servers through mcporter, so this one config
serves both paths — nothing extra to register.
