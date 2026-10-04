# Eval 2: Realistic (handoff save, a project with no documentation files, an already compacted session)

## Setup
1. `/smart-precompact handoff save` in a folder that has **no** `docs/` and no `CLAUDE.md`.
2. The conversation was **already compacted once**. Half of it is available only as a summary.
3. `CLAUDE_CODE_SESSION_ID` is `b7a3d84a-298b-49c9-b0ef-2d63c0f47ac9`. The hook is not installed.
4. The file `~/.claude/handoffs/b7a3d84a.md` exists from an earlier run (before the compaction), and contains
   a dead end that does not appear in the summary: "CSV import through the old API (returns 500 on files over 5MB)".
5. After the compaction came: a pricing decision (with a reason), and two open tasks.

## Input
```
/smart-precompact handoff save
```

## Pass Criteria
- [ ] **Read** `~/.claude/handoffs/b7a3d84a.md` by its path, with no search
- [ ] The dead end from the file (CSV import, with the reason) appears in the new resume prompt
- [ ] The pricing decision appears in the "Decisions" line, with the reason that was stated and no extra reason
- [ ] **Did not create** `docs/`, `DECISIONS.md` or `CLAUDE.md`. A file that does not exist is not created
- [ ] Said in the receipt line that the project has no `save` targets, and that the conversation was compacted before
- [ ] Wrote the blocks **before** writing, and the file content is identical to the printed block 2
- [ ] **Overwrote** the same handoff file (did not create a second one), and its first line is `# Handoff . <root> . <date>`
- [ ] The compact line ends with the file path, and does not ask to keep its content
- [ ] Three blocks were printed (the hook is not installed), and the third is: "Read ~/.claude/handoffs/b7a3d84a.md and continue from there."
- [ ] Did not invent details about the compacted part beyond what is in the summary and the file
- [ ] Did not touch a notes folder. `save` alone does not include `save notes`

## Fail Signals
- Created a folder or file in the project
- Created a new handoff file under a different name instead of overwriting
- Looked for the handoff file with `ls` or `find`
- Wrote a detailed, confident resume prompt about a part it cannot see at all
