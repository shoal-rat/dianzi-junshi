#!/usr/bin/env python3
"""
Build a single Markdown knowledge pack for ChatGPT / GPT Builder.
Uses only the Python standard library.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "dist"
OUT_FILE = OUT_DIR / "dianzi-junshi-chatgpt-pack.md"

FILES = [
    "SKILL.md",
    "prompts/folder_importer.md",
    "prompts/message_analyzer.md",
    "prompts/interest_detector.md",
    "prompts/reply_generator.md",
    "prompts/human_voice.md",
    "prompts/oil_control.md",
    "prompts/advisor_mode.md",
    "prompts/moments_analyzer.md",
    "prompts/date_planner.md",
    "prompts/memory_engine.md",
    "references/evidence_frameworks.md",
    "references/sticker_pack_guide.md",
    "platforms/chatgpt-instructions.md",
]


def main():
    OUT_DIR.mkdir(exist_ok=True)
    parts = [
        "# 电子军师 ChatGPT Knowledge Pack",
        "",
        "This file is generated from the repository source files.",
        "Upload it to a Custom GPT knowledge section when you want a single-file setup.",
        "",
    ]

    for rel_path in FILES:
        path = ROOT / rel_path
        if not path.exists():
            raise FileNotFoundError(f"Missing required file: {rel_path}")
        parts.extend([
            "",
            "---",
            "",
            f"## Source: `{rel_path}`",
            "",
            path.read_text(encoding="utf-8").strip(),
            "",
        ])

    OUT_FILE.write_text("\n".join(parts), encoding="utf-8")
    print(f"Built {OUT_FILE}")


if __name__ == "__main__":
    main()
