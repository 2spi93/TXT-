#!/usr/bin/env python3
import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / 'config' / 'products.json'
OUTPUT_DIR = ROOT / 'output' / 'content-packs'


def slugify(value: str) -> str:
    return ''.join(ch.lower() if ch.isalnum() else '-' for ch in value).strip('-')


def load_config():
    return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))


def find_product(config, product_id):
    for product in config['products']:
        if product['id'] == product_id:
            return product
    raise SystemExit(f'Unknown product id: {product_id}')


def build_hook(product, index):
    base = product['hooks'][index % len(product['hooks'])]
    angle = product['hero_angle']
    return f"{base.capitalize()} ? {product['name']} aide à {angle}."


def build_script(product, channel_profile, index):
    hook = build_hook(product, index)
    benefit = product['benefits'][index % len(product['benefits'])]
    objection = product['objections'][index % len(product['objections'])]
    cta = product['cta']
    return {
        'hook': hook,
        'beats': [
            f"Montrer le problème : {product['hooks'][index % len(product['hooks'])]}.",
            f"Montrer la transformation : {benefit}.",
            f"Lever une objection : {objection}.",
            f"Finir avec CTA : {cta}."
        ],
        'voiceover': f"{hook} En quelques secondes, vous voyez mieux, vous gagnez de la place et vous gardez l’essentiel accessible. {benefit.capitalize()}. Si vous vous demandez ‘{objection}’, la démonstration répond directement à la question. {cta}.",
        'overlay_lines': [
            product['hooks'][index % len(product['hooks'])].capitalize(),
            benefit.capitalize(),
            cta
        ],
        'duration_hint_seconds': channel_profile['duration_seconds'],
        'editing_style': channel_profile['tone']
    }


def build_caption(product, platform, index):
    base = product['hooks'][index % len(product['hooks'])]
    hashtags = ['#rangement', '#organisationmaison', '#mwc']
    if platform == 'snapchat':
        hashtags = ['#mwc', '#maison', '#astuce']
    return f"{base.capitalize()} → {product['name']}. {product['cta']}. {' '.join(hashtags)}"


def main():
    parser = argparse.ArgumentParser(description='Generate MWC content pack')
    parser.add_argument('--product', required=True)
    parser.add_argument('--platform', default='tiktok', choices=['tiktok', 'instagram_reels', 'youtube_shorts', 'snapchat'])
    parser.add_argument('--count', type=int, default=6)
    args = parser.parse_args()

    config = load_config()
    product = find_product(config, args.product)
    channel_profile = config['channels'][args.platform]
    pack = {
        'generated_at': datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        'brand': config['brand'],
        'platform': args.platform,
        'product': product,
        'items': []
    }

    for index in range(args.count):
        pack['items'].append({
            'id': f"{args.product}-{args.platform}-{index + 1}",
            'hook': build_hook(product, index),
            'caption': build_caption(product, args.platform, index),
            'script': build_script(product, channel_profile, index)
        })

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{slugify(args.product)}-{slugify(args.platform)}.json"
    output_path.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(output_path)


if __name__ == '__main__':
    main()
