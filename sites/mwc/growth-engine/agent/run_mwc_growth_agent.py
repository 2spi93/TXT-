#!/usr/bin/env python3
import argparse
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / 'config' / 'products.json'
OUTPUT_DIR = ROOT / 'output' / 'weekly-packs'
CONTENT_SCRIPT = ROOT / 'content-engine' / 'generate_content_pack.py'

PRIORITY_PRODUCTS = ['sink', 'drawer-dividers']
PRIORITY_CHANNELS = ['tiktok', 'instagram_reels', 'youtube_shorts', 'snapchat']


def load_config():
    return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))


def run_content_pack(product_id, platform, count):
    result = subprocess.run(
        ['python3', str(CONTENT_SCRIPT), '--product', product_id, '--platform', platform, '--count', str(count)],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip().splitlines()[-1]


def main():
    parser = argparse.ArgumentParser(description='Generate a weekly MWC growth agent pack')
    parser.add_argument('--week-label', default=datetime.now(UTC).strftime('%Y-W%W'))
    parser.add_argument('--count-per-pack', type=int, default=4)
    args = parser.parse_args()

    config = load_config()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pack = {
        'brand': config['brand'],
        'week_label': args.week_label,
        'generated_at': datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        'priorities': [
            'Produit star d’abord',
            'Recycler les mêmes hooks gagnants sur plusieurs plateformes',
            'Snapchat en canal complémentaire validé manuellement'
        ],
        'assets': [],
        'publication_order': []
    }

    for product_id in PRIORITY_PRODUCTS:
        for platform in PRIORITY_CHANNELS:
            generated_path = run_content_pack(product_id, platform, args.count_per_pack)
            pack['assets'].append({
                'product_id': product_id,
                'platform': platform,
                'content_pack': generated_path
            })
            pack['publication_order'].append(
                f"Publier {product_id} sur {platform} avec hook 1 puis tester hook 2 si le watch time est faible"
            )

    target_path = OUTPUT_DIR / f"{args.week_label}.json"
    target_path.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(target_path)


if __name__ == '__main__':
    main()
