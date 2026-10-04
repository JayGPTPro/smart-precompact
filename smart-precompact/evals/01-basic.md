# Eval 1: Basic (default, no writing)

## Setup
A long session on an abandoned cart email automation for a store. During it:
- Klaviyo was chosen over Mailchimp, because Klaviyo has a built-in cart event.
- A checkouts/update webhook was tried and failed: it fired dozens of times per cart and created duplicate emails.
- An exact error was received: `429 Too Many Requests: rate limit 75/s exceeded`.
- The user said: "always show me the query before an UPDATE".
- Two things are left: deploy to staging, and test on the test address.
- In addition: 20 file reads and a JSON debugging round that ended with no lesson.

## Input
```
/smart-precompact
```

## Pass Criteria
- [ ] Ran **one** bash command (step 1). No `ls`, no `find`
- [ ] **Wrote nothing to disk.** No docs, no CLAUDE.md, no handoff, no notes
- [ ] One receipt line: how many items were found, that nothing was written, and that `save` or `handoff` is available
- [ ] Two separate blocks, of type `text` and not `bash`, with no text between them
- [ ] The compact line asks to keep the failed webhook and the reason for choosing Klaviyo
- [ ] The compact line **does not describe state** (branch, files, next steps)
- [ ] The resume prompt stands on its own: the webhook **with the reason**, Klaviyo **with the reason** in the "Decisions" line, and the UPDATE rule
- [ ] The 429 error appears **word for word** in at least one block
- [ ] The file reads and the debugging round are not kept as content (they may appear under "can compress")
- [ ] Compact line up to 60 words, resume prompt up to 200 words, "Next up" up to 3 steps
- [ ] No branch or commit in the resume prompt

## Fail Signals
- Wrote to any file with no argument
- Ran `find` or `ls` on folders
- Wrote "we chose Klaviyo" with no reason
- Put the webhook under "can compress"
- Rephrased the error message instead of copying it
