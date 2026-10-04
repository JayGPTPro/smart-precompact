#!/usr/bin/env python3
"""Tests for compact_hook.py and install_hook.py. Temp folders only; never touches your ~/.claude.

    python3 scripts/test_compact_hook.py
"""
import json, os, subprocess, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "compact_hook.py")
INSTALLER = os.path.join(HERE, "install_hook.py")
SID = "abcd1234-0000-4000-8000-000000000000"


def assistant(tokens, model="claude-opus-5-5", sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain,
            "message": {"model": model, "usage": {"input_tokens": 2, "cache_creation_input_tokens": 1000,
                                                  "cache_read_input_tokens": tokens - 1002, "output_tokens": 500}}}


def user(text="hi"):
    return {"type": "user", "isSidechain": False, "message": {"role": "user", "content": text}}


BOUNDARY = {"type": "system", "subtype": "compact_boundary", "content": "Conversation compacted"}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        self.transcript = os.path.join(self.home, "t.jsonl")
        self.records = []

    def tearDown(self):
        self.tmp.cleanup()

    def env(self, extra=None):
        e = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CODE_")}
        e["HOME"] = self.home
        e["USERPROFILE"] = self.home
        e.update(extra or {})
        return e

    def run_script(self, script, args=(), stdin="", env=None):
        p = subprocess.run([sys.executable, script, *args], input=stdin.encode("utf-8"), capture_output=True,
                           env=self.env(env), timeout=30)
        p.stdout, p.stderr = p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
        return p


class HookTest(Base):
    def add(self, *records):
        self.records += records
        with open(self.transcript, "w") as f:
            for r in self.records:
                f.write(json.dumps(r) + "\n")

    def prompt(self, text="next", stdin=None, env=None):
        if stdin is None:  # raw UTF-8, the way Claude Code sends it, not \u escapes
            stdin = json.dumps({"session_id": SID, "transcript_path": self.transcript, "cwd": self.home,
                                "hook_event_name": "UserPromptSubmit", "prompt": text}, ensure_ascii=False)
        p = self.run_script(HOOK, stdin=stdin, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def compacted(self, source="compact"):
        stdin = json.dumps({"session_id": SID, "transcript_path": self.transcript, "cwd": self.home,
                            "hook_event_name": "SessionStart", "source": source})
        p = self.run_script(HOOK, stdin=stdin)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def note(self, out, event="UserPromptSubmit"):
        self.assertTrue(out, "expected a note, got nothing")
        data = json.loads(out)
        self.assertEqual(data["hookSpecificOutput"]["hookEventName"], event)
        return data["hookSpecificOutput"]["additionalContext"]

    def write_handoff(self, text="Continue where we left off.\nFailed, don't retry: webhook"):
        d = os.path.join(self.home, ".claude", "handoffs")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, SID[:8] + ".md")
        with open(path, "w", encoding="utf-8") as f:
            f.write("# Handoff . /x . 2026-10-02 14:30\n\n" + text)
        return path

    # thresholds on a 1M model
    def test_below_threshold_is_silent(self):
        self.add(user(), assistant(599_000))
        self.assertEqual(self.prompt(), "")

    def test_first_threshold_fires_once(self):
        self.add(user(), assistant(610_000))
        text = self.note(self.prompt())
        self.assertIn("61% full", text)
        self.assertIn("`handoff`", text)
        self.assertIn("~/.claude/handoffs/abcd1234.md", text)
        self.add(user(), assistant(620_000))
        self.assertEqual(self.prompt(), "", "the same threshold must not fire twice")

    def test_second_threshold_fires_with_last_notice(self):
        self.add(user(), assistant(610_000))
        self.note(self.prompt())
        self.add(user(), assistant(810_000))
        text = self.note(self.prompt())
        self.assertIn("last notice", text)
        self.assertIn("/compact", text)

    def test_jump_straight_past_both_fires_last_notice_once(self):
        self.add(user(), assistant(850_000))
        self.assertIn("last notice", self.note(self.prompt()))
        self.assertEqual(self.prompt(), "")

    def test_compact_resets_so_it_fires_again(self):
        self.add(user(), assistant(610_000))
        self.note(self.prompt())
        self.add(BOUNDARY, user("summary"))
        self.assertEqual(self.prompt(), "", "right after the boundary there is no usage yet")
        self.add(assistant(40_000))
        self.assertEqual(self.prompt(), "")
        self.add(user(), assistant(615_000))
        self.assertIn("61% full", self.note(self.prompt()))

    # what counts as usage
    def test_sidechain_usage_is_ignored(self):
        self.add(user(), assistant(100_000), assistant(900_000, sidechain=True))
        self.assertEqual(self.prompt(), "")

    def test_text_mentioning_compact_boundary_is_not_a_boundary(self):
        self.add(user(), assistant(610_000), user('grep output: "subtype":"compact_boundary"'))
        self.note(self.prompt())

    def test_null_usage_fields_are_skipped(self):
        rec = assistant(610_000)
        newer = {"type": "assistant", "message": {"model": "<synthetic>", "usage": {"input_tokens": None}}}
        self.add(user(), rec, newer)
        self.note(self.prompt())

    def test_crlf_transcript(self):
        with open(self.transcript, "w", newline="") as f:
            f.write(json.dumps(user()) + "\r\n" + json.dumps(assistant(610_000)) + "\r\n")
        self.note(self.prompt())

    def test_scans_back_across_many_lines_fast(self):
        filler = json.dumps(user("x" * 5000)) + "\n"
        with open(self.transcript, "w") as f:
            f.write(json.dumps(assistant(610_000)) + "\n")
            f.write(filler * 4000)  # 20 MB the hook has to walk back across
        start = time.time()
        self.note(self.prompt())
        self.assertLess(time.time() - start, 3.0)

    def test_one_huge_line_stays_fast(self):
        with open(self.transcript, "w") as f:
            f.write(json.dumps(assistant(610_000)) + "\n")
            f.write(json.dumps(user("y" * 60_000_000)) + "\n")  # one 60 MB line
        start = time.time()
        self.note(self.prompt())
        self.assertLess(time.time() - start, 3.0)

    def test_tail_lines_matches_a_forward_read(self):
        sys.path.insert(0, HERE)
        import compact_hook
        lines = [b"a" * n for n in (0, 1, 5, 17, 3, 40, 0, 9)]
        with open(self.transcript, "wb") as f:
            f.write(b"\n".join(lines) + b"\n")
        for block in (1, 2, 3, 7, 64):
            with self.subTest(block=block):
                got = list(compact_hook.tail_lines(self.transcript, block=block))
                self.assertEqual(got, [l for l in reversed(lines) if l.strip()])

    # context window per model and settings
    def test_200k_models_use_the_lower_thresholds(self):
        for model in ("claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-sonnet-4-5", "claude-sonnet-4-20250514"):
            with self.subTest(model=model):
                self.records = []
                state = os.path.join(self.home, ".claude", "handoffs", ".state", SID + ".json")
                if os.path.exists(state):
                    os.remove(state)
                self.add(user(), assistant(110_000, model=model))
                text = self.note(self.prompt())
                self.assertIn("55% full", text)
                self.assertNotIn("last notice", text)
                self.add(user(), assistant(142_000, model=model))
                self.assertIn("last notice", self.note(self.prompt()))

    def test_1m_models(self):
        for model in ("claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-opus-4-7", "claude-opus-4-6[1m]"):
            with self.subTest(model=model):
                self.records = []
                self.add(user(), assistant(130_000, model=model))
                self.assertEqual(self.prompt(), "")

    def test_auto_compact_window_env_lowers_the_ceiling(self):
        self.add(user(), assistant(250_000))
        self.assertIn("62% full", self.note(self.prompt(env={"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "400000"})))

    def test_auto_compact_window_setting_lowers_the_ceiling(self):
        os.makedirs(os.path.join(self.home, ".claude"), exist_ok=True)
        with open(os.path.join(self.home, ".claude", "settings.json"), "w") as f:
            json.dump({"autoCompactWindow": 600000}, f)
        self.add(user(), assistant(370_000))
        self.assertIn("61% full", self.note(self.prompt()))

    def test_small_dip_does_not_rearm(self):
        self.add(user(), assistant(810_000))
        self.assertIn("last notice", self.note(self.prompt()))
        self.add(user(), assistant(795_000))
        self.assertEqual(self.prompt(), "")
        self.add(user(), assistant(805_000))
        self.assertEqual(self.prompt(), "", "a dip below 80% without a compact must not fire the notice again")

    def test_model_switch_dip_does_not_rearm(self):
        self.add(user(), assistant(770_000, model="claude-opus-5"))
        self.note(self.prompt())
        self.add(user(), assistant(599_000, model="claude-fable-5"))
        self.assertEqual(self.prompt(), "")
        self.add(user(), assistant(620_000, model="claude-fable-5"))
        self.assertEqual(self.prompt(), "")

    def test_non_ascii_prompt_with_a_windows_code_page(self):
        self.add(user(), assistant(610_000))
        for enc, text in (("cp1252", "hello, café ✓ naïve"), ("cp1255", "שלום, מה נשמע")):
            with self.subTest(enc=enc):
                state = os.path.join(self.home, ".claude", "handoffs", ".state", SID + ".json")
                if os.path.exists(state):
                    os.remove(state)
                self.note(self.prompt(text, env={"PYTHONIOENCODING": enc}))

    def test_usage_past_the_guessed_window_means_a_bigger_window(self):
        self.add(user(), assistant(300_000, model="claude-opus-4-6"))
        self.assertEqual(self.prompt(), "", "300K cannot be 150% of 200K; this session runs at 1M")

    def test_third_party_provider_runs_opus_at_200k(self):
        self.add(user(), assistant(110_000, model="claude-opus-4-8"))
        self.assertIn("55% full", self.note(self.prompt(env={"CLAUDE_CODE_USE_BEDROCK": "1"})))
        self.records = []
        self.add(user(), assistant(110_000, model="claude-sonnet-5"))
        os.remove(os.path.join(self.home, ".claude", "handoffs", ".state", SID + ".json"))
        self.assertEqual(self.prompt(env={"CLAUDE_CODE_USE_BEDROCK": "1"}), "", "Sonnet 5 keeps 1M everywhere")

    def test_max_context_tokens_applies_only_to_unknown_ids(self):
        self.add(user(), assistant(130_000))
        self.assertEqual(self.prompt(env={"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "200000"}), "")
        self.records = []
        self.add(user(), assistant(130_000, model="my-gateway-alias"))
        self.assertIn("65% full", self.note(self.prompt(env={"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "200000"})))

    def test_auto_compact_env_is_read_like_claude_code(self):
        self.add(user(), assistant(90_000))
        for value in ("500k", "50000"):
            with self.subTest(value=value):
                p = self.run_script(HOOK, args=("--check", self.transcript),
                                    env={"CLAUDE_CODE_AUTO_COMPACT_WINDOW": value})
                self.assertIn("window: 100,000", p.stdout)

    def test_disable_1m_env(self):
        self.add(user(), assistant(110_000))
        self.assertIn("55% full", self.note(self.prompt(env={"CLAUDE_CODE_DISABLE_1M_CONTEXT": "1"})))

    # prompts the hook stays out of
    def test_compact_and_clear_prompts_are_silent_and_keep_state(self):
        self.add(user(), assistant(610_000))
        self.assertEqual(self.prompt("/compact keep the reasons"), "")
        self.assertEqual(self.prompt("  /CLEAR"), "")
        self.note(self.prompt("next"))

    def test_similar_command_names_are_not_mistaken_for_compact(self):
        self.add(user(), assistant(610_000))
        self.note(self.prompt("/compacting-amazon-titles B0123"))

    def test_asking_for_the_skill_counts_as_handled(self):
        for ask in ("/smart-precompact handoff", "prep me for compact", "prepare for compact", "before I compact",
                    "תכין אותי לקומפאקט", "לפני הקומפאקט תשמור"):
            with self.subTest(ask=ask):
                self.records = []
                state = os.path.join(self.home, ".claude", "handoffs", ".state", SID + ".json")
                if os.path.exists(state):
                    os.remove(state)
                self.add(user(), assistant(610_000))
                self.assertEqual(self.prompt(ask), "")
                self.assertEqual(self.prompt("next"), "")

    # restore after compaction
    def test_restore_after_compact_injects_the_handoff_once(self):
        self.write_handoff()
        text = self.note(self.compacted(), event="SessionStart")
        self.assertIn("just compacted", text)
        self.assertIn("webhook", text)
        self.assertEqual(self.compacted(), "", "the same version of the file is restored only once")

    def test_restore_again_after_the_handoff_is_rewritten(self):
        path = self.write_handoff("v1")
        self.note(self.compacted(), event="SessionStart")
        os.utime(path, (time.time() + 5, time.time() + 5))
        self.assertIn("v1", self.note(self.compacted(), event="SessionStart"))

    def test_restore_strips_the_hidden_compact_line(self):
        self.write_handoff("Building: a landing page\n<!-- compact: Keep: why the GSAP from() approach failed -->")
        text = self.note(self.compacted(), event="SessionStart")
        self.assertIn("Building: a landing page", text)
        self.assertNotIn("<!-- compact:", text)

    def test_restore_only_on_compact(self):
        self.write_handoff()
        for source in ("startup", "resume", "clear"):
            with self.subTest(source=source):
                self.assertEqual(self.compacted(source), "")

    def test_restore_without_a_handoff_is_silent(self):
        self.assertEqual(self.compacted(), "")

    def test_restore_resets_thresholds(self):
        self.add(user(), assistant(610_000))
        self.note(self.prompt())
        self.compacted()
        self.note(self.prompt(), "UserPromptSubmit")

    # cleanup of stale handoff files
    def aged(self, name, days, folder="", text="# Handoff . /x . 2026-09-01 10:00\n\nx"):
        d = os.path.join(self.home, ".claude", "handoffs", folder)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        t = time.time() - days * 86400
        os.utime(path, (t, t))
        return path

    def test_only_handoffs_untouched_for_14_days_are_deleted(self):
        for event, run in (("prompt", self.prompt), ("compact", self.compacted)):
            with self.subTest(event=event):
                stale = self.aged("feedbeef.md", 15)
                recent = self.aged("cafe0001.md", 13)
                run()
                self.assertFalse(os.path.exists(stale), "untouched for 15 days: deleted")
                self.assertTrue(os.path.exists(recent), "touched 13 days ago: kept")

    def test_this_sessions_handoff_is_never_deleted(self):
        own = self.aged(SID[:8] + ".md", 30, text="# Handoff . /x . 2026-09-01 10:00\n\nown-session-v1")
        self.prompt()
        self.assertTrue(os.path.exists(own))
        self.assertIn("own-session-v1", self.note(self.compacted(), event="SessionStart"), "and it still restores")
        self.assertTrue(os.path.exists(own))

    def test_restore_does_not_delete_the_handoff(self):
        path = self.write_handoff("v1")
        self.note(self.compacted(), event="SessionStart")
        self.assertTrue(os.path.exists(path), "a later compact in the same session needs it again")
        self.compacted()
        self.assertTrue(os.path.exists(path))

    def test_cleanup_touches_only_md_files_directly_in_the_folder(self):
        kept = [self.aged("notes.txt", 30), self.aged("old.md", 30, folder="archive")]
        target = os.path.join(self.home, "outside.md")
        with open(target, "w") as f:
            f.write("# Handoff . /x . 2026-09-01 10:00\n\noutside the folder")
        link = os.path.join(self.home, ".claude", "handoffs", "link.md")
        try:
            os.symlink(target, link)
            os.utime(link, (time.time() - 30 * 86400,) * 2, follow_symlinks=False)
            kept += [link, target]
        except (OSError, NotImplementedError):
            pass  # no symlinks here (Windows without the privilege)
        self.prompt()
        for path in kept:
            self.assertTrue(os.path.lexists(path), path)

    def test_a_handoff_named_in_the_prompt_is_kept(self):
        # block 3 in a new session, after a two-week break: the file must survive until Claude reads it
        old = self.aged("aaaa1111.md", 15)
        self.prompt("Read ~/.claude/handoffs/aaaa1111.md and continue from there.")
        self.assertTrue(os.path.exists(old))

    def test_md_files_that_are_not_handoffs_are_kept(self):
        mine = self.aged("2026-09-01-auth-refactor.md", 30, text="# Auth refactor notes\n")
        empty = self.aged("empty.md", 30, text="")
        self.prompt()
        self.assertTrue(os.path.exists(mine), "only files that start with the skill's header are cleaned")
        self.assertTrue(os.path.exists(empty))

    def test_no_session_id_means_no_cleanup(self):
        stale = self.aged("feedbeef.md", 30)
        self.prompt(stdin=json.dumps({"transcript_path": self.transcript, "prompt": "x"}))
        self.assertTrue(os.path.exists(stale))

    # failure modes: never block, never print junk
    def test_bad_input_is_silent(self):
        for stdin in ("", "not json", "[]", json.dumps({"session_id": SID}),
                      json.dumps({"session_id": SID, "transcript_path": "/nope/missing.jsonl"}),
                      json.dumps({"session_id": SID, "transcript_path": self.transcript, "prompt": 5})):
            with self.subTest(stdin=stdin[:20]):
                self.assertEqual(self.prompt(stdin=stdin), "")

    def test_corrupt_lines_are_skipped(self):
        with open(self.transcript, "w") as f:
            f.write(json.dumps(assistant(610_000)) + "\n{broken json with \"usage\" \"assistant\"\n\n")
        self.note(self.prompt())

    def test_unwritable_state_dir_never_blocks(self):
        os.makedirs(os.path.join(self.home, ".claude"), exist_ok=True)
        with open(os.path.join(self.home, ".claude", "handoffs"), "w") as f:
            f.write("a file where the folder should be")
        self.add(user(), assistant(610_000))
        p = self.run_script(HOOK, stdin=json.dumps({"session_id": SID, "transcript_path": self.transcript,
                                                    "prompt": "next"}))
        self.assertEqual(p.returncode, 0)

    def test_cli_reports_its_errors(self):
        p = self.run_script(HOOK, args=("--check", "/nope/missing.jsonl"))
        self.assertEqual(p.returncode, 1)
        self.assertIn("No transcript", p.stdout)
        os.makedirs(os.path.join(self.home, ".claude"), exist_ok=True)
        with open(os.path.join(self.home, ".claude", "handoffs"), "w") as f:
            f.write("a file where the folder should be")
        p = self.run_script(HOOK, args=("--test",))
        self.assertEqual(p.returncode, 1)
        self.assertIn("Could not arm", p.stdout)

    def test_note_still_arrives_when_state_cannot_be_saved(self):
        os.makedirs(os.path.join(self.home, ".claude"), exist_ok=True)
        with open(os.path.join(self.home, ".claude", "handoffs"), "w") as f:
            f.write("a file where the folder should be")
        self.add(user(), assistant(610_000))
        self.note(self.prompt())

    def test_two_sessions_cannot_both_take_the_test_note(self):
        self.add(user(), assistant(150_000))
        stdin = json.dumps({"session_id": SID, "transcript_path": self.transcript, "prompt": "x"})
        for _ in range(6):
            self.run_script(HOOK, args=("--test",))
            procs = [subprocess.Popen([sys.executable, HOOK], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      text=True, env=self.env()) for _ in range(4)]
            for p in procs:  # feed every process first, so they really run at the same time
                p.stdin.write(stdin)
                p.stdin.close()
            outs = [p.stdout.read() for p in procs]
            for p in procs:
                p.wait()
            self.assertEqual(sum("Hook test" in o for o in outs), 1)

    # install check
    def test_test_flag_arms_one_confirmation(self):
        self.add(user(), assistant(150_000))
        self.assertIn("Armed", self.run_script(HOOK, args=("--test",)).stdout)
        text = self.note(self.prompt())
        self.assertIn("installed and working", text)
        self.assertIn("15% full", text)
        self.assertIn("1,000,000-token window", text)
        self.assertEqual(self.prompt(), "", "the test note fires once")


class InstallerTest(Base):
    def settings_path(self):
        return os.path.join(self.home, ".claude", "settings.json")

    def write_settings(self, data):
        os.makedirs(os.path.dirname(self.settings_path()), exist_ok=True)
        with open(self.settings_path(), "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def read_settings(self):
        with open(self.settings_path()) as f:
            return json.load(f)

    def ours(self, settings):
        found = []
        for event, groups in settings.get("hooks", {}).items():
            for g in groups:
                for h in g["hooks"]:
                    if "compact_hook.py" in " ".join([h.get("command", "")] + h.get("args", [])):
                        found.append((event, g.get("matcher")))
        return sorted(found, key=str)

    def install(self, *args):
        p = self.run_script(INSTALLER, args=args)
        return p

    def test_fresh_install_creates_both_entries(self):
        p = self.install()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        s = self.read_settings()
        self.assertEqual(self.ours(s), [("SessionStart", "compact"), ("UserPromptSubmit", None)])
        entry = s["hooks"]["UserPromptSubmit"][0]["hooks"][0]
        self.assertEqual(entry["args"][-1], HOOK)
        self.assertNotIn("python@", entry["command"], "a versioned interpreter path breaks after an upgrade")

    def test_keeps_other_settings_and_hooks(self):
        other = {"type": "command", "command": "echo other"}
        self.write_settings({"model": "opus", "hooks": {"UserPromptSubmit": [{"hooks": [other]}],
                                                        "PreToolUse": [{"matcher": "Bash", "hooks": [other]}]}})
        self.assertEqual(self.install().returncode, 0)
        s = self.read_settings()
        self.assertEqual(s["model"], "opus")
        self.assertEqual(s["hooks"]["PreToolUse"], [{"matcher": "Bash", "hooks": [other]}])
        self.assertIn({"hooks": [other]}, s["hooks"]["UserPromptSubmit"])
        self.assertEqual(len(self.ours(s)), 2)

    def test_reinstall_does_not_duplicate(self):
        self.install()
        self.install()
        self.assertEqual(len(self.ours(self.read_settings())), 2)

    def test_replaces_the_older_script_name(self):
        old = {"type": "command", "command": 'python3 "$HOME/.claude/skills/smart-precompact/scripts/context_threshold.py"'}
        self.write_settings({"hooks": {"UserPromptSubmit": [{"hooks": [old]}]}})
        self.assertIn("Updated", self.install().stdout)
        s = self.read_settings()
        self.assertNotIn("context_threshold.py", json.dumps(s))
        self.assertEqual(len(self.ours(s)), 2)

    def test_uninstall_removes_only_ours(self):
        other = {"type": "command", "command": "echo other"}
        self.write_settings({"hooks": {"UserPromptSubmit": [{"hooks": [other]}]}})
        self.install()
        p = self.install("--uninstall")
        self.assertEqual(p.returncode, 0)
        s = self.read_settings()
        self.assertEqual(s["hooks"], {"UserPromptSubmit": [{"hooks": [other]}]})

    def test_uninstall_when_absent_changes_nothing(self):
        self.write_settings({"model": "opus"})
        before = os.path.getmtime(self.settings_path())
        self.assertIn("Nothing to remove", self.install("--uninstall").stdout)
        self.assertEqual(os.path.getmtime(self.settings_path()), before)

    def test_invalid_json_is_left_untouched(self):
        self.write_settings('{"hooks": {broken')
        p = self.install()
        self.assertEqual(p.returncode, 1)
        with open(self.settings_path()) as f:
            self.assertEqual(f.read(), '{"hooks": {broken')

    def test_backup_is_written(self):
        self.write_settings({"model": "opus"})
        self.install()
        backups = [n for n in os.listdir(os.path.join(self.home, ".claude")) if n.startswith("settings.json.bak-")]
        self.assertEqual(len(backups), 1)

    def test_installed_entry_actually_runs_the_hook(self):
        self.install()
        entry = self.read_settings()["hooks"]["UserPromptSubmit"][0]["hooks"][0]
        p = subprocess.run([entry["command"], *entry["args"], "--test"], capture_output=True, text=True,
                           env=self.env(), timeout=30)
        self.assertIn("Armed", p.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
