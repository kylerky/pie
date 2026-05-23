---
name: org-roam
description: Capture persistent knowledge using org-roam conventions. Use for recording lessons learned, novel insights, gotchas, and architectural understanding across sessions. Query Emacs for org-roam directory.
---

# Org-Roam Knowledge Capture

Maintain persistent knowledge across sessions using org-roam conventions. These
notes are your long-term memory. Use qmd for search (see qmd skill).

## Discovery

Query Emacs for org-roam's configuration before any operations:

```bash
# Where notes live
emacsclient --eval '(expand-file-name org-roam-directory)'

# Whether org-roam is available
emacsclient --eval '(featurep '\''org-roam)'
```

Use the returned directory as `$ROAM_DIR` for all note operations.

## Philosophy

Capture **lessons learned and novel knowledge** — insights not obvious from the
codebase or docs. One insight per note. Link notes together. Link to raw data
sources instead of duplicating them.

Capture: non-obvious behaviors, gotchas, discovered patterns, architectural
understanding, hard-won discoveries.

Don't capture: obvious facts, trivial edits, things you can grep for.

## File Format

Notes live in category subdirectories under =$ROAM_DIR/public/=:

- =public/main/<slug>.org= — general knowledge notes
- =public/project/<slug>.org= — project-specific notes
- =public/reference/<slug>.org= — reference material

The slug is derived from the title (lowercase, underscores for spaces).

Org-roam auto-generates a UUID for =:ID:=. To create a note without Emacs
interaction, generate a UUID yourself (e.g., =uuidgen=) and write the file
directly, then sync the database:

```
:PROPERTIES:
:ID:        <uuid>
:TAGS:      :tag1:tag2:
:END:
#+title: One-line summary

The insight. Be concrete.

Source: [[file:/path/to/session.jsonl][Context]]
See also: [[id:related-uuid][Description]]
```

Key formatting rules:
- =:ID:= is a UUID (e.g., =550e8400-e29b-41d4-a716-446655440000=), not a slug
- =:TAGS:= is colon-delimited: =:gotcha:=, =:pattern:=, =:architecture:=, etc.

Links between notes use UUIDs: =[[id:uuid][display text]]=
Links to external sources: =[[file:/absolute/path][display text]]=

## Example

```
:PROPERTIES:
:ID:        550e8400-e29b-41d4-a716-446655440000
:TAGS:      :gotcha:pi:typescript:concurrency:
:END:
#+title: withFileMutationQueue prevents parallel edit races

When Pi runs tool calls in parallel, two tools editing the same file
can race — both read the original, compute different patches, and
the last write silently drops changes.

Wrap mutations in withFileMutationQueue(absolutePath, fn) from
@earendil-works/pi-coding-agent to serialize per-file edits.

Source: [[file:~/.pi/agent/sessions/--p--/session.jsonl][Building custom tool]]
See also: [[id:660e8400-e29b-41d4-a716-446655440001][Parallel tool model]]
```

## Workflow

**Before capturing:** search for existing related notes with qmd. If you find
relevant notes, `read` and extend them with `edit` instead of creating
duplicates.

**Creating a note:** write the .org file to the correct subdirectory
(=public/main/=, =public/project/=, or =public/reference/=), then reindex:

```bash
qmd update
emacsclient --eval '(org-roam-db-sync)'
```

**Exploring relationships:**

Prefer org-roam's native database queries over shell grepping. The database is
authoritative — it excludes self-links, skips dangling references, and captures
section-level links that grep misses.

```bash
# Backlinks (what links to this note?)
emacsclient --eval '(org-roam-backlinks-get (org-roam-node-from-id "uuid"))'

# Run arbitrary SQL on the org-roam database
emacsclient --eval '(org-roam-db-query [:select [source dest type] :from links :where (= type "id")])'
```

Common database queries (write as temp .el files and load-file when complex):

- **All id-type links:**
  `(org-roam-db-query [:select [source dest] :from links :where (= type "id")])`
- **Outgoing/incoming link counts:** Aggregate by source or dest column in Emacs
  Lisp.
- **Node titles:**
  `(org-roam-db-query [:select [title] :from nodes :where (= id $s1)] uuid)`

Database schema:

- `nodes` table: `id`, `file`, `title`, `level`, `pos`, `properties`
- `links` table: `source`, `dest`, `type` (e.g. `"id"`), `properties`

Only fall back to grep when Emacs is not working.

**If Emacs isn't running,** start it as a daemon:

```bash
emacs --daemon
```

## Key Functions

Beyond raw `org-roam-db-query`, use these built-in functions for common tasks.
They are programmatic (no interactive UI) and return data structures suitable
for scripting via `emacsclient --eval`.

### Node lookup and discovery

```bash
# List all nodes (id, file, title, level, tags) — useful for inventory
emacsclient --eval '(org-roam-node-list)'

# Resolve a node from its ID (returns full node struct)
emacsclient --eval '(org-roam-node-from-id "8227db2c-293c-420d-8efa-a5ddfe8b8779")'

# Find a node by title or alias
emacsclient --eval '(org-roam-node-from-title-or-alias "Dijkstra")'
```

### Backlinks and references

```bash
# Backlinks: nodes that link TO this slug/id
emacsclient --eval '(org-roam-backlinks-get "slug")'

# Add an external reference (URL, DOI, etc.) to the current node
emacsclient --eval '(org-roam-ref-add "https://example.com/paper")'
```

### Tags

```bash
# Add a tag to a node by file path
emacsclient --eval '(org-roam-tag-add '("gotcha"))'

# Remove a tag
emacsclient --eval '(org-roam-tag-remove '("gotcha"))'
```

### Programmatic capture

Use `org-roam-capture` to create a new note with a capture template. Pass a
`:node` plist with at least a `:title`:

```bash
emacsclient --eval '(org-roam-capture- :node (org-roam-node-create :title "New Note") :templates (("d" "default" plain "%?" :target (file+head "%<%Y%m%dT%H%M%S>-${slug}.org" "#+title: ${title}\n"))))'
```

### Discover more

Org-roam exposes many more functions. Discover them by querying Emacs:

```bash
# List all public org-roam functions
emacsclient --eval '(apropos-internal "^org-roam-" '\''functionp)'

# Get documentation for any function
emacsclient --eval '(documentation '\''org-roam-node-list)'
```

Use `org-roam-node-list` + `org-roam-node-from-id` + `org-roam-db-query` as the
primary toolset for graph analysis; reach for other functions as needed.
