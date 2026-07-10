#!/usr/bin/env python3
"""
dianzi-junshi v2 结构检查。

只做结构校验，不耦合具体措辞：
  1. SKILL.md 存在，frontmatter 有 name: dianzi-junshi，description 短于 1024 字符
  2. v2 必需的 references/ 与 tools/ 文件齐全
  3. 旧的 prompts/ 目录已删除（还在 = 迁移未完成，直接失败）
  4. SKILL.md 与 references/*.md 不含 emoji 字符
  5. SKILL.md 里提到的 references/*.md 都真实存在
  6. 超过 100 行的 references/*.md 在前 15 行内给出目录（TOC）

用法：python3 tools/skill_check.py
退出码：0 = 全部通过，1 = 有失败项
"""

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    "SKILL.md",
    "references/voice.md",
    "references/memes.md",
    "references/glossary.md",
    "references/reading.md",
    "references/strategy.md",
    "references/partner.md",
    "references/memory.md",
    "references/dating.md",
    "tools/voice_lint.py",
    "tools/wechat_parser.py",
    "tools/import_folder.py",
    "tools/session_log.py",
    "tools/profile_manager.py",
    "tools/memory_updater.py",
]

SKILL_NAME = "dianzi-junshi"
DESCRIPTION_MAX = 1024      # description 必须短于该值
TOC_SCAN_LINES = 15         # 目录必须出现在前多少行内
TOC_REQUIRED_OVER = 100     # 超过多少行的 references 文件才要求目录
REFS_MENTION_RE = re.compile(r"references/[A-Za-z0-9_\-./]+\.md")
TOC_ANCHOR_RE = re.compile(r"^\s*[-*+]\s*\[[^\]]+\]\(#")   # - [xx](#yy) 式内部锚点


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
    """SKILL.md 存在 + frontmatter 结构合规。"""
    path = ROOT / "SKILL.md"
    if not path.exists():
        return fail("SKILL.md 不存在")

    text = path.read_text(encoding="utf-8")
    frontmatter = parse_frontmatter(text)
    if frontmatter is None:
        return fail("SKILL.md 缺少 YAML frontmatter")

    name = frontmatter.get("name", "")
    if name != SKILL_NAME:
        return fail(f"SKILL.md frontmatter name 应为 {SKILL_NAME!r}，实际是 {name!r}")

    description = frontmatter.get("description", "")
    if not description:
        return fail("SKILL.md frontmatter 缺少 description")
    if len(description) >= DESCRIPTION_MAX:
        return fail(f"SKILL.md description 过长：{len(description)} 字符（须短于 {DESCRIPTION_MAX}）")

    print("[OK] SKILL.md frontmatter")
    return True


def check_required_files():
    """v2 必需文件齐全。"""
    ok = True
    for rel_path in REQUIRED_FILES:
        if not (ROOT / rel_path).exists():
            ok = fail(f"缺少必需文件：{rel_path}") and ok
    if ok:
        print("[OK] 必需文件齐全")
    return ok


def check_no_prompts_dir():
    """v1 的 prompts/ 目录必须已删除。"""
    if (ROOT / "prompts").exists():
        return fail("prompts/ 目录仍然存在：v1 -> v2 迁移未完成，内容应并入 SKILL.md / references/")
    print("[OK] 无残留 prompts/ 目录")
    return True


def contains_raw_visual_symbol(char):
    codepoint = ord(char)
    if char in "●○":
        return False
    return (0x1F000 <= codepoint <= 0x1FAFF) or (0x2600 <= codepoint <= 0x27BF)


def _emoji_scan_targets():
    targets = []
    skill_md = ROOT / "SKILL.md"
    if skill_md.exists():
        targets.append(skill_md)
    refs_dir = ROOT / "references"
    if refs_dir.is_dir():
        targets.extend(sorted(refs_dir.glob("*.md")))
    return targets


def check_no_emoji():
    """SKILL.md 与 references/*.md 不得包含 emoji。"""
    problems = []
    for file_path in _emoji_scan_targets():
        try:
            text = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            if any(contains_raw_visual_symbol(ch) for ch in line):
                problems.append(f"{file_path.relative_to(ROOT)}:{line_no}")

    if problems:
        return fail("发现 emoji 字符（应改用文字标签）：" + "; ".join(problems[:20]))

    print("[OK] emoji 扫描")
    return True


def check_skill_reference_mentions():
    """SKILL.md 里提到的 references/*.md 必须在磁盘上存在。"""
    path = ROOT / "SKILL.md"
    if not path.exists():
        return fail("SKILL.md 不存在，无法核对 references 引用")

    text = path.read_text(encoding="utf-8")
    mentioned = sorted(set(REFS_MENTION_RE.findall(text)))
    missing = [rel for rel in mentioned if not (ROOT / rel).exists()]
    if missing:
        return fail("SKILL.md 引用了不存在的文件：" + ", ".join(missing))

    print(f"[OK] SKILL.md 引用的 references 文件（共 {len(mentioned)} 个）都存在")
    return True


def _has_toc(lines):
    """前 TOC_SCAN_LINES 行内出现「目录」或内部锚点列表即视为有 TOC。"""
    for line in lines[:TOC_SCAN_LINES]:
        if "目录" in line or TOC_ANCHOR_RE.match(line):
            return True
    return False


def check_reference_tocs():
    """超过 100 行的 references/*.md 必须以目录开头。"""
    refs_dir = ROOT / "references"
    if not refs_dir.is_dir():
        print("[OK] references 目录尚不存在，跳过 TOC 检查")
        return True

    problems = []
    for file_path in sorted(refs_dir.glob("*.md")):
        lines = file_path.read_text(encoding="utf-8").splitlines()
        if len(lines) > TOC_REQUIRED_OVER and not _has_toc(lines):
            problems.append(f"{file_path.relative_to(ROOT)}（{len(lines)} 行）")

    if problems:
        return fail(
            f"以下 references 文件超过 {TOC_REQUIRED_OVER} 行但前 {TOC_SCAN_LINES} 行内没有目录："
            + "; ".join(problems)
        )

    print("[OK] references 长文件均有目录")
    return True


def main():
    checks = [
        check_skill_md(),
        check_required_files(),
        check_no_prompts_dir(),
        check_no_emoji(),
        check_skill_reference_mentions(),
        check_reference_tocs(),
    ]
    failed = checks.count(False)
    if failed:
        print(f"\n结果：{failed}/{len(checks)} 项检查未通过")
        sys.exit(1)
    print(f"\n结果：{len(checks)} 项结构检查全部通过")


if __name__ == "__main__":
    main()
