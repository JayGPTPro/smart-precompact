# Smart PreCompact

A free skill for Claude Code that handles everything around `/compact`. It reminds you
before the context fills up, tells the summary what it must keep (what already failed,
why you decided, what you asked for), and brings your context back right after the
compact. Works in any language: it answers in the language you write to it in.

## Install

```
npx skills add JayGPTPro/smart-precompact -g
```

Then turn on the hook (recommended). It adds the 60% reminder and the automatic restore
after a compact:

```
python3 ~/.claude/skills/smart-precompact/scripts/install_hook.py
python3 ~/.claude/skills/smart-precompact/scripts/compact_hook.py --test
```

Open a new Claude Code conversation and send any message: the reply confirms the hook
works and shows how full your context is. On Windows use `python` instead of `python3`.

## Use

Keep working as usual. When the context passes 60%, Claude answers you first, then adds
a ready `/compact` line. Copy it and send it. That is the only manual step.

Run it yourself any time with `/smart-precompact`, or just say "prep me for compact".
Modes: `handoff` (also saves the resume prompt to a file), `save` (appends decisions and
tasks to docs that already exist in your project), `save notes` (also to your notes
folder). Details: [`smart-precompact/README.md`](smart-precompact/README.md).

## בעברית

```
npx skills add JayGPTPro/smart-precompact -g
```

הסקיל עונה בשפה שכותבים לו. הוראות מלאות בעברית:
[`smart-precompact/README.he.md`](smart-precompact/README.he.md)

---

Home page: https://jaygptpro.com/smart-precompact/ · עברית: https://jaygptpro.com/smart-precompact/he/

An independent skill by JayGPTPro, built around Claude Code's `/compact`. Not affiliated
with Anthropic.
