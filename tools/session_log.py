#!/usr/bin/env python3
"""
Session logger for dianzi-junshi.
Records reply sessions so the system can learn what worked.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


PARTNERS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'partners')


def utc_now():
    """Return the current timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def utc_now_iso():
    """Return an ISO8601 UTC timestamp with a Z suffix."""
    return utc_now().isoformat().replace('+00:00', 'Z')


def log_session(base_dir, slug, session_data):
    """Save a reply session to the history directory."""
    history_dir = os.path.join(base_dir, slug, 'history')
    os.makedirs(history_dir, exist_ok=True)

    ts = utc_now().strftime('%Y%m%d_%H%M%S')
    filename = f"session_{ts}.json"
    path = os.path.join(history_dir, filename)

    session_data['logged_at'] = utc_now_iso()
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(session_data, f, ensure_ascii=False, indent=2)

    # Update sessions_count in meta.json
    meta_path = os.path.join(base_dir, slug, 'meta.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        meta['sessions_count'] = meta.get('sessions_count', 0) + 1
        meta['updated_at'] = utc_now_iso()
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

    print(f"\n{'序号':<4} {'时间':<22} {'消息类型':<15} {'方案':<5} {'效果':<8} {'兴趣':<6} {'海王'}")
    print('-' * 78)
    for i, fname in enumerate(sessions, 1):
        path = os.path.join(history_dir, fname)
        with open(path, 'r', encoding='utf-8') as f:
            s = json.load(f)
        ts = s.get('logged_at', '')[:16].replace('T', ' ')
        msg_type = s.get('message_type', '未知')[:12]
        chosen = s.get('chosen_option', '-')
        outcome = s.get('outcome', '未标记')
        interest_delta = s.get('interest_delta', '-')
        player_delta = s.get('player_confidence_delta', '-')
        print(f"{i:<4} {ts:<22} {msg_type:<15} {chosen:<5} {outcome:<8} {interest_delta:<6} {player_delta}")


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
            strategy_results[strategy] = {
                'good': 0,
                'bad': 0,
                'neutral': 0,
                'interest_up': 0,
                'interest_down': 0,
                'player_up': 0,
                'player_down': 0,
                'cadence_good': 0,
                'flirt_caught': 0,
            }
        if outcome in ('good', 'great', '效果好', '很好用'):
            strategy_results[strategy]['good'] += 1
        elif outcome in ('bad', 'failed', '没效果', '效果差'):
            strategy_results[strategy]['bad'] += 1
        else:
            strategy_results[strategy]['neutral'] += 1

        interest_delta = s.get('interest_delta', '')
        if isinstance(interest_delta, str) and interest_delta.startswith('+'):
            strategy_results[strategy]['interest_up'] += 1
        elif isinstance(interest_delta, str) and interest_delta.startswith('-'):
            strategy_results[strategy]['interest_down'] += 1
        elif isinstance(interest_delta, (int, float)):
            if interest_delta > 0:
                strategy_results[strategy]['interest_up'] += 1
            elif interest_delta < 0:
                strategy_results[strategy]['interest_down'] += 1

        if s.get('caught_flirt_signal'):
            strategy_results[strategy]['flirt_caught'] += 1

        player_delta = s.get('player_confidence_delta', '')
        if isinstance(player_delta, str) and player_delta.startswith('+'):
            strategy_results[strategy]['player_up'] += 1
        elif isinstance(player_delta, str) and player_delta.startswith('-'):
            strategy_results[strategy]['player_down'] += 1
        elif isinstance(player_delta, (int, float)):
            if player_delta > 0:
                strategy_results[strategy]['player_up'] += 1
            elif player_delta < 0:
                strategy_results[strategy]['player_down'] += 1

        if s.get('cadence_worked'):
            strategy_results[strategy]['cadence_good'] += 1

    return strategy_results


def print_stats(base_dir, slug):
    """Print effectiveness statistics."""
    patterns = get_effective_patterns(base_dir, slug)
    if not patterns:
        print("还没有足够的数据分析规律。")
        return

    print(f"\n=== {slug} 的回复策略效果统计 ===\n")
    for strategy, counts in sorted(patterns.items(), key=lambda x: -x[1]['good']):
        total = counts['good'] + counts['bad'] + counts['neutral']
        good_rate = counts['good'] / total * 100 if total else 0
        print(
            f"{strategy:<20} 好用: {counts['good']}次  差: {counts['bad']}次  "
            f"好用率: {good_rate:.0f}%  兴趣+:{counts['interest_up']}  "
            f"兴趣-:{counts['interest_down']}  海王+:{counts['player_up']}  "
            f"海王-:{counts['player_down']}  节奏有效:{counts['cadence_good']}  接撩:{counts['flirt_caught']}"
        )


def main():
    parser = argparse.ArgumentParser(description='dianzi-junshi session logger')
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
    parser.add_argument('--interest-delta', default='', help='Interest score change, e.g. +1, 0, -2')
    parser.add_argument('--player-confidence-delta', default='',
                        help='Haiwang/Haihou confidence change, e.g. +10, 0, -10')
    parser.add_argument('--reply-interval-advice', default='', help='Recommended reply interval')
    parser.add_argument('--actual-reply-interval', default='', help='Actual reply interval')
    parser.add_argument('--pause-advice', default='', help='Pause/disappear recommendation')
    parser.add_argument('--pushpull-action', default='', help='Push-pull action used')
    parser.add_argument('--cadence-worked', action='store_true',
                        help='The cadence/pause strategy appeared to work')
    parser.add_argument('--caught-flirt', action='store_true',
                        help='Partner caught/responded to a flirt signal')
    parser.add_argument('--continued-self-display', action='store_true',
                        help='Partner continued a topic where the user displayed themselves')

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
            'interest_delta': args.interest_delta,
            'player_confidence_delta': args.player_confidence_delta,
            'reply_interval_advice': args.reply_interval_advice,
            'actual_reply_interval': args.actual_reply_interval,
            'pause_advice': args.pause_advice,
            'pushpull_action': args.pushpull_action,
            'cadence_worked': args.cadence_worked,
            'caught_flirt_signal': args.caught_flirt,
            'continued_user_self_display': args.continued_self_display,
        }
        log_session(args.base_dir, args.slug, session_data)


if __name__ == '__main__':
    main()
