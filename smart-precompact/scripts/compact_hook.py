#!/usr/bin/env python3
"""Smart PreCompact hook for Claude Code. One script, two events.

UserPromptSubmit: when the context crosses a threshold (60% then 80%, or 50% then
70% on a 200K window), add a note telling Claude to answer the user first and then
run the skill smart-precompact in handoff mode. Once per threshold per session;
it fires again after a compact brings usage back down.

SessionStart with source "compact": put this session's handoff file back into
context right after a manual or automatic compaction, once per version of the file.

On both events: delete handoff files nobody rewrote for 14 days. Only files that
start with the skill's "# Handoff . " header, and never this session's own file or
a file the prompt names. Restoring a file never deletes it, so later compacts in
the same session can restore it again.

Context size comes from the session transcript: the newest main-thread assistant
message's input_tokens + cache_creation_input_tokens + cache_read_input_tokens,
the same input-only count Claude Code reports as context used. The hook never
blocks: on any failure it exits 0 and prints nothing.

  python3 compact_hook.py --test           the next prompt in any session gets a one-time "hook works" note
  python3 compact_hook.py --check [FILE]   print what the hook sees (newest transcript by default)
"""
import glob, json, os, re, sys, time

THRESHOLDS = (60, 80)           # windows of 500K tokens and up
THRESHOLDS_SMALL = (50, 70)     # smaller windows, where auto-compact keeps a larger share in reserve

HOME = os.path.expanduser("~")
HANDOFF_DIR = os.path.join(HOME, ".claude", "handoffs")
STATE_DIR = os.path.join(HANDOFF_DIR, ".state")
TEST_MARKER = os.path.join(STATE_DIR, "test-next-prompt")
STATE_TTL_SECS = 14 * 24 * 3600
HANDOFF_TTL_SECS = 14 * 24 * 3600   # a handoff file nobody rewrote for this long is deleted
HANDOFF_HEADER = b"# Handoff . "     # the skill's first line; files without it are not ours to delete
RESTORE_MAX_CHARS = 6000
COMPACT_LINE_PREFIX = "<!-- compact:"   # the skill's hidden /compact line, read by the mod

ONE_M, TWO_HUNDRED_K = 1_000_000, 200_000
INPUT_KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
THIRD_PARTY = ("CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY")

# A prompt that already asks for the skill: the hook stays quiet and counts the threshold as handled.
SKILL_REQUEST = re.compile(r"/smart-precompact\b|prep(are)? (me )?(for )?compact|before (i |the )?compact|לקומפאקט|לפני (ה)?קומפאקט", re.I)
SKIP_COMMAND = re.compile(r"/(compact|clear)(\s|$)", re.I)


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def parse(raw):
    try:
        rec = json.loads(raw)
    except ValueError:
        return None
    return rec if isinstance(rec, dict) else None


def safe_id(session_id):
    return re.sub(r"[^A-Za-z0-9_-]", "_", session_id)


def tail_lines(path, block=1 << 20):
    """Yield the file's lines newest first, reading backwards in blocks.
    A line longer than a block is joined once, so time stays linear in its length."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos, pieces = f.tell(), []
        while pos > 0:
            step = min(block, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step)
            end = len(buf)
            while True:
                cut = buf.rfind(b"\n", 0, end)
                if cut < 0:
                    pieces.append(buf[:end])
                    break
                pieces.append(buf[cut + 1:end])
                line = b"".join(reversed(pieces))
                pieces = []
                if line.strip():
                    yield line
                end = cut
        line = b"".join(reversed(pieces))
        if line.strip():
            yield line


def last_usage(path):
    """(tokens, model) of the newest main-thread assistant message.
    (0, None) when a compact boundary comes first or nothing is found."""
    for raw in tail_lines(path):
        boundary = b"compact_boundary" in raw
        if not boundary and not (b'"usage"' in raw and b'"assistant"' in raw):
            continue
        rec = parse(raw)
        if not rec:
            continue
        if boundary and rec.get("type") == "system" and rec.get("subtype") == "compact_boundary":
            return 0, None
        if rec.get("type") != "assistant" or rec.get("isSidechain"):
            continue
        msg = rec.get("message") or {}
        usage = msg.get("usage") or {}
        tokens = sum(to_int(usage.get(k)) for k in INPUT_KEYS)
        if tokens > 0:
            return tokens, msg.get("model")
    return 0, None


def flag(name):
    return os.environ.get(name, "").strip().lower() not in ("", "0", "false", "no")


def model_window(model):
    """Context window for a model id, per the Claude Code model docs. On the
    Anthropic API, Fable, Sonnet 5+ and Opus 4.7+ run with 1M tokens; on Bedrock,
    Vertex and Foundry only Sonnet 5+ and [1m]-pinned ids do. Everything else: 200K."""
    m = (model or "").lower()
    if "[1m]" in m:
        return ONE_M
    hit = re.search(r"claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?", m)
    if not hit:
        return TWO_HUNDRED_K
    family, major, minor = hit.group(1), int(hit.group(2)), int(hit.group(3) or 0)
    if family == "sonnet" and major >= 5:
        return ONE_M
    if any(flag(v) for v in THIRD_PARTY):
        return TWO_HUNDRED_K
    if family == "fable" or (family == "opus" and (major, minor) >= (4, 7)):
        return ONE_M
    return TWO_HUNDRED_K


def window_tokens(value):
    """A window value the way Claude Code reads it: leading digits only, clamped to 100K-1M."""
    hit = re.match(r"\s*(\d+)", str(value or ""))
    return min(max(int(hit.group(1)), 100_000), ONE_M) if hit else 0


def auto_compact_setting(cwd):
    """autoCompactWindow from local, project, then user settings (first one set wins)."""
    paths = []
    if cwd:
        paths += [os.path.join(cwd, ".claude", "settings.local.json"), os.path.join(cwd, ".claude", "settings.json")]
    paths.append(os.path.join(HOME, ".claude", "settings.json"))
    for path in paths:
        try:
            with open(path, encoding="utf-8") as f:
                value = window_tokens(json.load(f).get("autoCompactWindow"))
        except (OSError, ValueError, AttributeError):
            continue
        if value:
            return value
    return 0


def context_window(model, cwd, tokens=0):
    """The ceiling the percentage is measured against: the model's window,
    lowered to the auto-compact window when one is set below it."""
    window = model_window(model)
    custom = to_int(os.environ.get("CLAUDE_CODE_MAX_CONTEXT_TOKENS"))
    if custom and model and not str(model).lower().startswith("claude-"):
        window = custom  # Claude Code applies this only to ids it does not recognize
    if flag("CLAUDE_CODE_DISABLE_1M_CONTEXT"):
        window = min(window, TWO_HUNDRED_K)
    if tokens > window:
        window = ONE_M  # the guess was too small: this session is already past it
    auto = window_tokens(os.environ.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW")) or auto_compact_setting(cwd)
    return min(window, auto) if auto else window


def thresholds_for(window):
    return THRESHOLDS if window >= 500_000 else THRESHOLDS_SMALL


def state_path(session_id):
    return os.path.join(STATE_DIR, safe_id(session_id) + ".json")


def load_state(session_id):
    try:
        with open(state_path(session_id), encoding="utf-8") as f:
            state = json.load(f)
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def try_save(session_id, state):
    try:
        save_state(session_id, state)
    except OSError:
        pass


def save_state(session_id, state):
    os.makedirs(STATE_DIR, exist_ok=True)
    state["at"] = int(time.time())
    tmp = state_path(session_id) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, state_path(session_id))
    now = time.time()
    for path in glob.glob(os.path.join(STATE_DIR, "*.json")):
        try:
            if now - os.path.getmtime(path) > STATE_TTL_SECS:
                os.remove(path)
        except OSError:
            pass


def handoff_file(session_id):
    return os.path.join(HANDOFF_DIR, safe_id(session_id)[:8] + ".md")


def handoff_display(session_id):
    return "~/.claude/handoffs/%s.md" % safe_id(session_id)[:8]


def is_handoff(path):
    try:
        with open(path, "rb") as f:
            return f.read(len(HANDOFF_HEADER)) == HANDOFF_HEADER
    except OSError:
        return False


def sweep_stale_handoffs(keep, prompt=""):
    """Delete handoff files nobody rewrote for HANDOFF_TTL_SECS: .md files directly in the folder
    that start with the skill's header. Never `keep` (this session's file), never a file the prompt
    names (a resume sentence pasted into a new session), never folders, links or anyone else's files."""
    now = time.time()
    try:
        entries = list(os.scandir(HANDOFF_DIR))
    except OSError:
        return
    for entry in entries:
        try:
            if (entry.name.endswith(".md") and entry.name != keep and entry.name not in prompt
                    and entry.is_file(follow_symlinks=False)
                    and now - entry.stat(follow_symlinks=False).st_mtime > HANDOFF_TTL_SECS
                    and is_handoff(entry.path)):
                os.remove(entry.path)
        except OSError:
            pass


def tokens_text(tokens, window):
    return "%s of %s tokens" % (format(tokens, ","), format(window, ","))


def threshold_note(tier, last, pct, tokens, window, path):
    head = ("[smart-precompact] The context window is %d%% full (%s). First answer the user's message exactly as "
            "you normally would; this note must not change or delay that answer. " % (pct, tokens_text(tokens, window)))
    if tier < last:
        return head + ("Then, at the end of the same reply, run the skill smart-precompact with the argument `handoff`, "
                       "using the handoff file %s. Its receipt line, in the language of the user's message, says the "
                       "context passed %d%% and the /compact line is ready. After /compact, this hook restores the "
                       "handoff file by itself." % (path, tier))
    return head + ("This is the last notice, so blocks from an earlier notice are stale. At the end of the same reply, run "
                   "the skill smart-precompact with the argument `handoff` again (same file %s, it gets overwritten). "
                   "Its receipt line, in the language of the user's message, says plainly that it is time to compact now: "
                   "press Smart compact in the band above the prompt when it shows, or paste the /compact line, before "
                   "the automatic compaction runs on its own." % path)


def test_note(tokens, window, steps):
    pct = tokens * 100 / window if window else 0
    return ("[smart-precompact] Hook test: the context hook is installed and working. This session's context is %d%% "
            "full (%s; the hook assumes a %s-token window for this model). It adds a note at %s, and restores the "
            "handoff file after a compact. Tell the user this in one or two lines, in the language of their message, "
            "including the assumed window so they can compare it with what Claude Code shows. Then answer the message "
            "as usual. Do not run the skill now."
            % (pct, tokens_text(tokens, window), format(window, ","), " and ".join("%d%%" % t for t in steps)))


def emit(event, text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}))


def on_prompt(data):
    session_id = str(data.get("session_id") or "")
    transcript = data.get("transcript_path") or ""
    tokens, model = (0, None)
    if transcript and os.path.isfile(transcript):
        tokens, model = last_usage(transcript)
    window = context_window(model, data.get("cwd") or "", tokens)
    steps = thresholds_for(window)

    claimed = "%s.%d" % (TEST_MARKER, os.getpid())
    try:
        os.rename(TEST_MARKER, claimed)  # only one session can win the rename
    except OSError:
        claimed = ""
    if claimed:
        os.remove(claimed)
        emit("UserPromptSubmit", test_note(tokens, window, steps))
        return
    if not session_id or not tokens:
        return

    pct = tokens * 100 / window
    tier = max([t for t in steps if pct >= t] or [0])
    state = load_state(session_id)
    fired = to_int(state.get("fired"))
    prompt = str(data.get("prompt") or "").strip()

    if SKIP_COMMAND.match(prompt):
        return
    if SKILL_REQUEST.search(prompt):
        if tier > fired:
            state["fired"] = tier
            try_save(session_id, state)
        return
    if tier > fired:
        state["fired"] = tier
        try_save(session_id, state)
        emit("UserPromptSubmit", threshold_note(tier, steps[-1], pct, tokens, window, handoff_display(session_id)))
    elif fired and pct < steps[0] / 2:
        # Re-arm only after a real drop (a compact lands far below the first threshold),
        # not after a small dip such as a model switch counting the same conversation differently.
        state["fired"] = 0
        try_save(session_id, state)


def on_session_start(data):
    """After a compaction: put this session's handoff file back, once per version."""
    if data.get("source") != "compact":
        return
    session_id = str(data.get("session_id") or "")
    if not session_id:
        return
    state = load_state(session_id)
    state["fired"] = 0
    path = handoff_file(session_id)
    if not os.path.isfile(path):
        try_save(session_id, state)
        return
    mtime = int(os.path.getmtime(path))
    if mtime <= to_int(state.get("restored_mtime")):
        try_save(session_id, state)
        return
    with open(path, encoding="utf-8", errors="replace") as f:
        body = f.read(RESTORE_MAX_CHARS)
    # The skill's last line carries its /compact line for the mod; the conversation does not need it.
    body = "\n".join(line for line in body.splitlines() if not line.startswith(COMPACT_LINE_PREFIX)).rstrip() + "\n"
    state["restored_mtime"] = mtime
    try_save(session_id, state)
    written = time.strftime("%H:%M", time.localtime(mtime))
    emit("SessionStart",
         "[smart-precompact] The conversation was just compacted. Before that, the resume prompt below was saved to "
         "%s at %s. Treat it as the state as of %s: for anything that happened after that, the conversation summary "
         "is newer. The user does not need to paste it.\n\n%s" % (handoff_display(session_id), written, written, body))


def newest_transcript():
    files = glob.glob(os.path.join(HOME, ".claude", "projects", "*", "*.jsonl"))
    return max(files, key=os.path.getmtime) if files else ""


def cli(argv):
    """--test and --check: say what went wrong instead of failing silently."""
    if argv[1:2] == ["--test"]:
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
            open(TEST_MARKER, "w").close()
        except OSError as err:
            print("Could not arm the test: %s" % err)
            return 1
        print("Armed. Send any message in Claude Code: the reply should confirm the hook works and show the context %.")
        return 0
    path = argv[2] if len(argv) > 2 else newest_transcript()
    if not path or not os.path.isfile(path):
        print("No transcript found%s." % (" at " + path if path else ""))
        return 1
    tokens, model = last_usage(path)
    window = context_window(model, os.getcwd(), tokens)
    print("transcript: %s\nmodel: %s\ntokens: %s\nwindow: %s\nused: %.1f%%\nthresholds: %s"
          % (path, model, format(tokens, ","), format(window, ","), tokens * 100 / window,
             ", ".join("%d%%" % t for t in thresholds_for(window))))
    return 0


def hook():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
    except ValueError:
        return
    if not isinstance(data, dict):
        return
    if data.get("hook_event_name") == "SessionStart":
        on_session_start(data)
    else:
        on_prompt(data)
    session_id = str(data.get("session_id") or "")
    if session_id:  # without an id there is no way to tell which file is this session's
        sweep_stale_handoffs(os.path.basename(handoff_file(session_id)), str(data.get("prompt") or ""))


if __name__ == "__main__":
    if sys.argv[1:2] in (["--test"], ["--check"]):
        sys.exit(cli(sys.argv))
    try:
        hook()
    except Exception:
        pass  # a hook must never block or break a prompt
    sys.exit(0)
