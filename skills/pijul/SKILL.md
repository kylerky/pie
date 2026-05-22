---
name: pijul
description: Version control with Pijul, a patch-based distributed VCS. Use for initializing repos, recording/amending changes, managing channels, applying patches, pushing/pulling to remotes, viewing logs/diffs, handling conflicts, splitting/combining changes, and collaborating via the Nest or SSH remotes.
---

# Pijul

Pijul is a distributed version control system based on a sound mathematical
theory of changes (patches). It stores **changes**, not snapshots. Its patch
theory guarantees that independent changes **commute** — they can be applied in
any order without changing the result.

Core properties:

- **Changes are first-class** — each change is a signed patch with a hash,
  dependencies, message, timestamp, and authors. Changes form a DAG.
- **Commutation** — independent changes can be applied in any order. Rebasing
  and merging are the same operation; cherry-picked patches keep their hash.
- **Conflicts are between changes** — conflicts live in the patch algebra, not
  between branches. Solving a conflict once solves it everywhere; conflicts
  never mysteriously reappear.
- **The pristine** — an internal conflict-tolerant representation of the
  recorded state. Edits from both sides of a conflict are always preserved.

Pijul thinks in terms of recording, applying, and unrecording patches onto
channels. The working copy, the tree of tracked files, the pristine (recorded
state), and the set of changes are separate concerns.

---

## Setup

### Configuration

Pijul reads config from TOML files. The global config path is platform-dependent
(see the manual); on Linux it is `~/.config/pijul/config.toml`.

```toml
[author]
name = "username"
full_name = "Full Name"
email = "email@example.com"
```

Repository-specific config lives in `.pijul/config`:

```toml
colors = "always"
pager = "always"
unrecord_changes = 10
default_remote = "me@ssh.pijul.com:me/repo"

[hooks]
record = ["cargo fmt"]

[remotes]
mirror = "me@ssh.example.com:me/repo-mirror"
```

### Identity

Pijul uses cryptographic identities (not permanent author metadata). Create an
identity before your first record:

```bash
pijul identity new
```

Options:

```bash
pijul identity new --username "me" --display-name "My Name" --email "me@example.com"
pijul identity new --remote "me@ssh.pijul.com:me/repo"   # link to a remote
pijul identity new --expiry "2027-01-01"                   # set expiry
pijul identity new --no-link                               # don't link to remote
```

Other identity commands:

```bash
pijul identity list      # list all identities
pijul identity edit      # edit an identity
pijul identity remove    # remove an identity
pijul identity prove     # prove identity to a server
pijul identity repair    # repair on-disk state / migrate from older versions
```

### Ignoring files

Create a `.ignore` file in the repo root (standard glob syntax, same as
`.gitignore`). Use `pijul init --kind=rust` to auto-populate it with sensible
defaults for known project kinds.

---

## Repositories

### Start a new project

```bash
pijul init                            # create .pijul/ in the current directory
pijul init --channel trunk            # custom default channel name
pijul init --kind rust                # populate .ignore for Rust projects
pijul init /path/to/project           # init at a specific path
```

### Clone a repository

```bash
pijul clone https://nest.pijul.com/pijul/pijul
pijul clone me@ssh.pijul.com:me/repo
pijul clone ../local-repo             # local clone

# Partial clone — only a specific change and its dependencies
pijul clone --change <hash> <remote>

# Clone only specific paths
pijul clone --path src/ --path docs/ <remote>

# Clone a specific channel
pijul clone --channel devel <remote>
```

---

## Working with files

### Track, remove, move, list

```bash
# Track files (add them to the internal tree)
pijul add -r .                        # recursively add everything
pijul add src/main.rs README.md       # specific paths

# Stop tracking (record afterwards to create a deletion change)
pijul remove old-file.txt

# Move / rename (updates working copy + tree)
pijul move old-name.txt new-name.txt

# List tracked files
pijul list
```

### See what changed

```bash
pijul diff                            # unrecorded changes
pijul diff -s                         # short summary
pijul diff -u                         # include untracked files
pijul diff --channel feature          # diff against another channel
pijul diff src/lib.rs                 # specific paths

# The quick "what's going on" overview:
pijul diff -s -u
```

### Discard unrecorded changes

```bash
pijul reset                           # discard all unrecorded changes
pijul reset src/file.rs               # reset specific files
pijul reset --dry-run src/file.rs     # preview (single file only)
pijul reset --channel main            # reset to a different channel
```

---

## Recording changes

`pijul record` compares the working copy to the pristine and creates a change.
It is **interactive by default** — it opens your editor showing the change to be
recorded.

The editor buffer is divided into three blocks:

- **Preamble** — `message`, `timestamp`, `[[authors]]`. You must fill in the
  `message` field.
- **`# Dependencies`** — informational only (shown for context). Pijul
  recomputes dependencies when you save.
- **`# Changes`** — enumerated diff sections. **Remove any section to exclude it
  from this record.** The working copy is not touched; record the remaining
  sections later.

### Basic recording

```bash
# Interactive — opens editor
pijul record

# Non-interactive — supply a message (still opens editor to confirm)
pijul record -m "Fix parser bug"

# Record everything that changed
pijul record -a -m "Update dependencies"

# Record only specific paths
pijul record src/parser.rs tests/

# Record to a specific channel
pijul record --channel feature -m "New feature work"
```

### Amending a change

Edit a previously recorded change — useful for splitting one large change into
several smaller ones:

```bash
pijul record --amend <hash>
```

The editor opens with the change. Remove the sections you want to keep as
unrecorded changes. After saving, those sections remain in the working copy;
record them as separate changes.

### Splitting changes on record

During `pijul record`, the editor shows all unrecorded changes as enumerated
sections. Delete the sections you don't want in this change, save, and close.
The working copy stays untouched. Run `pijul record` again to capture the
remaining sections.

### Splitting an already-recorded change

```bash
pijul unrecord <hash>     # remove the change from log (working copy unchanged)
pijul record              # record first part (remove unwanted sections in editor)
pijul record              # record remaining parts
```

Alternatively, pipe split diffs into `pijul apply`:

```bash
pijul unrecord <hash>
pijul record              # in editor, copy the whole diff to a temp file
# Cancel the record (close editor without saving a message)
# Split the temp file into file1, file2, ... (each with preamble + sections)
pijul apply < file1
pijul apply < file2
```

### Combining changes

```bash
pijul unrecord <hash1> <hash2> <hash3>
pijul record              # all unrecorded changes become one new change
```

---

## Working with channels

A **channel** is a named pointer to a set of changes. Channels are lighter than
branches in other VCSes — since independent changes commute, many tasks that
would require a separate branch elsewhere don't need a channel in Pijul.

Use channels when you need to maintain a distinct **line of development** with a
different set of applied changes. Recorded changes belong to the current
channel, but they can be applied to any channel without changing their identity.

### Listing and switching

```bash
pijul channel                         # list channels (* marks current)
pijul channel switch feature           # switch to another channel
```

### Creating channels

```bash
pijul fork feature                    # fork current channel
pijul fork --channel main bugfix      # fork from a specific channel
pijul channel new experimental        # create an empty channel
```

### Renaming and deleting

```bash
pijul channel rename old-name new-name
pijul channel rename new-name          # rename current channel
pijul channel delete old-feature       # must not be the current channel
```

### Merging work between channels

There is no "merge all" command. Apply specific changes from one channel to
another:

```bash
pijul log --channel feature            # find the change hash
pijul apply <hash>                     # applies it + all its dependencies
```

---

## Applying changes

Apply a change from the repository, from another channel, or from a file:

```bash
pijul apply <hash>                     # apply change to current channel
pijul apply <hash> --channel main      # apply to a specific channel
pijul apply <hash> --deps-only         # only dependencies, not the change itself
pijul apply < patch-file               # apply from a text file (stdin)
```

---

## Viewing history

```bash
pijul log                              # full log for current channel
pijul log --limit 10                   # last N changes
pijul log --hash-only                  # only change hashes
pijul log --description                # include full descriptions
pijul log --files                      # include changed file lists
pijul log --channel feature            # log for a different channel
pijul log -- <file>                    # filter: only changes touching these files

# Show a specific change
pijul change <hash>                    # full change details

# Show dependencies (what depends on this change)
pijul dependents <hash>

# Show which change last touched each line
pijul credit src/main.rs
pijul credit --channel feature src/lib.rs
```

---

## Unrecording changes

Remove changes from the channel log. The working copy is **unchanged** unless
`--reset` is used. Only changes whose dependents are also unrecorded can be
removed.

```bash
pijul unrecord                          # interactive — pick from list
pijul unrecord <hash> <hash>            # specific changes by hash
pijul unrecord --reset                  # also undo changes in working copy
pijul unrecord --channel feature <hash> # from a specific channel
pijul unrecord --show-changes 20        # show N changes in the editor picker
```

The number of changes shown in interactive mode is controlled by
`unrecord_changes` in config (or `--show-changes`).

---

## Remote collaboration

Pijul supports SSH (push + pull), HTTPS (pull only), and local paths (both).

### Managing remotes

```bash
pijul remote                            # list remotes
pijul remote default me@ssh.pijul.com:me/repo   # set default remote
pijul remote delete <name>              # delete a named remote
```

Remotes can also be defined in `.pijul/config`:

```toml
default_remote = "me@ssh.pijul.com:me/repo"

[remotes]
mirror = "me@ssh.example.com:me/repo-mirror"
```

### Pushing

```bash
pijul push                              # push to default remote (interactive)
pijul push me@ssh.pijul.com:me/repo     # push to a specific remote
pijul push --all                        # push all changes
pijul push --from-channel feature       # push from a specific channel
pijul push --to-channel devel           # push to a specific remote channel
pijul push -- <hash> <hash>             # push only specific changes
```

Unless `--all` is used, `pijul push` is interactive — you choose which changes
to send. Changes can be kept locally for as long as you like.

### Pulling

```bash
pijul pull                              # pull from default remote
pijul pull me@ssh.pijul.com:me/repo     # pull from a specific remote
pijul pull --all                        # pull all changes
pijul pull --from-channel devel         # pull from a specific remote channel
pijul pull --to-channel feature         # pull into a specific channel
pijul pull --path src/                  # partial pull — only these paths
pijul pull -- <hash>                    # pull only specific changes
```

Pijul must be installed on the remote machine for SSH remotes.

### Authenticating with HTTP servers

```bash
pijul client <url>                      # authenticate with an HTTP server
```

---

## Tags

Tags are compressed channels — a snapshot of the state at a point in time. Tags
are not independent from the changes they contain.

```bash
pijul tag create                        # interactive tag creation
pijul tag create -m "v1.0.0"            # create with a message

# Checkout a tag into a new channel
pijul tag checkout <tag>
pijul tag checkout <tag> --to-channel my-channel

# Reset working copy to a tag's state
pijul tag reset <tag>

# Delete a tag
pijul tag delete <tag>
pijul tag delete <tag> --channel feature
```

---

## Archives

Export the repository state as an archive:

```bash
pijul archive -o project.tar.gz                     # current channel
pijul archive --channel feature -o feat.tar.gz       # specific channel
pijul archive --remote origin -o remote.tar.gz       # from a remote
pijul archive --state <state> -o state.tar.gz        # specific state
pijul archive --prefix my-project/ -o out.tar.gz     # prefix paths in archive
```

---

## Key concepts

### Changes

The fundamental unit in Pijul. Each change has a cryptographic hash,
dependencies (other changes it builds on), signed authors, a message, and a
timestamp. Changes form a DAG. Independent changes commute.

### The tree and the pristine

- **Tree** — the set of files Pijul tracks (`pijul add` / `pijul remove` modify
  it, `pijul list` shows it).
- **Pristine** — an internal conflict-tolerant representation of the recorded
  state. When you run `pijul record`, Pijul diffs the working copy against the
  pristine and applies the resulting change to the pristine.
- **Working copy** — your actual files on disk. `pijul reset` overwrites it from
  the pristine.

### Channels

Channels are named pointers to sets of changes. They let you maintain multiple
lines of development in one repository. Since changes commute, you often don't
need a channel where another VCS would require a branch.

### Conflicts

Conflicts live in the patch algebra. Edits from both sides are always preserved
in the pristine. Conflicts are detected by examining the pristine after applying
changes — they are between changes, not between channels. Resolving a conflict
once solves it in every context.

---

## Tips

- `pijul record` opens an editor: fill in the message, optionally remove diff
  sections to split changes, save and close.
- `pijul diff -s -u` is the quick "what's going on" overview.
- Use `pijul log --hash-only` to get change hashes for `apply` / `unrecord`.
- To undo a record while keeping the changes: `pijul unrecord` (without
  `--reset`). Then `pijul record` again.
- Use `--no-prompt` to skip interactive prompts in scripts.
- Set `unrecord_changes` in config to control how many changes appear in the
  interactive `pijul unrecord` picker.
- Generate shell completions: `pijul completion <shell>`.
