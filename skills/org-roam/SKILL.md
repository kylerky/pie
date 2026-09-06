---
name: org-roam
description: Capture persistent knowledge using org-roam conventions. Use for recording lessons learned, novel insights, gotchas, and architectural understanding across sessions. Write notes as structured, idiomatic org — outline nodes, tagged headings, captioned tables, TODOs — and lint them with scripts/verify-note.el before finishing. Query Emacs for org-roam directory.
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

Use the returned directory as `$ROAM_DIR` for all note operations. Relative paths
in this skill (such as `scripts/verify-note.el`) resolve against the directory
containing this SKILL.md.

## Philosophy

Capture **lessons learned and novel knowledge** — insights not obvious from the
codebase or docs. One insight per note. Link notes together. Link to raw data
sources instead of duplicating them.

Capture: non-obvious behaviors, gotchas, discovered patterns, architectural
understanding, hard-won discoveries.

Don't capture: obvious facts, trivial edits, things you can grep for.

## Note anatomy

Every note has two parts: a **header block** and a **body of sections**.

### Header block — the order is load-bearing

```org
:PROPERTIES:
:ID:            <uuid>
:ROAM_ALIASES:  Distinctive-Alias-1 Distinctive-Alias-2
:ROAM_REFS:     https://source-one https://source-two
:TAGS:          :tag1:tag2:
:END:
#+FILETAGS: :tag1:tag2:
#+TITLE:    One-line claim, not a topic label
#+SUBTITLE: Optional qualifier
#+DATE:     YYYY-MM-DD
#+STARTUP:  overview
#+OPTIONS:  toc:nil num:nil ^:nil
#+PROPERTY: header-args :eval never-export
```

`:END:` **must** close the drawer before any `#+` keyword. A property drawer may
contain only `:KEY: value` lines. Verified by controlled test:

| Placement | File node | Tags | Refs |
|---|---|---|---|
| Drawer closed, then `#+` keywords | registered | ok | ok |
| `#+` keywords first, then drawer | **lost** | – | – |
| Keywords inside drawer, `:END:` last | **lost** | – | – |

The failure is silent and misleading: heading outline nodes still register, so a
`nodes` query looks populated while `org-roam-node-from-id` on the file UUID
returns nil. It reads like a stale database, and re-syncing changes nothing.

Field rules:

- `:ID:` — a UUID (`uuidgen`), never a slug. Keep it stable across rewrites so
  `[[id:…]]` links survive.
- `:ROAM_ALIASES:` — whitespace-split into separate aliases. Use distinctive
  tokens (`Peregrine`, `LambdaBox`); generic ones (`Lean`, `program`) collide with
  future notes and make `org-roam-node-from-title-or-alias` ambiguous.
- `:ROAM_REFS:` — space-separated; lands in the `refs` table and stays queryable.
  Prefer this to a bare URL list in prose.
- `#+FILETAGS:` — this is what org-roam reads. A `:TAGS:` property alone leaves
  `org-roam-node-tags` nil. Keep both, with identical values.
- `#+TITLE:` — state the claim ("Why Rocq extraction is mature and Lean's is
  not"), not the topic ("Extraction").

### Body — sections, not prose

Scale structure to size, so a small insight stays small:

| Note size | Required structure |
|---|---|
| under 25 lines | header block, a preamble paragraph, `* See also`. Headings optional |
| 25–80 lines | header block plus `*` sections, one per distinct claim |
| over 80 lines | `*`/`**` hierarchy, `:ID:` on link-worthy sections, `:CUSTOM_ID:` for in-note navigation |

Always end with a `* See also` section carrying `[[id:…]]` links. Prefer
**bidirectional** links: when note A cites note B, add the reverse link in B, then
confirm with a backlinks query.

## Idiomatic constructs

Pick the construct that matches the content:

| Content | Construct |
|---|---|
| Thesis or claim | `* Claim :thesis:` heading with a numbered list |
| Comparison, versions, status | table with `#+CAPTION:` and `#+NAME:` |
| Code, config, error text | `#+begin_src <lang> :eval never` |
| Literal output, wrong-vs-right | `#+begin_example` |
| Quoted source text | `#+begin_quote` |
| Titles of works | `/italic/` |
| Light emphasis | `/italic/`; strong emphasis `*bold*` |
| Identifiers, flags, paths | `=verbatim=` |
| Actionable follow-up | `** TODO [#B] …` with a `:LOGBOOK:` state line |
| Checklist | `- [ ]` items |
| Aside that would break a sentence | `[fn:name]` footnote |
| Section worth citing elsewhere | `:ID:` on the heading (creates an outline node) |
| In-note navigation target | `:CUSTOM_ID:` plus `[[#custom-id]]` links |
| External sources | `:ROAM_REFS:` in the drawer and `[[https://…][label]]` inline |

**Outline nodes.** A heading with `:ID:` becomes its own node in the database —
independently linkable and backlinkable. Six ID'd headings plus the file node give
seven nodes for one file. Give IDs to sections worth citing, not to every heading.

**Heading tags** (`* Claim :thesis:`) classify sections and are inherited by
outline nodes along with the file tags.

## Verification (mandatory)

Never finish a note without linting it. The linter ships with this skill:

```bash
emacsclient --eval '(progn (load-file "/home/ee/Source/pie/skills/org-roam/scripts/verify-note.el")
                           (org-note-verify "/abs/path/note.org"))'
```

Pass several paths to check them together. A clean note reports:

```
my_note.org (406 lines): OK
  structure: headings=30 outline-nodes=7 custom-ids=18 | emphasis=129 italic=9 bold=65 verbatim=55 | refs=14 aliases=2
```

Otherwise it lists problems with line numbers, checking in severity order:
drawer swallowing `#+` keywords; file `:ID:` missing or unregistered; tags only in
`:TAGS:`; missing `#+TITLE:`; emphasis spanning lines; nested markers; markers in
captions; unresolved `[[#custom-id]]` and `[[id:uuid]]` links; tool-output
artifacts accidentally written into the note; and flat prose (over 25 lines with
no headings).

Then confirm the database actually registered the note:

```bash
emacsclient --eval '(org-roam-db-sync)'
emacsclient --eval '(org-roam-node-tags (org-roam-node-from-id "<uuid>"))'
emacsclient --eval '(org-roam-db-query [:select [level title] :from nodes :where (= file "<path>")])'
emacsclient --eval '(length (org-roam-db-query [:select [ref] :from refs :where (= node-id "<uuid>")]))'
emacsclient --eval '(length (org-roam-backlinks-get (org-roam-node-from-id "<uuid>")))'
qmd update
```

Expect: tags non-empty; one level-0 node plus one per `:ID:` heading; refs count
matching `:ROAM_REFS:`. If the file node is missing while outline nodes exist, the
header block is malformed — re-read the placement table above.

## Tooling traps

- **Drive Emacs via a temp `.el` file, not a long `--eval` string.** Newlines are
  eaten by the reader (`with-temp-buffer` reads as `with-temp-buffern`), extra CLI
  args are treated as files rather than `$s1` bindings, `load-file` returns `t`,
  and `princ` goes to the daemon's stdout. Inline values as string literals and
  return a `format`ed string: `(progn (load-file "x.el") (my-fn "…"))`.
- **Re-query after `org-roam-db-sync`** before concluding a node is missing — a
  lookup right after a redirected sync can race it.

## Workflow

**Before capturing:** search for existing related notes with qmd. If you find
relevant notes, `read` and extend them with `edit` instead of creating
duplicates.

**Creating a note:**

1. Write the header block, then the sections (see Note anatomy).
2. Write the file to the right subdirectory (`public/main/`, `public/project/`,
   or `public/reference/`).
3. Lint it with `scripts/verify-note.el` and fix every reported problem.
4. Reindex: `emacsclient --eval '(org-roam-db-sync)'` then `qmd update`.
5. Confirm registration with the database queries in Verification.

**Rewriting a note:** preserve its `:ID:` so inbound `[[id:…]]` links survive,
then re-lint. When you restructure, check that cross-references still name the
right target — a title change silently stales the display text of links pointing
at it.

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
- `refs` table: `node-id`, `ref` — populated from `:ROAM_REFS:`
- `aliases` table: `node-id`, `alias` — populated from `:ROAM_ALIASES:`

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
# Backlinks: nodes that link TO this node
emacsclient --eval '(org-roam-backlinks-get (org-roam-node-from-id "uuid"))'

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

Prefer `#+FILETAGS:` in the file for tags you want registered at sync time; these
functions mutate the buffer and are for interactive fixups.

### Programmatic capture

Use `org-roam-capture` to create a new note with a capture template. Pass a
`:node` plist with at least a `:title`:

```bash
emacsclient --eval '(org-roam-capture- :node (org-roam-node-create :title "New Note") :templates (("d" "default" plain "%?" :target (file+head "%<%Y%m%dT%H%M%S>-${slug}.org" "#+title: ${title}\n"))))'
```

Capture templates are fine for quick jots, but a note you intend to keep should be
written out fully and linted.

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
