#!/usr/bin/env python3
"""
Generate a token ROI report from context lock, reread queue, and exception routing.

Usage:
  python3 scripts/generate_token_roi_report.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CONSTRAINTS_PATH, CURRENT_WP_PATH, ROUTING_PATH, infer_goal_from_current_wp, load_yaml
from export_context_lock import build_context_lock
from generate_exception_routing_patch import build_exception_routing_patch
from generate_reread_queue import build_reread_queue
from check_context_drift import ROOT, build_drift_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS token ROI report")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def matches_any(path_value: str, prefixes: list[str]) -> bool:
    return any(path_value == prefix or path_value.startswith(f"{prefix.rstrip('/')}/") for prefix in prefixes if prefix)


def build_token_roi_report(goal: str, current_wp: dict) -> dict:
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    context_lock = build_context_lock(goal, current_wp, routing_catalog, constraints)
    drift_report = build_drift_report(context_lock, ROOT)
    reread_queue = build_reread_queue(drift_report)
    routing_patch = build_exception_routing_patch(goal, current_wp)

    promote = routing_patch.get("routing_patch", {}).get("promote_to_must_read", [])
    keep_expand = routing_patch.get("routing_patch", {}).get("keep_expand_if_needed", [])
    secondary_entries = (context_lock.get("locked_files", {}) or {}).get("secondary", [])

    promote_candidates = []
    keep_secondary = []
    defer_candidates = []
    for entry in secondary_entries:
        path_value = entry.get("requested_path") or entry.get("path", "")
        simplified = {
            "path": path_value,
            "estimated_tokens": int(entry.get("estimated_tokens", 0)),
        }
        if matches_any(path_value, promote):
            promote_candidates.append(simplified)
        elif matches_any(path_value, keep_expand):
            keep_secondary.append(simplified)
        else:
            defer_candidates.append(simplified)

    defer_candidates.sort(key=lambda item: (-item["estimated_tokens"], item["path"]))
    promote_candidates.sort(key=lambda item: (-item["estimated_tokens"], item["path"]))
    keep_secondary.sort(key=lambda item: (-item["estimated_tokens"], item["path"]))
    reread_hotspots = (reread_queue.get("reread_queue") or [])[:5]
    estimated_savings = sum(item["estimated_tokens"] for item in defer_candidates[:5])

    return {
        "schema_version": "1",
        "goal": goal,
        "locked_tokens": int((context_lock.get("summary") or {}).get("total", {}).get("estimated_tokens", 0)),
        "estimated_savings_tokens": estimated_savings,
        "promote_to_primary": promote_candidates[:5],
        "keep_secondary": keep_secondary[:5],
        "defer_or_drop": defer_candidates[:5],
        "reread_hotspots": [
            {
                "path": item.get("path", ""),
                "tier": item.get("tier", ""),
                "estimated_tokens": int(item.get("estimated_tokens", 0)),
            }
            for item in reread_hotspots
        ],
        "commands": {
            "token_roi_json": "python3 scripts/generate_token_roi_report.py --json",
            "context_lock_json": f"python3 scripts/export_context_lock.py --goal {goal} --json",
            "exception_routing_json": f"python3 scripts/generate_exception_routing_patch.py --goal {goal} --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_token_roi_report(goal, current_wp)

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
