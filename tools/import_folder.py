#!/usr/bin/env python3
"""
Scan a user-provided folder and classify materials for dianzi-junshi.
Uses only the Python standard library.
"""

import argparse
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'}
TEXT_EXTS = {'.txt', '.md', '.csv', '.json', '.log'}
DOC_EXTS = {'.docx', '.doc', '.pdf', '.rtf'}

KEYWORDS = {
    'chat_text': ('chat', 'wechat', '微信', '聊天', '记录', '对话', 'qq', 'message', 'messages'),
    'moments_image': ('朋友圈', 'moments', '动态', '小红书', '微博', 'redbook', 'xiaohongshu', 'post'),
    'appearance_image': ('自拍', '照片', '头像', '穿搭', '妆', '妆容', 'makeup', 'outfit', 'selfie', 'photo'),
    'notes': ('note', 'notes', '备注', '画像', 'profile', '印象', '偏好'),
}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def has_keyword(path, category):
    text = str(path).lower()
    return any(keyword.lower() in text for keyword in KEYWORDS[category])


def classify(path):
    suffix = path.suffix.lower()

    if suffix in TEXT_EXTS:
        if has_keyword(path, 'chat_text'):
            return 'chat_text'
        if has_keyword(path, 'notes'):
            return 'notes'
        return 'text_other'

    if suffix in IMAGE_EXTS:
        if has_keyword(path, 'moments_image'):
            return 'moments_image'
        if has_keyword(path, 'appearance_image'):
            return 'appearance_image'
        if has_keyword(path, 'chat_text') or has_keyword(path, 'moments_image'):
            return 'screenshot'
        return 'image_unknown'

    if suffix in DOC_EXTS:
        if has_keyword(path, 'notes'):
            return 'notes'
        return 'document'

    return 'unknown'


def scan_folder(root, max_files=None):
    root = Path(root).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"Folder not found: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a folder: {root}")

    items = []
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        if max_files is not None and len(items) >= max_files:
            break
        try:
            stat = path.stat()
        except OSError:
            continue
        category = classify(path)
        items.append({
            'path': str(path),
            'name': path.name,
            'extension': path.suffix.lower(),
            'category': category,
            'size_bytes': stat.st_size,
            'modified_at': datetime.fromtimestamp(
                stat.st_mtime,
                tz=timezone.utc,
            ).isoformat().replace('+00:00', 'Z'),
        })
    return root, items


def build_manifest(root, items):
    by_category = defaultdict(list)
    for item in items:
        by_category[item['category']].append(item)

    return {
        'generated_at': utc_now_iso(),
        'root': str(root),
        'total_files': len(items),
        'counts': dict(Counter(item['category'] for item in items)),
        'files': items,
        'next_steps': [
            'Use chat_text files with tools/wechat_parser.py or direct analysis.',
            'Use a multimodal model for moments_image, appearance_image, screenshot, and image_unknown files.',
            'Read notes/document files when the platform supports their format; otherwise ask the user to export text.',
        ],
    }


def write_markdown(manifest, output_json):
    md_path = Path(output_json).with_suffix('.md')
    lines = [
        '# 导入清单',
        '',
        f"文件夹：`{manifest['root']}`",
        f"生成时间：{manifest['generated_at']}",
        f"文件总数：{manifest['total_files']}",
        '',
        '## 分类统计',
        '',
    ]

    for category, count in sorted(manifest['counts'].items()):
        lines.append(f"- `{category}`: {count}")

    lines += [
        '',
        '## 建议处理顺序',
        '',
        '1. 先处理 `chat_text`，建立聊天节奏、兴趣度和口头禅基线。',
        '2. 再用多模态模型处理 `moments_image` / `appearance_image`，提取朋友圈展示面、外貌妆容和审美偏好。',
        '3. 再读取 `notes` / `document` 补充用户描述。',
        '',
        '## 文件列表',
        '',
    ]

    for item in manifest['files']:
        lines.append(f"- `{item['category']}` `{item['path']}` ({item['size_bytes']} bytes)")

    md_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return md_path


def main():
    parser = argparse.ArgumentParser(description='Classify a folder of chat and social materials')
    parser.add_argument('--path', '-p', required=True, help='Folder to scan')
    parser.add_argument('--output', '-o', default='import_manifest.json', help='Output JSON path')
    parser.add_argument('--max-files', type=int, default=None, help='Optional max number of files to scan')
    args = parser.parse_args()

    root, items = scan_folder(args.path, args.max_files)
    manifest = build_manifest(root, items)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    md_path = write_markdown(manifest, output)

    print(f"Scanned: {root}")
    print(f"Files: {manifest['total_files']}")
    for category, count in sorted(manifest['counts'].items()):
        print(f"  {category}: {count}")
    print(f"JSON: {output}")
    print(f"Markdown: {md_path}")


if __name__ == '__main__':
    main()
