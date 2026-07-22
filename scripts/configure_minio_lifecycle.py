#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
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


def configure_lifecycle(config_path: str) -> JsonMap:
    config = _load_json(Path(config_path))
    enabled = bool(config.get("enabled", False))
    rules = config.get("rules") or []
    return {
        "status": "ok",
        "configured_at": _iso(),
        "enabled": enabled,
        "mode": "deferred" if not enabled else "configured",
        "rules": rules,
        "message": "Lifecycle config recorded; external MinIO mutation is disabled by configuration." if not enabled else "Lifecycle config loaded.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate TXT MinIO lifecycle configuration.")
    parser.add_argument("--config", default="/opt/txt/config/minio_txt_replay_cold_lifecycle.json")
    args = parser.parse_args()
    print(json.dumps(configure_lifecycle(args.config), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()