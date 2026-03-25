#!/usr/bin/env python3
"""
Generate a reread queue from the latest or provided context lock manifest.

Usage:
  python3 scripts/generate_reread_queue.py --json
  python3 scripts/generate_reread_queue.py --input artifacts/promotion-pipeline/latest/context-lock.json --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from check_context_drift import ROOT, build_drift_report, load_structured_file


DEFAULT_INPUT = ROOT / "artifacts" / "promotion-pipeline" / "latest" / "context-lock.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS reread queue from context drift")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to a context lock JSON/YAML file")
    parser.add_argument("--root", default=str(ROOT), help="Workspace root used to resolve locked file paths")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    return parser.parse_args()


def build_reread_queue(drift_report: dict) -> dict:
    reread_items = []
    for item in drift_report.get("changed", []) + drift_report.get("missing", []):
        reread_items.append({
            "path": item.get("path", ""),
            "tier": item.get("tier", ""),
            "status": item.get("status", ""),
            "estimated_tokens": item.get("estimated_tokens", 0),
        })

    reread_items.sort(key=lambda entry: (entry["tier"] != "primary", -int(entry.get("estimated_tokens", 0)), entry["path"]))
    return {
        "schema_version": "1",
        "goal": drift_report.get("goal", ""),
        "drift_status": drift_report.get("drift_status", "clean"),
        "reread_count": len(reread_items),
        "reread_queue": reread_items,
        "commands": {
            "context_drift_json": drift_report.get("commands", {}).get("rebuild_context_lock", ""),
            "reread_queue_json": "python3 scripts/generate_reread_queue.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    manifest = load_structured_file(Path(args.input).resolve())
    drift_report = build_drift_report(manifest, Path(args.root).resolve())
    queue = build_reread_queue(drift_report)

    if args.json:
        print(json.dumps(queue, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(queue, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
