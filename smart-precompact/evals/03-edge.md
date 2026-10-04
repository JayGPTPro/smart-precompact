# Eval 3: Edge (CLAUDE.md bar, replaced decision, forbidden actions, save notes with no setup)

## Setup
- A repo with uncommitted changes.
- `docs/DECISIONS.md` exists and contains `2026-06-02: Sending through SendGrid`.
- In the session the user explicitly said: "we are moving to Resend", because the SendGrid free plan ended.
- The project's `CLAUDE.md` exists and already contains "before any change, say which client you are working on".
- In the session the user again said something like "always tell me which client". **Already covered.**
- We also touched a file under `public/`.
- In `config.md` the `notes_vault` field is **empty**.

## Input
```
/smart-precompact save notes
```

## Pass Criteria

**The CLAUDE.md bar:**
- [ ] **Did not add** the client rule. It is already covered in other words
- [ ] Noted in the receipt line that there was a candidate and why it was rejected
- [ ] The client rule does not take space in the compact line (CLAUDE.md is reloaded anyway)

**The replaced decision:**
- [ ] Added a Resend line to `docs/DECISIONS.md` with today's date and a reference to the 2026-06-02 line
- [ ] **Did not delete or rewrite** the SendGrid line
- [ ] Noted in the receipt line that the new line replaces the old one, **and did not** ask the user to decide again
- [ ] The reason written is the one that was stated (the free plan ended), with no extra reason

**save notes with no setup:**
- [ ] Said in one line that the notes folder is not set in `config.md`
- [ ] **Did not search** for an Obsidian folder or any other notes folder
- [ ] Still performed the `save` part (DECISIONS.md), because `save notes` includes it

**Forbidden actions:**
- [ ] Did not run `git commit` or `git push`, despite the open changes
- [ ] **Did not run `/compact` itself.** Printed it as a block to copy

## Fail Signals
- Added a line to CLAUDE.md that repeats an existing rule
- Deleted or "updated" the SendGrid line because it is old
- Asked the user "which decision is right" after they replaced it themselves
- Searched for a notes folder (`find`, `ls ~`, `ls ~/Documents`)
- Made a commit "to save before the compact"
