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
    "prompts/moments_analyzer.md",
    "prompts/date_planner.md",
    "references/evidence_frameworks.md",
    "platforms/codex.md",
    "platforms/chatgpt-instructions.md",
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
    ]
    missing_terms = [term for term in required_terms if term not in text]
    if missing_terms:
        return fail(f"SKILL.md missing expected terms: {missing_terms}")

    if "zhunshi" in text:
        return fail("SKILL.md contains misspelled command 'zhunshi'; use 'junshi'")

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


def main():
    checks = [
        check_required_files(),
        check_skill_md(),
        check_openai_yaml(),
    ]
    if not all(checks):
        sys.exit(1)
    print("[OK] Project sanity checks passed")


if __name__ == "__main__":
    main()
