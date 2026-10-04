# Routing table (for `save` and `save notes`)

For every item that passed the omission test, decide where it goes and in what format.
The top rule: **one item, one home** among the documentation files. The same fact in
three files is three facts that will go stale at different rates. (The resume prompt is
not a home. It is a copy for a single read.)

**The creation rule:** in the project, write only to files that already exist. A
missing file is not created, and the item stays in the resume prompt. The only
exceptions, all outside the project: the handoff file (step 4b in SKILL.md), and in the
notes folder, today's log and a new decision file.

---

## The targets

### 1. `docs/DECISIONS.md` (in the project, only if it exists)

**What goes in**: a choice between options, with a reason. And what was rejected, with
the reason it was rejected.

```markdown
## 2026-08-18: Sending the abandoned cart email through a scheduled job
**Context**: Need exactly one email per abandoned cart, an hour after abandonment.
**Decision**: A scheduled job that runs every 15 minutes and checks carts.
**Why**: One event per cart, no duplicates.
**Rejected**: The checkouts/update webhook. It fired dozens of times per cart and created duplicate emails.
```

The `Rejected` field is the most important one in the file. It stops a future session
from wasting an hour on an approach that is already dead. If a decision was made
without weighing an alternative, leave the field out. Do not invent an alternative to
fill it.

**Match the format already in the file.** If the file is written differently, write
like it.

**No `docs/DECISIONS.md`?** The decision stays only in the "Decisions:" line of the
resume prompt. With `save notes` it also goes to the decisions folder in the notes.

---

### 2. `docs/TASKS.md` (in the project, only if it exists)

**What goes in**: what is left to do, phrased as an action that can be carried out.

```markdown
## Open
- [ ] Deploy the scheduled job to staging
- [ ] Test on the test address before turning it on
```

Mark `[x]` on what was completed in this session, if the line already exists. This is
one of the two exceptions to the append-only rule (SKILL.md, step 4a), because ticking
a box does not delete information.

Do not write tasks that are a guess. Only what the user said or confirmed.

---

### 3. The project's `CLAUDE.md` (only if it exists)

**What goes in**: a rule about **how to work**, not a fact about what happened. Almost
always comes from a correction the user made in the conversation. The full bar is in
SKILL.md, step 4a.

```markdown
- Never send to real customers in tests. Only to the test address in .env.
```

**Project or global?** The skill writes only to the project's CLAUDE.md. If the rule
looks right for every project ("always run `date` before calculating a date"), do not
write it to the global file. Suggest it in the receipt line, and the user decides.

Add it to the matching existing section. Do not open a new section if one fits.

---

### 4. The notes folder (only with `save notes`)

The path and folder names come from `config.md`. **Do not search.** No path, or it does
not exist? Say so in one line and skip.

| Folder (`config.md`) | What goes in |
|---|---|
| `daily_logs/YYYY-MM-DD.md` | **Always.** One entry per run |
| `people` | New info about a contact: role, terms, latest context |
| `business` | Project status, milestones, a change of strategy |
| `decisions/YYYY-MM-DD <short title>.md` | A new file for each decision, in the same format as DECISIONS.md above. Business decisions, and any decision when there is no `docs/DECISIONS.md` in the project |
| `preferences` | Work and communication patterns. **Rare.** Most corrections belong in CLAUDE.md |

A folder that does not exist on disk does not get written to. If the user has a skill
that manages the notes folder, follow its formats and do not invent a new structure.

Log format:

```markdown
## 12:05 . Abandoned cart email
- What: built a scheduled job for abandoned carts
- Decisions: check every 15 minutes instead of a webhook (duplicates)
- Next: deploy to staging, then test on the test address
```

Today's log does not exist? Create it with the header `# Daily Log . YYYY-MM-DD`.

**Language**: match the language already in the file. A file in another language gets
that language.

---

### 5. The resume prompt only (no documentation file)

**What stays here and is not written to any documentation file**:
- Which files we touched in this session
- What is half done, what passed testing and what did not
- Branch, commit, staging state
- Anything that will be wrong tomorrow morning

The temptation to write this to a file is strong, and it is exactly the mistake that
produces handoff files full of information from a week ago. Working state goes stale.
Decisions do not.

**The exception: `handoff`.** It saves the resume prompt as it is, to one file that is
overwritten on every run. The file is meant for one read in the next session, not for
documentation. It does not go stale silently, because the next run overwrites it, and
the hook deletes a file nobody touched for 14 days.

---

## Borderline items

| Looks like | Really belongs in | Why |
|---|---|---|
| "We decided to use Tailwind" | Nowhere | `package.json` already says it |
| "Tailwind and not CSS modules, because X" | DECISIONS | The reason does not appear in the code |
| "I fixed the bug in auth.ts" | Nowhere | git diff says it better |
| "The bug came from getUser silently returning null" | DECISIONS (rejected or context) | Knowledge that saves the investigation next time |
| "Dana is in charge of suppliers" | Notes, `people` | A lasting business fact |
| "Always tell me which client you are working on" | The project's CLAUDE.md | A working rule |
| "We have not tested on mobile yet" | The resume prompt | State, will go stale |

---

## Contradictions

A new line contradicts an existing line in a target file. **In both cases, do not
delete or rewrite the old one.**

**The user explicitly replaced it in the conversation** ("we are moving from SendGrid
to Resend"): write the new line with today's date and a reference to the old one
("replaces 2026-06-02"), and note in the receipt line that it replaces. The decision
was already made, so do not ask again.

**The contradiction was found by the way, without the user meaning to change anything**:
write the new line with today's date, note the contradiction in the receipt line, and
do not decide on your own who is right. The user decides.
