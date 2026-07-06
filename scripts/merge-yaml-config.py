# -*- mode: python -*-
# /// script
# dependencies = ["pyyaml"]
# ///
import argparse
import os
import tempfile
from pathlib import Path
from typing import Any

import yaml


def load_mapping(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}

    data = yaml.safe_load(path.read_text())
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise SystemExit(f"{path} must contain a YAML mapping at the top level")
    return data


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in overlay.items():
        existing = merged.get(key)
        if isinstance(existing, dict) and isinstance(value, dict):
            merged[key] = deep_merge(existing, value)
        else:
            merged[key] = value
    return merged


def write_yaml_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = yaml.safe_dump(data, sort_keys=False, default_flow_style=False)

    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as tmp:
            tmp.write(rendered)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge a versioned YAML mapping into a target YAML mapping.")
    parser.add_argument("target", type=Path, help="Target YAML file to create or update")
    parser.add_argument("overlay", type=Path, help="Versioned YAML file whose keys override the target")
    args = parser.parse_args()

    target = load_mapping(args.target)
    overlay = load_mapping(args.overlay)
    write_yaml_atomic(args.target, deep_merge(target, overlay))


if __name__ == "__main__":
    main()
