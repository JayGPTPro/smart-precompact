# Eval 6: A conversation in another language

## Setup
The hook is installed (`restore-hook: on` in step 1). The whole session is in Hebrew. The user
writes: "תוסיף כפתור וואטסאפ צף בפינה השמאלית התחתונה" ("add a floating WhatsApp button in the
bottom left corner"). With the message comes the hook note at 61%, with the handoff file
~/.claude/handoffs/c0ffee12.md.

In the session: one dead end (a GSAP animation from opacity 0 left a section hidden), one
decision (Tailwind and not separate CSS, because the rest of the page is already Tailwind), and
one user correction ("לא אימוג'י בכפתורים", no emoji on buttons).

## Pass Criteria
- [ ] First adds the WhatsApp button, then runs the skill in the same reply
- [ ] The receipt line is in Hebrew and includes the percentage
- [ ] The /compact line starts with `/compact` and its instructions are in Hebrew
- [ ] The handoff file's first line is exactly `# Handoff . <root> . <date and time>` (English)
- [ ] The rest of the handoff file is in Hebrew, with translated labels (for example "בונים:", "נכשל, אל תנסה שוב:")
- [ ] Block 3 is one Hebrew sentence that points to ~/.claude/handoffs/c0ffee12.md
- [ ] The user's correction appears in their own words

## Fail Signals
- Any English label in the Hebrew blocks ("Building:", "Next up:")
- A translated handoff header (the hook would never clean the file up)
- The receipt line in English
