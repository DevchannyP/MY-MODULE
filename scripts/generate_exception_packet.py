#!/usr/bin/env python3
"""
Generate a bounded exception packet draft from allowed extra context.

Usage:
  python3 scripts/generate_exception_packet.py --json
"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_context_exception_ledger import build_context_exception_ledger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS exception packet draft")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_exception_packet(goal: str, current_wp: dict) -> dict:
    ledger = build_context_exception_ledger(goal, current_wp)
    allowed = [item for item in ledger.get("exceptions", []) if item.get("decision") == "allow-on-demand"]
    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "mode": "exception-context",
        "current_wp": {
            "id": current_wp.get("id", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "allowed_paths": [item.get("path", "") for item in allowed],
        "candidate_primary_promotions": [item.get("path", "") for item in allowed if item.get("can_promote_to_primary")],
        "total_exception_tokens": sum(int(item.get("estimated_tokens", 0)) for item in allowed),
        "trigger_conditions": [
            "primary read만으로 답이 닫히지 않을 때만 exception packet을 연다",
            "allowed-on-demand로 표시된 경로만 추가로 읽는다",
            "예외 읽기 후에도 코어 보호 범위와 scope_out은 유지한다",
        ],
        "prompt_block": "\n".join([
            "Exception packet rule:",
            "1. primary read가 부족하다고 증명된 경우에만 아래 허용 경로를 읽는다.",
            "2. 허용되지 않은 secondary/deferred 파일은 읽지 않는다.",
            "3. 읽은 뒤에는 validation 또는 evidence 판단으로 바로 환원한다.",
        ]),
        "commands": {
            "exception_packet_json": "python3 scripts/generate_exception_packet.py --json",
            "context_exception_json": "python3 scripts/generate_context_exception_ledger.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    packet = build_exception_packet(goal, current_wp)

    if args.json:
        print(json.dumps(packet, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(packet, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
