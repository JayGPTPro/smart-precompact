#!/usr/bin/env python3
"""Adds or removes the Smart PreCompact hook in ~/.claude/settings.json.

  python3 install_hook.py               install, or update an older install
  python3 install_hook.py --uninstall   remove only this hook's entries

Keeps every other setting and hook as it is, saves a timestamped backup first,
and refuses to touch a settings file that is not valid JSON. The hook runs with
a command that survives Python upgrades (python3 on macOS and Linux, the py
launcher on Windows), in exec form with no shell, so paths with spaces are safe.
"""
import json, os, shutil, sys, time

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compact_hook.py")
SETTINGS = os.path.join(os.path.expanduser("~"), ".claude", "settings.json")
MARKERS = ("compact_hook.py", "context_threshold.py")  # this hook's current and earlier script names


def python_command():
    """A stable way to start Python 3: not sys.executable, whose versioned path
    (for example .../python@3.14/...) can disappear after an upgrade."""
    if os.name == "nt":
        return ("py", ["-3"]) if shutil.which("py") else (sys.executable, [])
    return ("python3", []) if shutil.which("python3") else (sys.executable, [])


def hook_entry():
    command, pre = python_command()
    return {"type": "command", "command": command, "args": pre + [HOOK], "timeout": 10}


def is_ours(hook):
    text = " ".join([str(hook.get("command", ""))] + [str(a) for a in hook.get("args") or []])
    return any(m in text for m in MARKERS)


def remove_ours(hooks):
    """Drop this hook's entries from every event; drop groups and events left empty."""
    removed = 0
    for event in list(hooks):
        groups = hooks[event] if isinstance(hooks[event], list) else []
        kept_groups = []
        for group in groups:
            inner = group.get("hooks") if isinstance(group, dict) else None
            if not isinstance(inner, list):
                kept_groups.append(group)
                continue
            kept = [h for h in inner if not (isinstance(h, dict) and is_ours(h))]
            removed += len(inner) - len(kept)
            if kept:
                group["hooks"] = kept
                kept_groups.append(group)
        if kept_groups:
            hooks[event] = kept_groups
        else:
            del hooks[event]
    return removed


def load_settings():
    if not os.path.exists(SETTINGS):
        return {}
    with open(SETTINGS, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("the top level is not a JSON object")
    return data


def write_settings(data):
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    if os.path.exists(SETTINGS):
        backup = "%s.bak-%s" % (SETTINGS, time.strftime("%Y%m%d-%H%M%S"))
        shutil.copy2(SETTINGS, backup)
        print("Backup: %s" % backup)
    tmp = SETTINGS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(tmp, encoding="utf-8") as f:
        json.load(f)  # never replace the real file with something that does not parse
    os.replace(tmp, SETTINGS)


def main(argv):
    uninstall = "--uninstall" in argv[1:]
    if sys.version_info < (3, 8):
        print("Python 3.8 or newer is needed; this is %s." % sys.version.split()[0])
        return 1
    try:
        data = load_settings()
    except (OSError, ValueError) as err:
        print("Did not change anything: %s is not valid JSON (%s). Fix it first." % (SETTINGS, err))
        return 1
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict):
        print("Did not change anything: \"hooks\" in %s is not an object." % SETTINGS)
        return 1

    removed = remove_ours(hooks)
    if uninstall:
        if not removed:
            print("Nothing to remove: the Smart PreCompact hook is not in %s." % SETTINGS)
            return 0
        if hooks:
            data["hooks"] = hooks
        else:
            data.pop("hooks", None)
        write_settings(data)
        print("Removed the Smart PreCompact hook (%d entries). Other hooks were left as they were." % removed)
        return 0

    if not os.path.isfile(HOOK):
        print("Did not change anything: %s is missing. Reinstall the skill folder." % HOOK)
        return 1
    hooks.setdefault("UserPromptSubmit", []).append({"hooks": [hook_entry()]})
    hooks.setdefault("SessionStart", []).append({"matcher": "compact", "hooks": [hook_entry()]})
    data["hooks"] = hooks
    write_settings(data)
    print("%s the Smart PreCompact hook in %s." % ("Updated" if removed else "Installed", SETTINGS))
    command, pre = python_command()
    print("Check it: %s \"%s\" --test, then send any message in a new Claude Code session."
          % (" ".join([command] + pre), HOOK))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
