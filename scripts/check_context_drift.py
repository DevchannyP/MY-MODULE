#!/usr/bin/env python3
"""
Check drift for a previously exported context lock manifest.

Usage:
  python3 scripts/check_context_drift.py --input context-lock.json --json
  python3 scripts/check_context_drift.py --json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONTEXT_LOCK = ROOT / "artifacts" / "promotion-pipeline" / "latest" / "context-lock.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check drift against a Workflow OS context lock manifest")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_CONTEXT_LOCK),
        help="Path to a context lock JSON/YAML file. Defaults to artifacts/promotion-pipeline/latest/context-lock.json",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--root", default=str(ROOT), help="Workspace root used to resolve locked file paths")
    return parser.parse_args()


def load_structured_file(path: Path):
    raw = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        return json.loads(raw)
    return yaml.safe_load(raw) or {}


def sha256_for_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_entry(root: Path, entry: dict) -> dict:
    relative_path = entry.get("path", "")
    target = root / relative_path
    if not target.exists():
        return {
            "path": relative_path,
            "tier": entry.get("tier", ""),
            "status": "missing",
            "before_sha256": entry.get("sha256", ""),
            "after_sha256": "",
            "estimated_tokens": entry.get("estimated_tokens", 0),
        }

    after_sha256 = sha256_for_file(target)
    status = "unchanged" if after_sha256 == entry.get("sha256", "") else "changed"
    return {
        "path": relative_path,
        "tier": entry.get("tier", ""),
        "status": status,
        "before_sha256": entry.get("sha256", ""),
        "after_sha256": after_sha256,
        "estimated_tokens": entry.get("estimated_tokens", 0),
    }


def build_drift_report(lock_manifest: dict, root: Path) -> dict:
    locked_files = lock_manifest.get("locked_files", {}) if isinstance(lock_manifest.get("locked_files", {}), dict) else {}
    entries = []
    for tier in ("primary", "secondary"):
        for item in locked_files.get(tier, []):
            if isinstance(item, dict) and item.get("exists", True):
                entries.append(check_entry(root, item))

    changed = [entry for entry in entries if entry["status"] == "changed"]
    missing = [entry for entry in entries if entry["status"] == "missing"]
    unchanged = [entry for entry in entries if entry["status"] == "unchanged"]
    reread_first = [entry["path"] for entry in changed + missing]

    return {
        "schema_version": "1",
        "goal": lock_manifest.get("goal", ""),
        "profile_id": lock_manifest.get("profile_id", ""),
        "input_manifest": lock_manifest.get("current_wp", {}),
        "drift_status": "clean" if not changed and not missing else "drifted",
        "counts": {
            "locked": len(entries),
            "unchanged": len(unchanged),
            "changed": len(changed),
            "missing": len(missing),
        },
        "reread_first": reread_first,
        "changed": changed,
        "missing": missing,
        "commands": {
            "rebuild_context_lock": f"python3 scripts/export_context_lock.py --goal {lock_manifest.get('goal', 'plan-and-learn')} --json",
        },
    }


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    root = Path(args.root).resolve()
    manifest = load_structured_file(input_path)
    report = build_drift_report(manifest, root)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(report, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
