#!/usr/bin/env python3
"""
Lightweight project sanity checks for dianzi-junshi.
Uses only the Python standard library.
"""

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = [
    "SKILL.md",
    "agents/openai.yaml",
    "prompts/folder_importer.md",
    "prompts/message_analyzer.md",
    "prompts/interest_detector.md",
    "prompts/reply_generator.md",
    "prompts/human_voice.md",
    "prompts/moments_analyzer.md",
    "prompts/date_planner.md",
    "references/evidence_frameworks.md",
    "references/pursuit_playbooks.md",
    "references/player_tactics_intel.md",
    "references/sticker_pack_guide.md",
    "platforms/codex.md",
]

MACHINE_TONE_BANNED = [
    "AI 小作文",
    "不像 AI",
    "作为一个",
    "总的来说",
    "综上所述",
    "需要注意的是",
    "值得注意的是",
    "在这个场景下，我们可以看出",
    "希望这些建议",
]


def fail(message):
    print(f"[FAIL] {message}")
    return False


def parse_frontmatter(text):
    match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        return None
    data = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"')
    return data


def check_skill_md():
    skill_path = ROOT / "SKILL.md"
    text = skill_path.read_text(encoding="utf-8")
    frontmatter = parse_frontmatter(text)
    if frontmatter is None:
        return fail("SKILL.md missing YAML frontmatter")

    unexpected = set(frontmatter) - {"name", "description"}
    if unexpected:
        return fail(f"Unexpected SKILL.md frontmatter keys: {sorted(unexpected)}")

    name = frontmatter.get("name", "")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        return fail(f"Skill name must be hyphen-case ASCII: {name!r}")

    description = frontmatter.get("description", "")
    if not description or len(description) > 1024:
        return fail("Skill description missing or too long")

    required_terms = [
        "/junshi",
        "/interest",
        "/anti-simp",
        "/moments",
        "/import-folder",
        "/date-plan",
        "油腻度",
        "会撩",
        "策略方框",
        "回复间隔",
        "海王/海后置信度",
        "追法类型",
        "拉扯强度",
        "近期海王/海后套路",
        "机器腔",
        "表情包",
    ]
    missing_terms = [term for term in required_terms if term not in text]
    if missing_terms:
        return fail(f"SKILL.md missing expected terms: {missing_terms}")

    misspelled_command = "z" + "hunshi"
    if misspelled_command in text:
        return fail("SKILL.md contains a misspelled command; use 'junshi'")

    print("[OK] SKILL.md")
    return True


def check_required_files():
    ok = True
    for rel_path in REQUIRED_FILES:
        path = ROOT / rel_path
        if not path.exists():
            ok = fail(f"Missing required file: {rel_path}") and ok
    if ok:
        print("[OK] Required files")
    return ok


def check_openai_yaml():
    path = ROOT / "agents" / "openai.yaml"
    text = path.read_text(encoding="utf-8")
    for term in ("display_name", "short_description", "$dianzi-junshi"):
        if term not in text:
            return fail(f"agents/openai.yaml missing {term}")
    print("[OK] agents/openai.yaml")
    return True


def check_machine_tone():
    targets = [
        "README.md",
        "README_EN.md",
        "SKILL.md",
        "prompts/reply_generator.md",
        "prompts/style_calibrator.md",
    ]
    problems = []
    for rel_path in targets:
        text = (ROOT / rel_path).read_text(encoding="utf-8")
        for phrase in MACHINE_TONE_BANNED:
            if phrase in text:
                problems.append(f"{rel_path}: {phrase}")

    if problems:
        return fail("Machine-tone phrases found: " + "; ".join(problems))

    print("[OK] Machine-tone scan")
    return True


def contains_raw_visual_symbol(char):
    codepoint = ord(char)
    if char in "●○":
        return False
    return (0x1F000 <= codepoint <= 0x1FAFF) or (0x2600 <= codepoint <= 0x27BF)


def check_no_raw_visual_symbols():
    targets = [
        "README.md",
        "README_EN.md",
        "SKILL.md",
        "prompts",
        "platforms",
        "references",
        "tools",
    ]
    problems = []
    for rel_path in targets:
        path = ROOT / rel_path
        files = [path] if path.is_file() else [p for p in path.rglob("*") if p.is_file()]
        for file_path in files:
            try:
                text = file_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for line_no, line in enumerate(text.splitlines(), 1):
                if any(contains_raw_visual_symbol(ch) for ch in line):
                    problems.append(f"{file_path.relative_to(ROOT)}:{line_no}")

    if problems:
        return fail("Raw visual symbols found; use text labels or sticker-pack type notes: " + "; ".join(problems[:20]))

    print("[OK] Raw visual symbol scan")
    return True


def main():
    checks = [
        check_required_files(),
        check_skill_md(),
        check_openai_yaml(),
        check_machine_tone(),
        check_no_raw_visual_symbols(),
    ]
    if not all(checks):
        sys.exit(1)
    print("[OK] Project sanity checks passed")


if __name__ == "__main__":
    main()
