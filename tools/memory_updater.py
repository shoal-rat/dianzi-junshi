#!/usr/bin/env python3
"""
Memory updater for 电子军师.

Reads and manages the learning memory layer in partner profile files.
The memory layer is what lets the strategist pick up where it left off
in any new Claude Code window.

Usage:
  python tools/memory_updater.py show [slug]
  python tools/memory_updater.py stats [slug]
  python tools/memory_updater.py export [slug]
  python tools/memory_updater.py list
"""

import json
import re
import sys
from pathlib import Path
from datetime import datetime

PARTNERS_DIR = Path(__file__).parent.parent / "partners"


def list_partners():
    """List all partner profiles with memory stats."""
    if not PARTNERS_DIR.exists():
        print("No partners directory found.")
        return

    partners = [d for d in PARTNERS_DIR.iterdir() if d.is_dir()]
    if not partners:
        print("No partner profiles found.")
        return

    print(f"\n{'代号':<15} {'阶段':<12} {'有效策略':<10} {'无效模式':<10} {'上次更新'}")
    print("─" * 65)

    for p in sorted(partners):
        meta_file = p / "meta.json"
        profile_file = p / "profile.md"

        name = p.name
        stage = "?"
        updated = "?"
        effective = 0
        ineffective = 0

        if meta_file.exists():
            with open(meta_file, encoding="utf-8") as f:
                meta = json.load(f)
            name = meta.get("name", p.name)
            stage = meta.get("stage_name", meta.get("stage", "?"))
            updated = meta.get("updated_at", "?")[:10] if meta.get("updated_at") else "?"

        if profile_file.exists():
            content = profile_file.read_text(encoding="utf-8")
            effective = _count_memory_rows(content, "有效的策略")
            ineffective = _count_memory_rows(content, "无效的模式")

        print(f"{name:<15} {str(stage):<12} {effective:<10} {ineffective:<10} {updated}")

    print()


def _count_memory_rows(content: str, section_name: str) -> int:
    """Count data rows in a memory table section."""
    pattern = rf"### 对.+{re.escape(section_name)}\n\n\|.+\n\|[-| ]+\n((?:\|.+\n)*)"
    match = re.search(pattern, content)
    if not match:
        return 0
    rows = [r for r in match.group(1).strip().split("\n") if "暂无记录" not in r and r.strip()]
    return len(rows)


def show_memory(slug: str):
    """Display the full memory layer for a partner."""
    profile_path = PARTNERS_DIR / slug / "profile.md"
    meta_path = PARTNERS_DIR / slug / "meta.json"

    if not profile_path.exists():
        print(f"Profile not found: {profile_path}")
        return

    content = profile_path.read_text(encoding="utf-8")

    name = slug
    stage_info = ""
    if meta_path.exists():
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        name = meta.get("name", slug)
        stage = meta.get("stage", "?")
        stage_name = meta.get("stage_name", "")
        stage_info = f"阶段 {stage}（{stage_name}）"

    print(f"\n{'━' * 50}")
    print(f"{name} 的学习记忆档案")
    if stage_info:
        print(f"   {stage_info}")
    print(f"{'━' * 50}\n")

    # Extract and print memory sections
    sections = [
        ("有效的策略", "有效策略"),
        ("无效的模式", "无效模式"),
        ("真实模式修正", "真实模式修正"),
        ("关系进展日志", "关系进展日志"),
    ]

    for section_key, section_label in sections:
        section_content = _extract_section(content, section_key)
        if section_content:
            print(f"{section_label}\n")
            print(section_content)
            print()

    # User preference memory
    user_pref = _extract_section(content, "用户偏好记忆")
    if user_pref:
        print("用户偏好记忆\n")
        print(user_pref)
        print()

    print(f"{'━' * 50}")
    print("使用 /memory delete [N] 删除某条错误记忆")
    print(f"{'━' * 50}\n")


def _extract_section(content: str, section_name: str) -> str:
    """Extract a section from markdown content."""
    pattern = rf"### {re.escape(section_name)}\n(.*?)(?=\n### |\n## |$)"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Try ## heading
    pattern2 = rf"## {re.escape(section_name)}\n(.*?)(?=\n## |$)"
    match2 = re.search(pattern2, content, re.DOTALL)
    if match2:
        return match2.group(1).strip()

    return ""


def export_memory(slug: str):
    """Export memory as a structured summary for sharing or backup."""
    profile_path = PARTNERS_DIR / slug / "profile.md"
    meta_path = PARTNERS_DIR / slug / "meta.json"

    if not profile_path.exists():
        print(f"Profile not found: {profile_path}")
        return

    content = profile_path.read_text(encoding="utf-8")

    meta = {}
    if meta_path.exists():
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)

    # Extract high-confidence memories
    effective_raw = _extract_section(content, "有效的策略")
    ineffective_raw = _extract_section(content, "无效的模式")
    corrections_raw = _extract_section(content, "真实模式修正")

    high_confidence = []
    medium_confidence = []

    for line in effective_raw.split("\n"):
        if "●●●" in line and "暂无记录" not in line and line.startswith("|"):
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) >= 3:
                high_confidence.append(f"[有效] {cells[0]}: {cells[1]} → {cells[2]}")
        elif "●●○" in line and "暂无记录" not in line and line.startswith("|"):
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) >= 3:
                medium_confidence.append(f"[有效] {cells[0]}: {cells[1]}")

    for line in ineffective_raw.split("\n"):
        if "●●●" in line and "暂无记录" not in line and line.startswith("|"):
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) >= 3:
                high_confidence.append(f"[无效] {cells[0]}: 避免 {cells[1]}")

    export = {
        "name": meta.get("name", slug),
        "slug": slug,
        "stage": meta.get("stage", "?"),
        "stage_name": meta.get("stage_name", ""),
        "exported_at": datetime.now().isoformat()[:10],
        "high_confidence_rules": high_confidence,
        "medium_confidence_hints": medium_confidence,
        "corrections_count": meta.get("corrections_count", 0),
        "sessions_count": meta.get("sessions_count", 0),
    }

    output_path = PARTNERS_DIR / slug / "memory_export.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)

    print(f"\n记忆摘要已导出到：{output_path}")
    print(f"\n高置信度规则（●●●）：{len(high_confidence)} 条")
    for rule in high_confidence:
        print(f"  · {rule}")
    print(f"\n中置信度提示（●●○）：{len(medium_confidence)} 条")


def stats_summary(slug: str):
    """Show memory statistics for a partner."""
    profile_path = PARTNERS_DIR / slug / "profile.md"
    meta_path = PARTNERS_DIR / slug / "meta.json"

    if not profile_path.exists():
        print(f"Profile not found: {profile_path}")
        return

    content = profile_path.read_text(encoding="utf-8")

    meta = {}
    if meta_path.exists():
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)

    name = meta.get("name", slug)

    # Count by confidence level
    def count_by_confidence(section_text):
        counts = {"●●●": 0, "●●○": 0, "●○○": 0}
        for line in section_text.split("\n"):
            if line.startswith("|") and "暂无记录" not in line:
                for level in counts:
                    if level in line:
                        counts[level] += 1
        return counts

    effective_raw = _extract_section(content, "有效的策略")
    ineffective_raw = _extract_section(content, "无效的模式")
    corrections_raw = _extract_section(content, "真实模式修正")

    eff_counts = count_by_confidence(effective_raw)
    ineff_counts = count_by_confidence(ineffective_raw)
    corr_count = len([l for l in corrections_raw.split("\n")
                      if l.startswith("|") and "暂无记录" not in l])

    print(f"\n{name} 记忆统计\n")
    print(f"  有效策略：{sum(eff_counts.values())} 条")
    print(f"    ●●● 强规则：{eff_counts['●●●']} 条")
    print(f"    ●●○ 强参考：{eff_counts['●●○']} 条")
    print(f"    ●○○ 弱参考：{eff_counts['●○○']} 条")
    print()
    print(f"  无效模式：{sum(ineff_counts.values())} 条")
    print(f"    ●●● 强规则：{ineff_counts['●●●']} 条")
    print()
    print(f"  真实模式修正：{corr_count} 条")
    print(f"  用户纠正次数：{meta.get('corrections_count', 0)}")
    print(f"  总对话次数：{meta.get('sessions_count', 0)}")
    print()

    if sum(eff_counts.values()) == 0 and sum(ineff_counts.values()) == 0:
        print("  提示：记忆层尚为空白。使用 /upload-followup 上传聊天记录，或告知军师效果，开始积累记忆。")
    elif eff_counts["●●●"] > 0:
        print(f"  已有 {eff_counts['●●●']} 条强规则，军师现在对 {name} 的了解较准确。")
    else:
        print(f"  提示：记忆在积累中。再确认几次效果，即可形成强规则（●●●）。")
    print()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    action = sys.argv[1]

    if action == "list":
        list_partners()

    elif action == "show":
        slug = sys.argv[2] if len(sys.argv) > 2 else _pick_partner()
        if slug:
            show_memory(slug)

    elif action == "stats":
        slug = sys.argv[2] if len(sys.argv) > 2 else _pick_partner()
        if slug:
            stats_summary(slug)

    elif action == "export":
        slug = sys.argv[2] if len(sys.argv) > 2 else _pick_partner()
        if slug:
            export_memory(slug)

    else:
        print(f"Unknown action: {action}")
        print(__doc__)


def _pick_partner() -> str | None:
    """Interactively pick a partner if multiple exist."""
    if not PARTNERS_DIR.exists():
        print("No partners directory.")
        return None

    partners = [d.name for d in PARTNERS_DIR.iterdir() if d.is_dir()]
    if not partners:
        print("No partner profiles found.")
        return None
    if len(partners) == 1:
        return partners[0]

    print("选择档案：")
    for i, p in enumerate(partners):
        print(f"  [{i+1}] {p}")
    choice = input("输入编号：").strip()
    try:
        return partners[int(choice) - 1]
    except (ValueError, IndexError):
        print("无效选择")
        return None


if __name__ == "__main__":
    main()
