from __future__ import annotations

from pathlib import Path
import json
import subprocess
from typing import Any

import yaml

_CACHE: dict[tuple[str, str], dict[str, Any]] = {}


def _signature(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _read_cached(path: Path, loader, kind: str, default):
    if not path.exists():
        return default
    key = (kind, str(path))
    signature = _signature(path)
    cached = _CACHE.get(key)
    if cached and cached["signature"] == signature:
        return cached["value"]
    value = loader(path)
    _CACHE[key] = {
        "signature": signature,
        "value": value,
    }
    return value


def load_yaml_path(path: Path, default=None):
    return _read_cached(
        path,
        lambda target: yaml.safe_load(target.read_text(encoding="utf-8")) or (default if default is not None else {}),
        "yaml",
        default if default is not None else {},
    )


def load_json_path(path: Path, default=None):
    return _read_cached(
        path,
        lambda target: json.loads(target.read_text(encoding="utf-8")),
        "json",
        default if default is not None else {},
    )


def load_text_path(path: Path, default: str = "") -> str:
    return _read_cached(
        path,
        lambda target: target.read_text(encoding="utf-8"),
        "text",
        default,
    )


def load_jsonl_path(path: Path) -> list[dict]:
    def _loader(target: Path) -> list[dict]:
        rows: list[dict] = []
        for raw in target.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            rows.append(json.loads(line))
        return rows

    return _read_cached(path, _loader, "jsonl", [])


def load_structured_path(path: Path, default=None):
    if path.suffix == ".json":
        return load_json_path(path, default if default is not None else {})
    return load_yaml_path(path, default if default is not None else {})


def run_json_command(command: list[str], cwd: Path, timeout: int = 30) -> dict:
    try:
        completed = subprocess.run(command, capture_output=True, text=True, cwd=cwd, timeout=timeout, check=False)
        return json.loads(completed.stdout) if completed.stdout.strip() else {}
    except Exception as exc:
        return {"error": str(exc)}
