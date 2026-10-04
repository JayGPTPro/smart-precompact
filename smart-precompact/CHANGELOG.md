# Changelog

## 3.0.0 (2026-10-04)

- **One skill, any language.** The instructions are in English, and everything the user
  sees (the receipt line, the /compact line, the resume prompt, the sentence for a new
  session) comes back in the language of the user's messages. The handoff file's first
  line stays `# Handoff . ...` in every language, because the hook recognizes its own
  files by it.
- Hebrew trigger phrases in the description, and Hebrew requests recognized by the hook.
- `README.he.md` and `install-prompt.he.txt` for Hebrew speakers.
- Tests: Hebrew requests and Hebrew text under a Windows code page.

## 2.0 (2026-10-02 to 2026-10-03)

- **Prepares the compact**: reads the conversation, filters what must survive, and prints
  two ready-to-paste blocks. A `/compact` line with instructions tailored to the session,
  and a resume prompt for right after the compact or for a fresh session. The default run
  writes nothing to disk, and file search is forbidden, so a run takes seconds.
- **Modes**: `handoff` saves the resume prompt to one file per session, outside the
  project. `save` appends decisions, dead ends and tasks to documentation files that
  already exist. `save notes` also writes to a personal notes folder set in `config.md`.
- **Hook**: `scripts/compact_hook.py` reminds at 60% and 80% (50% and 70% on a 200K
  window), and puts the resume file back into the conversation right after a compact,
  automatic ones included. It is installed with `scripts/install_hook.py`, which merges
  the settings safely and saves a backup.
- **Handoff cleanup**: the hook deletes a file in `~/.claude/handoffs/` that nobody
  touched for 14 days, and only if it starts with the skill's `# Handoff . ` header
  (other people's files in the same folder are not deleted). It does not touch the
  current conversation's file, a file the message mentions (the resume sentence pasted
  into a new session after a long break), folders, links or files that are not `.md`.
  Restoring after a compact does not delete the file, because another compact in the same
  conversation needs it again. 55 tests, each checked against a deliberately broken
  version of the code.
- **The resume prompt stands on its own**, with a "Decisions" line. The compact line
  protects the reasoning and never describes state. The only overlap allowed: dead ends
  and user corrections.
- **Secrets** are replaced with `[REDACTED]` before they go into a block or a file.
- **Exact wording**: error messages, paths and commands are copied word for word.
- **A decision the user replaced** is recorded as replacing the old one, with no
  second question.
- Branch and commit are left out of the resume prompt: Claude Code loads fresh git
  state by itself.
- The blocks are printed as `text`, not `bash`.
- Project paths are read from the project root (git), even after a `cd`.
- The skill's permissions are limited to `date` and `mkdir -p`.
- **Accurate promises**: the docs describe exactly what is stored, where, and for how
  long. The manual step (sending the /compact line) is stated outright.
- The example in the README is an Amazon listing.
- Stated plainly: an independent skill, not an Anthropic product.
- Tested: 5 eval scenarios on Sonnet, a separate judge, 2 adversarial reviewers, and an
  activation check (10/10). The hook was run on 749 real conversation files from the
  author's computer without a single error (up to 0.115 seconds per file).

### What was taken from Deep-Compact (github.com/Numb2k/Deep-Compact)
A file that survives a new session, and copying exact strings word for word. What was
not taken: a compact line that asks to carry the whole file "in full" and also to read it
again (the same content enters the context that was just cleared twice), and a
cumulative working-state file that goes stale.
