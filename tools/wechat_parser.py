#!/usr/bin/env python3
"""
WeChat chat log parser for dianzi-junshi.
Extracts communication patterns from the partner's side of the conversation.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime


LOW_EFFORT_REPLIES = {
    '嗯', '嗯嗯', '哦', '哦哦', '噢', '噢噢', '好', '好的', '行', '可以',
    '哈哈', '哈哈哈', 'hh', 'hhh', '笑死', '[表情]', '[动画表情]',
}

INVITATION_CUES = ('一起', '见面', '出来', '周末', '有空', '去不去', '吃饭', '喝咖啡', '看电影')
SELF_DISCLOSURE_CUES = ('我', '今天', '刚刚', '最近', '昨天', '明天', '现在')


def parse_wechatmsg_txt(content, target_name):
    """Parse WeChatMsg exported txt format."""
    messages = []
    lines = content.split('\n')
    current_msg = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # WeChatMsg format: "2024-01-15 23:42:10  Name\nMessage content"
        timestamp_match = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.+)$', line)
        if timestamp_match:
            if current_msg:
                messages.append(current_msg)
            ts_str, sender = timestamp_match.groups()
            current_msg = {
                'timestamp': ts_str,
                'sender': sender.strip(),
                'content': '',
                'hour': int(ts_str.split(' ')[1].split(':')[0])
            }
        elif current_msg:
            current_msg['content'] += line + ' '

    if current_msg:
        messages.append(current_msg)

    return [m for m in messages if m['content'].strip()]


def parse_plain_text(content, target_name):
    """Parse plain pasted chat (manual format)."""
    messages = []
    lines = content.split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        line = re.sub(r'^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*', '', line)

        speaker_match = re.match(r'^(.{1,24}?)[：:]\s*(.+)$', line)
        if speaker_match:
            sender, content_part = speaker_match.groups()
            sender = sender.strip()
            content_part = content_part.strip()
            is_target = (
                (target_name and target_name.lower() in sender.lower())
                or sender in ('对方', 'ta', 'TA', '他', '她')
            )
            if is_target:
                messages.append({
                    'sender': target_name or sender,
                    'content': content_part,
                    'hour': None,
                    'timestamp': None
                })
            continue

        # Try to detect if line starts with name
        if target_name and (line.startswith(target_name + ':') or line.startswith(target_name + '：')):
            content_part = line[len(target_name) + 1:].strip()
            messages.append({
                'sender': target_name,
                'content': content_part,
                'hour': None,
                'timestamp': None
            })
        elif line.startswith(('对方:', '对方：', 'ta:', 'ta：', 'TA:', 'TA：', '他:', '他：', '她:', '她：')):
            colon_pos = max(line.find(':'), line.find('：'))
            messages.append({
                'sender': target_name or '对方',
                'content': line[colon_pos + 1:].strip(),
                'hour': None,
                'timestamp': None
            })

    return messages


def extract_partner_messages(messages, target_name):
    """Filter to only the partner's messages."""
    if not target_name:
        return messages
    return [m for m in messages if target_name.lower() in m.get('sender', '').lower()]


def analyze_communication_patterns(messages):
    """Analyze communication patterns from messages."""
    if not messages:
        return {}

    contents = [m['content'].strip() for m in messages if m.get('content', '').strip()]

    # Message length distribution
    lengths = [len(c) for c in contents]
    avg_len = sum(lengths) / len(lengths) if lengths else 0
    short_count = sum(1 for l in lengths if l <= 15)
    long_count = sum(1 for l in lengths if l >= 50)
    density = 'short' if short_count / len(lengths) > 0.6 else ('long' if long_count / len(lengths) > 0.3 else 'medium')

    # Punctuation habits
    uses_period = sum(1 for c in contents if c.endswith('。') or c.endswith('.')) / len(contents)
    uses_ellipsis = sum(1 for c in contents if '...' in c or '……' in c) / len(contents)
    uses_exclamation = sum(1 for c in contents if '！' in c or '!' in c) / len(contents)
    uses_tilde = sum(1 for c in contents if '～' in c or '~' in c) / len(contents)

    # Emoji / expression detection
    emoji_pattern = re.compile(r'[\U00010000-\U0010ffff]', flags=re.UNICODE)
    bracket_pattern = re.compile(r'\[.+?\]')
    has_emoji = sum(1 for c in contents if emoji_pattern.search(c) or bracket_pattern.search(c))
    emoji_rate = has_emoji / len(contents)

    # Common particles (语气词)
    particle_counter = Counter()
    particles = ['哈哈', 'hh', '嗯', '哦', '噢', '啊', '呀', '唉', '嘿', '喂', '哎', '呜', '哇', '诶', '嗨']
    all_text = ' '.join(contents)
    for p in particles:
        count = all_text.count(p)
        if count > 0:
            particle_counter[p] = count

    # Active hours
    hours = [m['hour'] for m in messages if m.get('hour') is not None]
    hour_dist = Counter(hours)
    active_hours = sorted(hour_dist.items(), key=lambda x: -x[1])[:5]

    # Night owl detection (messages between 0-4am)
    late_night = sum(1 for h in hours if h is not None and 0 <= h < 5)
    night_owl = late_night / len(hours) > 0.1 if hours else False

    # Detect voice messages
    voice_count = sum(1 for c in contents if '[语音]' in c or '[Voice]' in c or '[voice]' in c)

    # Build message samples (representative)
    samples = []
    for msg in messages[:50]:
        c = msg.get('content', '').strip()
        if 5 < len(c) < 60:
            samples.append(c)
    samples = samples[:8]

    # Response after question detection
    questions = sum(1 for c in contents if '？' in c or '?' in c)

    low_effort_count = sum(1 for c in contents if c.strip() in LOW_EFFORT_REPLIES or len(c.strip()) <= 2)
    detail_count = sum(1 for c in contents if len(c) >= 20)
    self_disclosure_count = sum(1 for c in contents if any(cue in c for cue in SELF_DISCLOSURE_CUES) and len(c) >= 8)
    invitation_count = sum(1 for c in contents if any(cue in c for cue in INVITATION_CUES))

    return {
        'total_messages': len(messages),
        'avg_length': round(avg_len, 1),
        'message_density': density,
        'punctuation': {
            'uses_period': round(uses_period, 2),
            'uses_ellipsis': round(uses_ellipsis, 2),
            'uses_exclamation': round(uses_exclamation, 2),
            'uses_tilde': round(uses_tilde, 2),
        },
        'emoji_rate': round(emoji_rate, 2),
        'top_particles': dict(particle_counter.most_common(8)),
        'active_hours': active_hours,
        'night_owl': night_owl,
        'voice_message_rate': round(voice_count / len(contents), 2) if contents else 0,
        'question_rate': round(questions / len(contents), 2) if contents else 0,
        'low_effort_rate': round(low_effort_count / len(contents), 2) if contents else 0,
        'detail_rate': round(detail_count / len(contents), 2) if contents else 0,
        'self_disclosure_rate': round(self_disclosure_count / len(contents), 2) if contents else 0,
        'invitation_cue_count': invitation_count,
        'samples': samples,
    }


def format_report(analysis, target_name):
    """Format analysis into a readable report for the strategist."""
    lines = [
        f"=== {target_name} 聊天记录分析报告 ===\n",
        f"消息总数：{analysis['total_messages']} 条",
        f"平均消息长度：{analysis['avg_length']} 字",
        f"消息风格：{ {'short': '短句型', 'medium': '中等型', 'long': '长段落型'}[analysis['message_density']] }",
        "",
        "--- 标点/表达习惯 ---",
        f"发句号比例：{int(analysis['punctuation']['uses_period']*100)}%",
        f"用省略号比例：{int(analysis['punctuation']['uses_ellipsis']*100)}%",
        f"用感叹号比例：{int(analysis['punctuation']['uses_exclamation']*100)}%",
        f"用波浪号比例：{int(analysis['punctuation']['uses_tilde']*100)}%",
        f"含 emoji/表情比例：{int(analysis['emoji_rate']*100)}%",
        "",
        "--- 高频语气词 ---",
    ]

    for particle, count in list(analysis['top_particles'].items())[:6]:
        lines.append(f"  '{particle}': {count} 次")

    lines += [
        "",
        "--- 活跃时段 (小时, 消息数) ---",
    ]
    for hour, count in analysis['active_hours'][:5]:
        hour_label = f"{hour:02d}:00"
        lines.append(f"  {hour_label}: {count} 条")

    lines += [
        "",
        f"夜猫子特征：{'是（深夜活跃）' if analysis['night_owl'] else '否'}",
        f"语音消息估算比例：{int(analysis['voice_message_rate']*100)}%",
        f"发问/问句比例：{int(analysis['question_rate']*100)}%",
        f"低质量短回复比例：{int(analysis['low_effort_rate']*100)}%",
        f"细节型回复比例：{int(analysis['detail_rate']*100)}%",
        f"主动分享自我比例：{int(analysis['self_disclosure_rate']*100)}%",
        f"邀约/见面线索次数：{analysis['invitation_cue_count']}",
        "",
        "--- 典型消息样本 ---",
    ]
    for i, sample in enumerate(analysis['samples'], 1):
        lines.append(f"  {i}. \"{sample}\"")

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='WeChat chat log analyzer for dianzi-junshi')
    parser.add_argument('--file', '-f', required=True, help='Path to chat log file')
    parser.add_argument('--target', '-t', required=True, help='Partner name/alias in the chat')
    parser.add_argument('--output', '-o', default=None, help='Output file path (default: stdout)')
    parser.add_argument('--format', default='auto', choices=['auto', 'wechatmsg', 'plain'],
                        help='Input file format')
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"Error: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    with open(args.file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # Parse based on format
    fmt = args.format
    if fmt == 'auto':
        # Simple heuristic
        if re.search(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', content):
            fmt = 'wechatmsg'
        else:
            fmt = 'plain'

    if fmt == 'wechatmsg':
        all_messages = parse_wechatmsg_txt(content, args.target)
    else:
        all_messages = parse_plain_text(content, args.target)

    partner_messages = extract_partner_messages(all_messages, args.target)

    if not partner_messages:
        print(f"Warning: No messages found for '{args.target}'. Check the name matches exactly.", file=sys.stderr)
        partner_messages = all_messages  # fallback

    analysis = analyze_communication_patterns(partner_messages)
    report = format_report(analysis, args.target)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"Report saved to: {args.output}")
    else:
        print(report)


if __name__ == '__main__':
    main()
