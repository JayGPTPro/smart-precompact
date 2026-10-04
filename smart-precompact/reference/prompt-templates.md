# The blocks

> The labels below are English. In a conversation in another language, write the same
> labels and prose in that language, translated naturally. `/compact` itself, exact strings
> from the session, and the handoff file's first line (`# Handoff . ...`) stay as they are.

## Why two and not one

`/compact` and the resume prompt act on two different things:

- **`/compact <instructions>`** steers the summarizer *during compaction*. It affects
  what stays inside the summary. It has no access to anything outside the conversation.
- **The resume prompt** goes in *after* the compaction, or at the start of a new
  session. It carries the state and what must not be lost, in a form that stands on
  its own.

The full split, including what may be repeated in both blocks: SKILL.md, step 3.

---

## Block 1: the /compact line

### What goes in

Instructions to **keep** what a regular summarizer drops first:
- **The reason** behind decisions. Summarizers keep "we chose X" and lose the "why".
- **What failed, and why.** Summarizers treat attempts as noise.
- **Exact strings**: field names, query wording, error messages, paths.
- **The user's corrections**, in their own words.

And instructions to **compress** what no longer produces value: debugging rounds that
ended without a lesson, file and log exploration, early drafts of something that was
closed. **A debugging round that produced a dead end is not compressed.**

### Template

```text
/compact Keep: [2 to 4 things specific to this session]. Can compress: [1 to 2 areas].
```

With `handoff`, add at the end: `Handoff file: ~/.claude/handoffs/<name>.md`. **The path
only.** Not "keep the full content of the file": content you ask the summarizer to
carry goes back into the context you just cleared.

Only one item worth keeping? A short line beats artificial filler.

### Bad examples

```text
/compact Keep all the important context and key decisions.
```
This tells the summarizer nothing it is not already trying to do. A generic
instruction is worth zero instructions.

```text
/compact Keep: that we are building an abandoned cart email, that the function is in
jobs/cart.ts, that the branch is feat/abandoned-cart...
```
This is working state, and it belongs in block 2. A compact line that describes state
wastes the chance to protect the reasoning.

A good example: SKILL.md, the "Example" section.

---

## Block 2: the resume prompt

### Template

```text
Continue where we left off.

Building: [one sentence. The goal, not the history]
State: [where it stands now, including what is untested]
Decisions: [X and not Y, because Z]
Failed, don't retry: [dead ends, each with the reason]
Rules set: [corrections the user made in the session, in their own words]
Read before touching: [up to 3 files that matter for the continuation]
Next up: 1) [...] 2) [...] 3) [...]
```

A line with no content is left out. No "Rules set: none".

### Rules

1. **Stands on its own.** A new session that did not see the conversation must be able
   to understand from it what is going on. It is also the content of the handoff file.
2. **Point, do not copy.** "Read `docs/DECISIONS.md`", not a paste of the file. A paste
   re-inflates the context you just cleared.
3. **Dead ends and decisions always with the reason.** "Do not use the webhook" with no
   reason invites an argument. With the reason, it is closed. And the reason is the one
   stated in the conversation, not one that sounds good.
4. **"Next up" is three steps at most.** A list of nine makes the session scatter.
5. **No history.** What we tried earlier does not matter, except the dead ends.
6. **In the user's first person**, since they are the one pasting ("show me"), and in
   the language the conversation was held in.

**Length**: up to 200 words. Longer than that, you did not filter enough.

---

## When the conversation was already compacted once

You see a summary, not the source. If there is a handoff file for this session
(SKILL.md, step 4b), read it: it was written before the compaction. If there is not,
**do not invent details you can no longer see.** Write in the receipt line that the
conversation was compacted before and that the earlier items are available to you only
as a summary, and produce the blocks from what you have. An honest short summary beats
a full invented prompt.
