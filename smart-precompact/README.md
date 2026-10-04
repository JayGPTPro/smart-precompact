# Smart PreCompact

The command: `/smart-precompact`

A Claude Code skill that manages everything around `/compact`: it notices when the context is filling up, prepares a smart compact that keeps what matters, and brings the context back automatically afterward. It does not replace `/compact`, and you keep working in Claude Code as usual.

An independent skill by JayGPTPro. Not an Anthropic product, and not related to the official `PreCompact` hook event.

In detail: it reads the conversation, filters what must
survive, and gives you a `/compact` line with instructions tailored to this conversation, plus a resume prompt for the moment after.
Optional: a hook that reminds you in time, and brings the context back by itself after the compact.
New: a mod for Claude Code. A band above the prompt shows how full the context is, and its Smart compact button prepares the line and compacts in one press.


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

**Updating a version:** if an earlier version is already installed, save your `config.md` outside
`~/.claude/skills` before copying, and put it back afterward. Your settings live there, and re-running
`npx skills add` replaces the whole folder, `config.md` included. Never keep a backup copy of the skill
folder inside `~/.claude/skills`: Claude Code would load the mod from the backup instead.

## Usage

| What you type | What happens |
|---|---|
| `/smart-precompact` | The blocks to paste. Nothing is written to disk |
| `/smart-precompact handoff` | Also saves the resume prompt in `~/.claude/handoffs/`, so a new session can continue from it |
| `/smart-precompact save` | Also adds decisions and tasks to `docs/DECISIONS.md` and `docs/TASKS.md`, if they already exist in the project |
| `/smart-precompact save notes` | Like `save`, and also writes to your notes folder (Obsidian or similar). You set the path in `config.md` |
| **Smart compact** in the band | Prepares the line in the background and compacts, in one press (see "The band") |

You can also write it in words: "prep me for compact", or "prep me for compact and save" for `handoff`.

**Secrets:** keys, tokens and passwords that came up in the conversation are replaced with `[REDACTED]` before they go into
a block or a file.

## The band (mod)

The skill folder also holds a Claude Code mod. Claude Code loads it by itself in every new session,
with nothing to install, and shows one row above the prompt:

- **How full the context is**, as a percentage and a bar. At 80% (70% on a 200 thousand token window) it turns red.
- **Where things stand:** `ready` (no line prepared yet), `prepared` (the skill prepared one), `Claude is working`.
- **What the session cost** and how much of the 5-hour limit is used, on a wide window.
- **Smart compact:** one press. When the skill prepared a line in the last 15 minutes it uses it.
  Otherwise it first prepares one in the background, which costs one extra model call over the conversation,
  and then compacts with it.
- **Hide:** hides the band until the next threshold (50% and 70% on a 200 thousand token window, 60% and 80% on a million).
  After the last threshold it stays hidden until the next compact.

After a compact the band shows a receipt, such as `✓ Compacted 512k → 41k · 471k lighter`, until you press OK.
With the band loaded, every compact that has no instructions of its own, the automatic one included, gets the
prepared line, or a general list of what to keep when there is none.

**No band?** Your Claude Code version does not run mods yet. The skill and the hook work the same without it.
**Turn the band off** without removing the skill:

```bash
claude plugin disable smart-precompact-mod@skills-dir
```

## The hook (optional, recommended)

The hook (a Python script) does not run the compact for you. It does two things:

1. **Reminds you in time.** On every message you send it checks how full the context is. At 60% Claude first
   answers you as usual, and at the end of the reply prepares the /compact line for you and saves the resume prompt to a file.
   At 80% it prepares them again and tells you it is time.
2. **Brings the context back.** Right after a compact, manual or automatic, it puts the continuation
   file back into the conversation. You only press Smart compact, or copy the ready /compact line and send it. And if you missed it and the automatic compact ran by itself,
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
The band reads Claude Code's own count, so its percentage can differ a little from the hook's.

**Remove the hook only:**

```bash
python3 ~/.claude/skills/smart-precompact/scripts/install_hook.py --uninstall
```

**Change the thresholds:** in the `THRESHOLDS` lines at the top of `scripts/compact_hook.py`.

**What is stored on your computer:** the hook reads only the token counts from the local conversation file. The skill writes
one small continuation file per conversation in `~/.claude/handoffs/` (up to about 200 words: what you are building, what was decided,
what failed and what you asked), and the hook keeps a state file next to it with no conversation content. The band keeps two small logs of its
last compact in `~/.claude/handoffs/.state/` (times and token counts, no conversation content), and a running
total of the tokens it saved. Within one conversation the continuation file
is overwritten on every save, and the hook deletes a continuation file nobody touched for 14 days. It deletes only files the skill wrote, and never
the current conversation's file or a file named in your message.
There is no server and nothing is sent to any new destination: after the compact the continuation comes back into the conversation with Claude, like any other
message in it. Something is written into the project only if you explicitly asked for `save`.

## Limitations

- **Claude cannot run `/compact` itself.** It prepares the line, and you send it. Or press Smart compact in the band,
  which does both in one press.
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
