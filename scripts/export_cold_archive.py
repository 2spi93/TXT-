#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JsonMap = dict[str, Any]


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_json(path: Path) -> JsonMap:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"config root must be an object: {path}")
    return value


def _write_json(path: Path, payload: JsonMap) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(tmp_path, path)


def _copy_tree(source_root: Path, destination_root: Path, patterns: list[str], state: JsonMap, max_files: int) -> JsonMap:
    exported = []
    skipped = []
    errors = []
    seen = state.setdefault("files", {})
    count = 0
    for pattern in patterns:
        for source_path in sorted(source_root.glob(pattern)):
            if count >= max_files:
                break
            if not source_path.is_file():
                continue
            rel = source_path.relative_to(source_root)
            destination = destination_root / rel
            stat = source_path.stat()
            key = str(source_path)
            marker = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
            if seen.get(key) == marker and destination.exists():
                skipped.append({"source_path": key, "destination": str(destination), "reason": "already_exported"})
                continue
            try:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, destination)
                seen[key] = marker
                exported.append({"source_path": key, "destination": str(destination), "bytes": stat.st_size})
                count += 1
            except Exception as exc:
                errors.append({"source_path": key, "error": str(exc)})
    return {"exported": exported, "skipped": skipped, "errors": errors}


def export_cold_archive(config_path: str) -> JsonMap:
    config = _load_json(Path(config_path))
    source_root = Path(str(config.get("source_root", "/opt/txt/artifacts"))).expanduser()
    destination_root = Path(str(config.get("local_destination_root", "/opt/txt/artifacts/cold-replay-local"))).expanduser()
    state_path = Path(str(config.get("state_path", "/opt/txt/artifacts/cold-export-state/local.json"))).expanduser()
    patterns = config.get("patterns") or ["jsonl-parquet/**/*.parquet", "jsonl-archive/**/*.manifest.json"]
    if not isinstance(patterns, list):
        patterns = [str(patterns)]
    max_files = int(config.get("max_files_per_run", 200))
    state = _load_json(state_path) if state_path.exists() else {"schema": "txt-cold-archive-state/v1", "files": {}}
    result = _copy_tree(source_root, destination_root, [str(pattern) for pattern in patterns], state, max_files)
    state["updated_at"] = _iso()
    _write_json(state_path, state)
    return {"status": "partial" if result["errors"] else "ok", "started_at": _iso(), "source_root": str(source_root), "destination_root": str(destination_root), **result}


def main() -> None:
    parser = argparse.ArgumentParser(description="Export compacted TXT artifacts to cold local storage.")
    parser.add_argument("--config", default="/opt/txt/config/cold_archive_export.json")
    args = parser.parse_args()
    summary = export_cold_archive(args.config)
    print(json.dumps(summary, indent=2, sort_keys=True))
    if summary.get("status") not in {"ok", "partial"}:
        raise SystemExit(1)


if __name__ == "__main__":
    main()