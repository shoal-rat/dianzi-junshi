#!/usr/bin/env python3
"""
候选回复「人味」检查器（voice lint）for 电子军师。

voice-gate 循环在把可复制回复交付用户之前，必须先把每条候选回复
喂进这里做确定性检查：书面腔、长辈腔、说教、过气热梗、句尾句号、
气泡过长等。只用 Python 标准库。

用法：
  python3 tools/voice_lint.py --text "第一条气泡\n第二条气泡"
  echo "气泡内容" | python3 tools/voice_lint.py
  每行 = 一个微信气泡。退出码：0 = PASS，1 = FAIL。
  --strict 时 WARN 也算不通过；--json 输出机器可读结果。
"""

import argparse
import json
import re
import sys

# ---------------------------------------------------------------------------
# 词表常量：与 references/glossary.md 的「过气」清单保持同步（改词表两边一起改）
# ---------------------------------------------------------------------------

# 书面/公文连接词：出现即机器腔（硬失败）
FORMAL_CONNECTIVES = (
    '然而', '因此', '综上', '首先', '其次', '再者', '与此同时',
    '总而言之', '众所周知', '不仅如此', '由此可见', '换言之', '与其说',
)

# 长辈腔/查户口/爹味禁用语（硬失败）
ELDER_PHRASES = (
    '呵呵', '在吗', '多喝热水', '喝口水', '早点休息', '早点睡', '注意身体',
    '保重', '记你一功', '表现不错', '吃了吗', '亲爱的', '小仙女', '妹妹你',
    '我都是为你好', '听我一句劝', '你还年轻',
)

# 说教句式（含「讲道理，」的全角/半角逗号变体）（硬失败）
LECTURE_PATTERNS = (
    '你应该', '建议你', '记得要', '别忘了', '要注意', '我跟你说',
    '说句实话', '讲道理，', '讲道理,',
)

# 过气热梗：出现即硬失败
DATED_MEMES = (
    '泰裤辣', '尊嘟假嘟', '栓Q', '芭比Q', '我不李姐', '退退退', '老六',
    '绝绝子', 'YYDS', 'yyds', '无语子', '咱就是说', '奥利给', '集美',
    '爷青回', '夺笋', '干饭人', '凡尔赛体', '网抑云', '蓝瘦香菇',
    '洪荒之力', '皮皮虾我们走', '扎心了老铁', '老铁666', 'skr',
    '疯狂打call', '神马都是', '有木有', '酱紫', '伤不起', '雪糕刺客',
    '命运的齿轮', '遥遥领先', 'xswl', 'u1s1', 'dbq', 'zqsg', '挖呀挖',
    '摁在地上摩擦', '么么哒', '萌萌哒', '加油鸭', '冲鸭', '奥力给',
)

# 半陈旧热梗：慎用/已陈旧（默认 WARN，--strict 时算不通过）
STALE_MEMES = (
    '哈基米', 'city不city', '泼天的富贵', '硬控', '显眼包', '草台班子',
    '猫meme', '破防了', '栓',
)

URL_RE = re.compile(r'(?:https?://|www\.)\S+')
YO_START_RE = re.compile(r'^哟([，,\s]|$)')       # 开头单独一个哟
ASCII_TERM_RE = re.compile(r'^[A-Za-z0-9]+$')

FAIL_LEN = 36   # 单气泡硬上限（去 URL 后按字符计，中文一字一算）
WARN_LEN = 22   # 超过就偏长


def visible_len(bubble):
    """计算气泡长度：URL 豁免，其余按字符计数。"""
    return len(URL_RE.sub('', bubble).strip())


def is_emoji(char):
    """emoji 判定，与 skill_check 的扫描区间保持一致。"""
    cp = ord(char)
    return (0x1F000 <= cp <= 0x1FAFF) or (0x2600 <= cp <= 0x27BF) or cp in (0x2B50, 0x2B55)


def count_emoji(text):
    return sum(1 for ch in text if is_emoji(ch))


def find_term(bubble, term):
    """返回 term 在气泡中的实际匹配文本，没有则返回 None。

    纯 ASCII 词（yyds/skr/u1s1 等）按整词、忽略大小写匹配，防止误伤
    普通英文单词；含中文的词直接子串匹配（ASCII 部分忽略大小写，如 栓Q/栓q）。
    """
    if ASCII_TERM_RE.match(term):
        pattern = r'(?<![A-Za-z0-9])' + re.escape(term) + r'(?![A-Za-z0-9])'
        m = re.search(pattern, bubble, re.IGNORECASE)
    else:
        m = re.search(re.escape(term), bubble, re.IGNORECASE)
    return m.group(0) if m else None


def run_checks(bubbles):
    """跑完所有检查，返回 findings 列表（dict：level/check/bubble/text/hint）。"""
    findings = []

    def add(level, check, bubble_no, text, hint):
        findings.append({
            'level': level, 'check': check, 'bubble': bubble_no,
            'text': text, 'hint': hint,
        })

    for no, bubble in enumerate(bubbles, 1):
        # FAIL 1：句尾句号
        if bubble.rstrip().endswith('。'):
            add('FAIL', 'period-end', no, bubble[-10:], '句尾句号=冷漠/生气信号 删掉')
        # FAIL 2：书面连接词
        for term in FORMAL_CONNECTIVES:
            if term in bubble:
                add('FAIL', 'formal-connective', no, term, '书面连接词是公文腔/机器腔，口语化改写或直接删')
        # FAIL 3：长辈腔禁用语
        for term in ELDER_PHRASES:
            if term in bubble:
                add('FAIL', 'elder-phrase', no, term, '长辈腔/查户口式关怀，换成具体的、当下的话')
        # FAIL 4：开头单独一个哟
        if YO_START_RE.match(bubble):
            add('FAIL', 'yo-start', no, bubble[:2], '开头单独的哟油腻又出戏，换个自然的开场')
        # FAIL 5：说教句式
        for term in LECTURE_PATTERNS:
            if term in bubble:
                add('FAIL', 'lecture-tone', no, term, '说教口吻惹人烦，改成分享自己的做法或直接给行动')
        # FAIL 6：过气热梗（硬失败；YYDS/yyds 之类按小写去重）
        seen = set()
        for term in DATED_MEMES:
            matched = find_term(bubble, term)
            if matched and matched.lower() not in seen:
                seen.add(matched.lower())
                add('FAIL', 'dated-meme', no, matched, '过气热梗，一用就出戏，删掉换当下的自然说法')
        # FAIL 7 / WARN：气泡长度（URL 豁免）
        length = visible_len(bubble)
        if length > FAIL_LEN:
            add('FAIL', 'bubble-overlong', no, bubble[:12] + '…',
                f'小作文警告：{length}字超过上限{FAIL_LEN}字，拆成短句或砍掉')
        elif length > WARN_LEN:
            add('WARN', 'bubble-long', no, bubble[:12] + '…',
                f'{length}字偏长，微信气泡{WARN_LEN}字以内最像真人')
        # WARN：全套书面标点（同一气泡既有逗号又有句号）
        if '，' in bubble and '。' in bubble:
            add('WARN', 'full-punct', no, '，+。', '全套书面标点像在写公文，逗号可留、句号删掉')
        # WARN：双省略号
        if '……' in bubble:
            add('WARN', 'ellipsis', no, '……', '……显得欲言又止/阴阳怪气，删掉或换成具体的话')
        # WARN：您/咱们
        for term in ('您', '咱们'):
            if term in bubble:
                add('WARN', 'honorific', no, term, '您/咱们拉开距离感（客服腔/自来熟），改成 你/我们')
        # WARN：半陈旧热梗
        for term in STALE_MEMES:
            matched = find_term(bubble, term)
            if matched:
                add('WARN', 'stale-meme', no, matched, '热梗已陈旧，慎用；拿不准就换白话')

    # ---- 整体检查（bubble 记为 None，人读输出显示「整体」）----
    if len(bubbles) > 3:
        add('WARN', 'too-many-bubbles', None, f'{len(bubbles)}条气泡', '一次回太多条像刷屏，控制在3条以内')
    full_text = '\n'.join(bubbles)
    bang = full_text.count('！') + full_text.count('!')
    if bang >= 2:
        add('WARN', 'exclaim-overload', None, f'！×{bang}', '感叹号太多显得用力过猛，最多留一个')
    tilde = full_text.count('～') + full_text.count('~')
    if tilde > 1:
        add('WARN', 'tilde-overload', None, f'～×{tilde}', '～超过一个就腻了，留一个够了')
    emoji_n = count_emoji(full_text)
    if emoji_n > 2:
        add('WARN', 'emoji-overload', None, f'emoji×{emoji_n}', 'emoji超过2个显得浮夸，最多留1-2个点睛')

    return findings


def main():
    parser = argparse.ArgumentParser(
        description='候选回复人味检查（voice lint）：每行算一个微信气泡，0=PASS 1=FAIL')
    parser.add_argument('--text', '-t', default=None, help='待检查文本；不传则从 stdin 读取')
    parser.add_argument('--strict', action='store_true', help='严格模式：WARN 也算不通过')
    parser.add_argument('--json', action='store_true', dest='as_json', help='输出机器可读 JSON')
    args = parser.parse_args()

    if args.text is not None:
        text = args.text
    else:
        if sys.stdin.isatty():
            parser.error('请通过 --text 或 stdin 提供待检查文本')
        text = sys.stdin.read()

    bubbles = [line.strip() for line in text.splitlines() if line.strip()]
    if not bubbles:
        print('没有可检查的内容（--text 或 stdin 为空）')
        sys.exit(1)

    findings = run_checks(bubbles)
    fails = [f for f in findings if f['level'] == 'FAIL']
    warns = [f for f in findings if f['level'] == 'WARN']
    failed = bool(fails) or (args.strict and bool(warns))
    result = 'FAIL' if failed else 'PASS'

    if args.as_json:
        print(json.dumps({
            'result': result,
            'fail_count': len(fails),
            'warn_count': len(warns),
            'strict': args.strict,
            'bubble_count': len(bubbles),
            'findings': findings,
        }, ensure_ascii=False, indent=2))
    else:
        for f in findings:
            pos = f"气泡{f['bubble']}" if f['bubble'] is not None else '整体'
            print(f"{f['level']} [{f['check']}] {pos}「{f['text']}」— {f['hint']}")
        print(f"RESULT: {result} ({len(fails)} fail, {len(warns)} warn)")

    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
