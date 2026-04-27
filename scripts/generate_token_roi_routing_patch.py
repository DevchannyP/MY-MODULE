#!/usr/bin/env python3
"""
Generate a concrete routing patch from token ROI report.

Usage:
  python3 scripts/generate_token_roi_routing_patch.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_token_roi_report import build_token_roi_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS token ROI routing patch")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_token_roi_routing_patch(goal: str, current_wp: dict) -> dict:
    roi = build_token_roi_report(goal, current_wp)
    return {
        "schema_version": "1",
        "goal": goal,
        "routing_patch": {
            "promote_to_primary": [item.get("path", "") for item in roi.get("promote_to_primary", [])[:3]],
            "keep_secondary": [item.get("path", "") for item in roi.get("keep_secondary", [])[:3]],
            "move_to_deferred": [item.get("path", "") for item in roi.get("defer_or_drop", [])[:3]],
        },
        "estimated_savings_tokens": roi.get("estimated_savings_tokens", 0),
        "reread_hotspots": roi.get("reread_hotspots", [])[:3],
        "commands": {
            "token_roi_routing_json": "python3 scripts/generate_token_roi_routing_patch.py --json",
            "token_roi_json": roi.get("commands", {}).get("token_roi_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_token_roi_routing_patch(goal, current_wp)

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
