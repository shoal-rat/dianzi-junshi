#!/usr/bin/env python3
"""
Partner profile manager for dianzi-junshi.
List, show, and delete partner profiles stored under partners/{slug}/.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


PARTNERS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'partners')

STAGE_INFO = {
    0: ('初识期', 0),
    1: ('暧昧期', 1.5),
    2: ('追求期', 2),
    3: ('告白/确认期', 2.5),
    4: ('热恋初期', 3.5),
    5: ('稳定期', 3),
    6: ('磨合/瓶颈期', 1.5),
    7: ('危机期', 0.5),
}


def utc_now_iso():
    """Return an ISO8601 UTC timestamp with a Z suffix."""
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def get_all_partners(base_dir):
    """List all partner directories."""
    if not os.path.exists(base_dir):
        return []
    return [
        d for d in os.listdir(base_dir)
        if os.path.isdir(os.path.join(base_dir, d)) and not d.startswith('.')
    ]


def load_meta(base_dir, slug):
    """Load meta.json for a partner."""
    meta_path = os.path.join(base_dir, slug, 'meta.json')
    if not os.path.exists(meta_path):
        return None
    with open(meta_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def list_partners(base_dir):
    """List all partners with summary info."""
    partners = get_all_partners(base_dir)
    if not partners:
        print("还没有对象档案。用 /junshi 创建第一个。")
        return

    print(f"{'代号':<15} {'在一起':<12} {'关系状态':<10} {'创建时间':<20} {'版本'}")
    print('-' * 70)
    for slug in sorted(partners):
        meta = load_meta(base_dir, slug)
        if meta:
            name = meta.get('name', slug)
            duration = meta.get('profile', {}).get('together_duration', '未知')
            status = meta.get('stage_name') or meta.get('profile', {}).get('relationship_status', '稳定期')
            created = meta.get('created_at', '')[:10]
            version = meta.get('version', 'v1')
            print(f"{name:<15} {duration:<12} {status:<10} {created:<20} {version}")
        else:
            print(f"{slug:<15} {'(无元数据)':<12}")


def show_partner(base_dir, slug):
    """Show detailed info for a partner."""
    meta = load_meta(base_dir, slug)
    if not meta:
        print(f"找不到 '{slug}' 的档案。", file=sys.stderr)
        sys.exit(1)

    print(f"\n=== {meta.get('name', slug)} 的档案 ===\n")
    profile = meta.get('profile', {})
    for k, v in profile.items():
        print(f"  {k}: {v}")

    tags = meta.get('tags', {})
    if tags:
        print("\n标签：")
        for k, v in tags.items():
            print(f"  {k}: {v}")

    print(f"\n创建时间：{meta.get('created_at', '')}")
    print(f"最后更新：{meta.get('updated_at', '')}")
    print(f"版本：{meta.get('version', 'v1')}")
    print(f"当前阶段：{meta.get('stage_name', '未知')}（{meta.get('stage', '未知')}）")
    print(f"油腻上限：{meta.get('oiliness_cap', '未知')}/5")
    print(f"反舔狗模式：{'开启' if meta.get('anti_simp_mode') else '关闭'}")
    print(f"纠正次数：{meta.get('corrections_count', 0)}")

    # Show session count
    history_dir = os.path.join(base_dir, slug, 'history')
    if os.path.exists(history_dir):
        sessions = [f for f in os.listdir(history_dir) if f.endswith('.json')]
        print(f"历史对话记录：{len(sessions)} 次")


def init_partner(base_dir, slug, name, stage=1, anti_simp_mode=False):
    """Initialize directory structure for a new partner."""
    partner_dir = os.path.join(base_dir, slug)
    history_dir = os.path.join(partner_dir, 'history')
    versions_dir = os.path.join(partner_dir, 'versions')
    materials_dir = os.path.join(partner_dir, 'materials')

    for d in [partner_dir, history_dir, versions_dir, materials_dir]:
        os.makedirs(d, exist_ok=True)

    stage_name, oiliness_cap = STAGE_INFO.get(stage, STAGE_INFO[1])

    # Create initial meta.json
    meta = {
        'name': name,
        'slug': slug,
        'created_at': utc_now_iso(),
        'updated_at': utc_now_iso(),
        'version': 'v1',
        'stage': stage,
        'stage_name': stage_name,
        'oiliness_cap': oiliness_cap,
        'anti_simp_mode': anti_simp_mode,
        'profile': {
            'together_duration': '',
            'distance': '',
            'occupation': '',
            'how_met': '',
            'relationship_status': stage_name,
        },
        'tags': {
            'attachment_style': '',
            'love_language': '',
            'communication_style': '',
        },
        'interest': {
            'score': None,
            'confidence': '待观察',
            'trend': '待观察',
        },
        'player_confidence': {
            'score': None,
            'level': '待观察',
            'confidence': '待观察',
            'trend': '待观察',
            'recent_signals': [],
            'next_test_action': '',
        },
        'cadence_strategy': {
            'preferred_reply_interval': '',
            'pause_advice': '',
            'last_pushpull_action': '',
        },
        'pursuit_playbook': {
            'type': '待观察',
            'gender_script': '待观察',
            'pushpull_intensity': None,
            'effective_actions': [],
            'escalation_window': '',
            'pause_window': '',
        },
        'micro_info': {
            'mbti': '',
            'astrology_attitude': '',
            'catchphrases': [],
            'gift_preferences': [],
            'food_restrictions': [],
            'date_preferences': [],
        },
        'corrections_count': 0,
        'sessions_count': 0,
    }

    meta_path = os.path.join(partner_dir, 'meta.json')
    if not os.path.exists(meta_path):
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"已创建目录结构：{partner_dir}")
    return partner_dir


def delete_partner(base_dir, slug, force=False):
    """Delete a partner profile."""
    import shutil
    partner_dir = os.path.join(base_dir, slug)
    if not os.path.exists(partner_dir):
        print(f"找不到 '{slug}' 的档案。", file=sys.stderr)
        sys.exit(1)

    if not force:
        meta = load_meta(base_dir, slug)
        name = meta.get('name', slug) if meta else slug
        confirm = input(f"确定要删除「{name}」的所有档案吗？这不可撤销。(输入 yes 确认): ")
        if confirm.strip().lower() != 'yes':
            print("已取消。")
            return

    shutil.rmtree(partner_dir)
    print(f"已删除「{slug}」的档案。")


def main():
    parser = argparse.ArgumentParser(description='dianzi-junshi partner profile manager')
    parser.add_argument('--action', '-a', required=True,
                        choices=['list', 'show', 'init', 'delete'],
                        help='Action to perform')
    parser.add_argument('--slug', '-s', default=None, help='Partner slug')
    parser.add_argument('--name', '-n', default=None, help='Partner display name (for init)')
    parser.add_argument('--base-dir', '-d', default=PARTNERS_DIR, help='Base partners directory')
    parser.add_argument('--force', action='store_true', help='Skip confirmation for delete')
    parser.add_argument('--stage', type=int, default=1, choices=sorted(STAGE_INFO.keys()),
                        help='Relationship stage for init (0-7, default: 1)')
    parser.add_argument('--anti-simp', action='store_true',
                        help='Enable anti-simp mode for init')
    args = parser.parse_args()

    if args.action == 'list':
        list_partners(args.base_dir)
    elif args.action == 'show':
        if not args.slug:
            print("Error: --slug required for show", file=sys.stderr)
            sys.exit(1)
        show_partner(args.base_dir, args.slug)
    elif args.action == 'init':
        if not args.slug or not args.name:
            print("Error: --slug and --name required for init", file=sys.stderr)
            sys.exit(1)
        init_partner(args.base_dir, args.slug, args.name, args.stage, args.anti_simp)
    elif args.action == 'delete':
        if not args.slug:
            print("Error: --slug required for delete", file=sys.stderr)
            sys.exit(1)
        delete_partner(args.base_dir, args.slug, force=args.force)


if __name__ == '__main__':
    main()
