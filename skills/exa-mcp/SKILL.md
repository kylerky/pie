---
name: exa-mcp
description: Web search and content fetching via Exa MCP (mcporter). Use for finding current information, news, facts, people, companies, researching topics, or fetching full webpage content.
---

# Exa MCP

Use the Exa MCP server via `mcporter call` for semantic web search and page content fetching. Exa uses embeddings-based neural search, so queries should describe the ideal result page, not just keywords.

## Tools

### `web_search_exa` — Semantic web search

Search the web for any topic and get clean, ready-to-use content.

```bash
mcporter call exa.web_search_exa query="<query>" numResults=<n>
```

- `query` (required): Natural language describing the ideal page. **Not keywords** — "blog post comparing React and Vue performance" not "React vs Vue".
- `numResults` (optional): How many results (default 10).
- Use `category:people` or `category:company` prefix in the query to search LinkedIn profiles or companies: `"category:people John Doe software engineer"`, `"category:company Exa AI startup"`.

**Output**: Each result has Title, URL, Published date, Author, and Highlights (snippets of relevant text). If highlights are insufficient, follow up with `web_fetch_exa` on the best URLs.

### `web_fetch_exa` — Fetch full page content

Read a webpage's full content as clean markdown.

```bash
mcporter call exa.web_fetch_exa urls='["<url1>", "<url2>"]' maxCharacters=<n>
```

- `urls` (required): JSON array of URLs to fetch. Batch multiple URLs in one call.
- `maxCharacters` (optional): Max characters per page (default 3000). Increase for longer content.

**Output**: Clean markdown of the page content and metadata.

## Workflow

### Research a topic

1. Start with `web_search_exa` to find relevant pages. Use a semantically rich query describing the ideal result.
2. If highlights don't give enough detail, call `web_fetch_exa` on promising URLs. Batch up to ~5 URLs per call.
3. If search results aren't targeted enough, refine the query — add specifics like time period ("2025"), source type ("official documentation"), or perspective ("tutorial for beginners").

### Look up a person or company

```bash
mcporter call exa.web_search_exa query="category:people Jane Smith CTO AcmeCorp"
mcporter call exa.web_search_exa query="category:company Exa AI search startup"
```

### Get full content from known URLs

```bash
mcporter call exa.web_fetch_exa urls='["https://example.com/article", "https://other.com/page"]' maxCharacters=5000
```

## mcporter output formatting

Add `--output markdown` for clean reading (headers, links rendered). Use `--output json` if you need to parse structured results programmatically. The default output is plain text with metadata.

## Notes

- Exa uses neural/embeddings search — it understands meaning, not just keywords. You can search for concepts, descriptions, and questions naturally.
- `web_search_exa` returns highlights, not full pages. For depth, always chain into `web_fetch_exa`.
- Results include publication dates — use these to assess recency.
- There is no pagination; to get more results, increase `numResults`.
