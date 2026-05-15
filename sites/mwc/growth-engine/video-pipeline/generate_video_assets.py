#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / 'output' / 'video-assets'


def format_srt_block(index, line):
    start = index * 3
    end = start + 2
    return f"{index + 1}\n00:00:{start:02d},000 --> 00:00:{end:02d},500\n{line}\n"


def main():
    parser = argparse.ArgumentParser(description='Generate MWC video asset manifests from a content pack')
    parser.add_argument('--input', required=True, help='Path to generated content pack JSON')
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    pack = json.loads(input_path.read_text(encoding='utf-8'))
    pack_slug = input_path.stem
    target_dir = OUTPUT_DIR / pack_slug
    target_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    for item in pack['items']:
        base_name = item['id']
        subtitle_path = target_dir / f"{base_name}.srt"
        subtitle_path.write_text('\n'.join(format_srt_block(idx, line) for idx, line in enumerate(item['script']['overlay_lines'])), encoding='utf-8')
        manifest.append({
            'id': base_name,
            'hook': item['hook'],
            'caption': item['caption'],
            'voiceover': item['script']['voiceover'],
            'overlay_lines': item['script']['overlay_lines'],
            'subtitle_file': str(subtitle_path),
            'ffmpeg_note': 'Préparez un montage vertical 1080x1920 avec les rushes produit, puis ajoutez ce SRT et la voix off.'
        })

    manifest_path = target_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(manifest_path)


if __name__ == '__main__':
    main()
