---
name: exa-mcp
description: Web search and content fetching via the Exa MCP server. Use for finding current information, news, facts, people, companies, researching topics, or fetching full webpage content.
---

# Exa MCP

Semantic web search and page-content fetching through the Exa MCP server. Exa
uses embeddings-based neural search, so queries should describe the ideal
result page, not just keywords.

Fabric pools this server through its `mcp` provider, so inside `fabric_exec`
both tools are direct bindings. **Prefer those over shelling out to
`mcporter`** — they are typed, batchable, and skip a process spawn per query.

## Tools

### `mcp.exa.web_search_exa` — semantic web search

```ts
const res = await mcp.exa.web_search_exa({
  query: 'blog post comparing React and Vue performance',
  numResults: 5,
});
return res.text;
```

- `query` (required): natural language describing the ideal page. **Not
  keywords** — "blog post comparing React and Vue performance", not
  "React vs Vue".
- `numResults` (optional): how many results (default 10).
- Prefix the query with `category:people` or `category:company` to target
  LinkedIn profiles or companies:
  - `'category:people Jane Smith CTO AcmeCorp'`
  - `'category:company Exa AI search startup'`

Each result carries Title, URL, Published date, Author, and Highlights
(snippets of relevant text). If highlights are not enough, chain into
`web_fetch_exa` on the best URLs.

### `mcp.exa.web_fetch_exa` — full page content

```ts
const res = await mcp.exa.web_fetch_exa({
  urls: ['https://example.com/article', 'https://other.com/page'],
  maxCharacters: 5000,
});
return res.text;
```

- `urls` (required): array of URLs. Batch several per call.
- `maxCharacters` (optional): max characters per page (default 3000). Raise it
  for longer content.

Returns clean markdown of the page content plus metadata.

## Result shape

Both tools resolve to the MCP envelope `{ text, content, structuredContent }`:

- `text` — the payload. Ready-to-read rendering (titles, URLs, and highlights
  for search; page markdown for fetch). Use this.
- `content` — `[{ type: 'text', text }]`, mirroring `text`.
- `structuredContent` — **`null` for Exa.** Do not write code against it.

Search results are large. Return only the slice you need from `fabric_exec`
instead of the raw envelope, or you will burn context:

```ts
const res = await mcp.exa.web_search_exa({ query: '...', numResults: 10 });
return res.text.split('\n\n').slice(0, 5).join('\n\n');
```

## Workflow

### Research a topic

1. Search with a semantically rich query describing the ideal result.
2. If highlights lack detail, fetch the promising URLs — batch ~5 per call.
3. If results are not targeted enough, refine the query with specifics: time
   period ("2025"), source type ("official documentation"), or perspective
   ("tutorial for beginners").

Search and fetch are independent network calls when you already know the URLs,
so parallelize them in one program:

```ts
const [a, b] = await Promise.all([
  mcp.exa.web_search_exa({ query: 'rust async runtime comparison', numResults: 5 }),
  mcp.exa.web_fetch_exa({ urls: ['https://tokio.rs/'], maxCharacters: 4000 }),
]);
return { search: a.text, page: b.text.slice(0, 2000) };
```

### Look up a person or company

```ts
await mcp.exa.web_search_exa({ query: 'category:people Jane Smith CTO AcmeCorp' });
await mcp.exa.web_search_exa({ query: 'category:company Exa AI search startup' });
```

## Discovery and gotchas

- `Object.keys(mcp)` returns `[]`. The namespace is a lazy proxy — bindings
  cannot be enumerated. Discover with `tools.list({ provider: 'mcp' })` or
  `tools.search({ query: 'exa' })`.
- Management refs are **not** properties: `mcp.$servers({})` throws
  `TypeError: not a function`. Call them through `tools`:
  `await tools.call({ ref: 'mcp.$servers', args: {} })`.
- For a ref computed at runtime, use `tools.call`, e.g.
  `tools.call({ ref: 'mcp.exa.web_search_exa', args: { query } })`.

## Fallback: `mcporter` CLI

Only for sessions without Fabric — plain Pi loads this skill too:

```bash
mcporter call exa.web_search_exa query="<query>" numResults=<n>
mcporter call exa.web_fetch_exa urls='["<url1>", "<url2>"]' maxCharacters=<n>
```

Add `--output markdown` for readable results or `--output json` to parse
programmatically. Check server health with `mcporter list`.

## Notes

- Exa understands meaning, not just keywords — search concepts, descriptions,
  and questions naturally.
- `web_search_exa` returns highlights, not full pages. For depth, always chain
  into `web_fetch_exa`.
- Results include publication dates; use them to assess recency.
- There is no pagination. To get more results, increase `numResults`.
