#!/usr/bin/env python3
"""
Summarize recent decision/apply bridge reports.

Usage:
  python3 scripts/generate_apply_timeline.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
TIMELINE_DIR = ROOT / "artifacts" / "decision-apply" / "history"
LATEST_REPORT = ROOT / "artifacts" / "decision-apply" / "latest" / "decision-apply-report.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS apply timeline")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    return parser.parse_args()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_apply_timeline() -> dict:
    items = []
    if TIMELINE_DIR.exists():
        for path in sorted(TIMELINE_DIR.glob("*.json"), reverse=True)[:6]:
            payload = load_json(path)
            items.append({
                "recorded_at": payload.get("recorded_at", path.stem),
                "goal": payload.get("goal", ""),
                "decision_gate": payload.get("decision_gate", ""),
                "result": payload.get("result", ""),
                "ready_to_apply": bool(payload.get("ready_to_apply", False)),
                "promoted_packet_id": payload.get("promoted_packet_id", ""),
            })

    if not items:
        latest = load_json(LATEST_REPORT)
        if latest:
            items.append({
                "recorded_at": "latest",
                "goal": latest.get("goal", ""),
                "decision_gate": latest.get("decision_gate", ""),
                "result": latest.get("result", ""),
                "ready_to_apply": bool(latest.get("ready_to_apply", False)),
                "promoted_packet_id": latest.get("promoted_packet_id", ""),
            })

    return {
        "schema_version": "1",
        "entry_count": len(items),
        "timeline": items,
        "commands": {
            "apply_timeline_json": "python3 scripts/generate_apply_timeline.py --json",
            "decision_apply_json": "python3 scripts/run_decision_apply.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    payload = build_apply_timeline()

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(payload, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
