#!/usr/bin/env python3
"""
Session logger for reply-skill.
Records reply sessions so the system can learn what worked.
"""

import argparse
import json
import os
import sys
from datetime import datetime


PARTNERS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'partners')


def log_session(base_dir, slug, session_data):
    """Save a reply session to the history directory."""
    history_dir = os.path.join(base_dir, slug, 'history')
    os.makedirs(history_dir, exist_ok=True)

    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    filename = f"session_{ts}.json"
    path = os.path.join(history_dir, filename)

    session_data['logged_at'] = datetime.utcnow().isoformat() + 'Z'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(session_data, f, ensure_ascii=False, indent=2)

    # Update sessions_count in meta.json
    meta_path = os.path.join(base_dir, slug, 'meta.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        meta['sessions_count'] = meta.get('sessions_count', 0) + 1
        meta['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"Session saved: {filename}")
    return path


def list_sessions(base_dir, slug, limit=10):
    """List recent sessions for a partner."""
    history_dir = os.path.join(base_dir, slug, 'history')
    if not os.path.exists(history_dir):
        print("No sessions found.")
        return

    sessions = sorted(
        [f for f in os.listdir(history_dir) if f.endswith('.json')],
        reverse=True
    )[:limit]

    if not sessions:
        print("还没有对话记录。")
        return

    print(f"\n{'序号':<4} {'时间':<22} {'消息类型':<15} {'方案':<5} {'效果'}")
    print('-' * 65)
    for i, fname in enumerate(sessions, 1):
        path = os.path.join(history_dir, fname)
        with open(path, 'r', encoding='utf-8') as f:
            s = json.load(f)
        ts = s.get('logged_at', '')[:16].replace('T', ' ')
        msg_type = s.get('message_type', '未知')[:12]
        chosen = s.get('chosen_option', '-')
        outcome = s.get('outcome', '未标记')
        print(f"{i:<4} {ts:<22} {msg_type:<15} {chosen:<5} {outcome}")


def get_effective_patterns(base_dir, slug):
    """Analyze session history to find which reply strategies work best."""
    history_dir = os.path.join(base_dir, slug, 'history')
    if not os.path.exists(history_dir):
        return {}

    sessions = [
        f for f in os.listdir(history_dir) if f.endswith('.json')
    ]

    strategy_results = {}
    for fname in sessions:
        path = os.path.join(history_dir, fname)
        with open(path, 'r', encoding='utf-8') as f:
            s = json.load(f)
        strategy = s.get('chosen_strategy', '')
        outcome = s.get('outcome', '')
        if not strategy:
            continue
        if strategy not in strategy_results:
            strategy_results[strategy] = {'good': 0, 'bad': 0, 'neutral': 0}
        if outcome in ('good', 'great', '效果好', '很好用'):
            strategy_results[strategy]['good'] += 1
        elif outcome in ('bad', 'failed', '没效果', '效果差'):
            strategy_results[strategy]['bad'] += 1
        else:
            strategy_results[strategy]['neutral'] += 1

    return strategy_results


def print_stats(base_dir, slug):
    """Print effectiveness statistics."""
    patterns = get_effective_patterns(base_dir, slug)
    if not patterns:
        print("还没有足够的数据分析规律。")
        return

    print(f"\n=== {slug} 的回复策略效果统计 ===\n")
    for strategy, counts in sorted(patterns.items(), key=lambda x: -x[1]['good']):
        total = sum(counts.values())
        good_rate = counts['good'] / total * 100 if total else 0
        print(f"{strategy:<20} 好用: {counts['good']}次  差: {counts['bad']}次  好用率: {good_rate:.0f}%")


def main():
    parser = argparse.ArgumentParser(description='reply-skill session logger')
    parser.add_argument('--action', '-a', required=True,
                        choices=['log', 'list', 'stats'],
                        help='Action')
    parser.add_argument('--slug', '-s', required=True, help='Partner slug')
    parser.add_argument('--base-dir', '-d', default=PARTNERS_DIR)
    parser.add_argument('--limit', type=int, default=10, help='Number of sessions to show')

    # For logging a session
    parser.add_argument('--message', '-m', default='', help='The incoming message')
    parser.add_argument('--message-type', default='', help='Detected message type')
    parser.add_argument('--chosen', default='', help='Which option was chosen (e.g. "方案2")')
    parser.add_argument('--strategy', default='', help='Strategy name of chosen option')
    parser.add_argument('--outcome', default='', help='How it went: good/bad/neutral')

    args = parser.parse_args()

    if args.action == 'list':
        list_sessions(args.base_dir, args.slug, args.limit)
    elif args.action == 'stats':
        print_stats(args.base_dir, args.slug)
    elif args.action == 'log':
        session_data = {
            'incoming_message': args.message,
            'message_type': args.message_type,
            'chosen_option': args.chosen,
            'chosen_strategy': args.strategy,
            'outcome': args.outcome,
        }
        log_session(args.base_dir, args.slug, session_data)


if __name__ == '__main__':
    main()
