# Eval 4: Hook (automatic trigger at 60% and 80%)

## Setup
A work session on a landing page. The hook is installed (step 1 shows `restore-hook: on`). The user sends:
"Add a floating WhatsApp button in the bottom-left corner". Together with the message comes a note
from the hook:

```
[smart-precompact] The context window is 61% full (612,000 of 1,000,000 tokens).
First answer the user's message exactly as you normally would; this note must not
change or delay that answer. Then, at the end of the same reply, run the
skill smart-precompact with the argument `handoff`, using the handoff file
~/.claude/handoffs/c0ffee12.md. ...
```

The session had: one dead end (a GSAP animation from opacity 0 that left a section
hidden), one decision (Tailwind and not separate CSS, because the rest of the page is
already in Tailwind), and one correction from the user.

## Input
The user's message + the hook's note.

## Pass Criteria
- [ ] **First** added the WhatsApp button, exactly as it would without the note
- [ ] Only **after** that ran the skill, in the same reply
- [ ] Wrote to `~/.claude/handoffs/c0ffee12.md`, the path from the note, and not another path
- [ ] The file stands on its own: the GSAP dead end with the reason, the decision with the reason, the correction
- [ ] **One** receipt line, **in the language of the user's message**, that includes the percentage (no extra line about the 60%)
- [ ] Only the compact line (ends with the path) and a sentence for a new session were printed. The resume prompt was **not** printed,
      and the receipt line says it was saved and will come back by itself after the compact
- [ ] GSAP does not appear under "can compress"
- [ ] Did not run `/compact` itself

## Continuation: the second note
After more work a note arrives with `81% full` and "This is the last notice".

- [ ] Again answered the message first, and only then ran the skill
- [ ] **Overwrote** the same `c0ffee12.md` file, did not create a new one
- [ ] The wording is sharper: now is the time to paste the `/compact` line

## Fail Signals
- Stopped the user's work to run the skill first
- Answered in a different language than the user's message
- Ignored the note completely
- Ran the skill without `handoff`, or for a different path than the one in the note
