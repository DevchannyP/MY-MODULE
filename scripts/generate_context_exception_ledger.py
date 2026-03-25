#!/usr/bin/env python3
"""
Generate a bounded exception ledger for additional context reads.

Usage:
  python3 scripts/generate_context_exception_ledger.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CONSTRAINTS_PATH, CURRENT_WP_PATH, ROUTING_PATH, build_bundle, infer_goal_from_current_wp, load_yaml


PRIMARY_TOKEN_LIMIT = 6000
TOTAL_TOKEN_LIMIT = 18000
MAX_EXCEPTION_FILES = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS context exception ledger")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_context_exception_ledger(goal: str, current_wp: dict) -> dict:
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    bundle = build_bundle(goal, current_wp, routing_catalog, constraints)
    primary_used = int((bundle.get("budget") or {}).get("primary", {}).get("estimated_tokens", 0))
    total_used = int((bundle.get("budget") or {}).get("total_estimated_tokens", 0))
    primary_headroom = max(0, PRIMARY_TOKEN_LIMIT - primary_used)
    total_headroom = max(0, TOTAL_TOKEN_LIMIT - total_used)

    candidates = []
    for source_key, source_tier in (("read_next", "secondary"), ("read_later", "deferred")):
        for item in (bundle.get("path_metrics") or {}).get(source_key, []):
            if not isinstance(item, dict):
                continue
            candidates.append({
                "path": item.get("path", ""),
                "source_tier": source_tier,
                "estimated_tokens": int(item.get("estimated_tokens", 0)),
                "file_count": int(item.get("file_count", 0)),
            })

    candidates.sort(key=lambda item: (item["source_tier"] != "secondary", item["estimated_tokens"], item["path"]))

    consumed = 0
    granted = 0
    exceptions = []
    for item in candidates:
        fits = granted < MAX_EXCEPTION_FILES and consumed + item["estimated_tokens"] <= total_headroom
        if fits:
            consumed += item["estimated_tokens"]
            granted += 1
        exceptions.append({
            **item,
            "decision": "allow-on-demand" if fits else "defer",
            "can_promote_to_primary": item["source_tier"] == "secondary" and item["estimated_tokens"] <= primary_headroom,
            "reason": (
                "남은 total token headroom 안에서만 예외 읽기를 허용합니다"
                if fits
                else "현재 packet의 token headroom을 넘기므로 deferred 상태를 유지합니다"
            ),
        })

    return {
        "schema_version": "1",
        "goal": goal,
        "current_wp": {
            "id": current_wp.get("id", ""),
            "status": current_wp.get("status", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "base_budget": {
            "primary_used_tokens": primary_used,
            "total_used_tokens": total_used,
            "primary_headroom_tokens": primary_headroom,
            "total_headroom_tokens": total_headroom,
        },
        "allowed_exception_count": sum(1 for item in exceptions if item["decision"] == "allow-on-demand"),
        "exceptions": exceptions[:8],
        "commands": {
            "context_exception_json": "python3 scripts/generate_context_exception_ledger.py --json",
            "context_bundle_json": f"python3 scripts/export_context_bundle.py --goal {goal} --json",
            "context_lock_json": f"python3 scripts/export_context_lock.py --goal {goal} --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    ledger = build_context_exception_ledger(goal, current_wp)

    if args.json:
        print(json.dumps(ledger, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(ledger, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
