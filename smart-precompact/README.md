# Smart PreCompact

The command: `/smart-precompact`

A Claude Code skill that manages everything around `/compact`: it notices when the context is filling up, prepares a smart compact that keeps what matters, and brings the context back automatically afterward. It does not replace `/compact`, and you keep working in Claude Code as usual.

An independent skill by JayGPTPro. Not an Anthropic product, and not related to the official `PreCompact` hook event.

In detail: it reads the conversation, filters what must
survive, and gives you a `/compact` line with instructions tailored to this conversation, plus a resume prompt for the moment after.
Optional: a hook that reminds you in time, and brings the context back by itself after the compact.


**Any language.** The skill answers in the language you write to it in. Hebrew speakers: see `README.he.md`.

## Why

A regular compact summarizes the whole conversation, without knowing what matters most to you. In a
summary like that, the small details are the ones that get swallowed: why you decided, what already
failed, what you asked for, and the exact wording of errors. Then
Claude tries again an approach that was already rejected, or asks a question you already answered. The skill tells the summary what
must not be lost, saves the continuation to a file, and brings it back into the conversation after the compact.

## What you get

```text
/compact Keep: why the kitchen background was rejected for the main image (Amazon requires a white background), why
image 2 is a dimensions infographic (competitors' customers complain the product is smaller than expected), and the
user's request: "don't change the title. We only work on the images". You can compress the wording rounds.
```

```text
Continue where we left off.

Building: an image set for an Amazon listing of a collapsible water bottle.
State: the main image is ready, on a white background. Images 2 to 7 are not created yet.
Decisions: image 2 is a dimensions infographic, because competitors' customers complain the product is smaller than expected.
Failed, don't retry: a kitchen background for the main image (Amazon requires a white background).
Rules set: don't change the title. We only work on the images.
Next up: 1) the dimensions infographic  2) an image of it in use on a trip  3) show me before we continue.
```

## Installation

### The easy way: Claude installs it
1. Unzip the zip. You get a folder named `smart-precompact`.
2. Drag it into any project folder where Claude Code is open.
3. Paste the contents of `install-prompt.txt` to Claude. It copies the skill, asks whether to add
   the hook, and checks that everything works.

### Manually
1. Copy the folder to `~/.claude/skills/smart-precompact/`
   (on Windows: `%USERPROFILE%\.claude\skills\smart-precompact\`).
2. Open a new Claude Code session and type `/smart-precompact`.

**Updating a version:** if an earlier version is already installed, save your `config.md` before copying,
and put it back afterward. Your settings live there.

## Usage

| What you type | What happens |
|---|---|
| `/smart-precompact` | The blocks to paste. Nothing is written to disk |
| `/smart-precompact handoff` | Also saves the resume prompt in `~/.claude/handoffs/`, so a new session can continue from it |
| `/smart-precompact save` | Also adds decisions and tasks to `docs/DECISIONS.md` and `docs/TASKS.md`, if they already exist in the project |
| `/smart-precompact save notes` | Like `save`, and also writes to your notes folder (Obsidian or similar). You set the path in `config.md` |

You can also write it in words: "prep me for compact", or "prep me for compact and save" for `handoff`.

**Secrets:** keys, tokens and passwords that came up in the conversation are replaced with `[REDACTED]` before they go into
a block or a file.

## The hook (optional, recommended)

The hook does not run the compact for you. No hook can. It does two things:

1. **Reminds you in time.** On every message you send it checks how full the context is. At 60% Claude first
   answers you as usual, and at the end of the reply prepares the /compact line for you and saves the resume prompt to a file.
   At 80% it prepares them again and tells you it is time.
2. **Brings the context back.** Right after a compact, manual or automatic, it puts the continuation
   file back into the conversation. You only copy the ready /compact line and send it. And if you missed it and the automatic compact ran by itself,
   the context from the last time the skill ran comes back anyway.

On models with a small window (200 thousand tokens) the thresholds are lower: 50% and 70%.

**Install:**

```bash
python3 ~/.claude/skills/smart-precompact/scripts/install_hook.py
```

The script saves a backup of `~/.claude/settings.json`, adds the hook without touching other
hooks, and checks that the file is valid. On Windows write `python` instead of `python3`.

**Check that it works:**

```bash
python3 ~/.claude/skills/smart-precompact/scripts/compact_hook.py --test
```

Send any message in Claude Code. In the reply Claude will say the hook works, and write how full the context
is right now and what window size the hook assumes. If the number does not look like what you see, see "Limitations".
If nothing happens, open a new session (settings load at the start of a session).

**Remove the hook only:**

```bash
python3 ~/.claude/skills/smart-precompact/scripts/install_hook.py --uninstall
```

**Change the thresholds:** in the `THRESHOLDS` lines at the top of `scripts/compact_hook.py`.

**What is stored on your computer:** the hook reads only the token counts from the local conversation file. The skill writes
one small continuation file per conversation in `~/.claude/handoffs/` (up to about 200 words: what you are building, what was decided,
what failed and what you asked), and the hook keeps a state file next to it with no conversation content. Within one conversation the continuation file
is overwritten on every save, and the hook deletes a continuation file nobody touched for 14 days. It deletes only files the skill wrote, and never
the current conversation's file or a file named in your message.
There is no server and nothing is sent to any new destination: after the compact the continuation comes back into the conversation with Claude, like any other
message in it. Something is written into the project only if you explicitly asked for `save`.

## Limitations

- **Claude cannot run `/compact` itself.** It prepares the line, and you send it.
- **The hook fires only when you send a message.** If Claude is working alone on a long task, the note arrives
  with your next message.
- **A new session does not know about the continuation file by itself.** You paste it the sentence from the third block. With the hook
  the file is kept for 14 days from the last time it was written. For longer, `save`.
- **The window size is guessed from the model name.** Opus 4.7 and up, Sonnet 5 and up, and Fable: one million
  tokens. The rest: 200 thousand. Working through Bedrock, Vertex or a gateway with a different window? Set
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the right size.
- **The hook requires Python 3.8 or newer.** Tested on macOS. Not yet tested in practice on Windows and Linux.

## Full removal

```bash
python3 ~/.claude/skills/smart-precompact/scripts/install_hook.py --uninstall
```

And then delete `~/.claude/skills/smart-precompact`. Your continuation files stay
in `~/.claude/handoffs/`, and without the hook they are no longer deleted automatically. You can delete the folder.

## Development

```bash
python3 scripts/test_compact_hook.py
```

The tests run in temporary folders and do not touch your `~/.claude`.

---
Built with the-skill-skiller · jaygptpro
