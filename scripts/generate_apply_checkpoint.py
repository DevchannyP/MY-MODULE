#!/usr/bin/env python3
"""
Generate a reviewable apply checkpoint before promoting the next packet.

Usage:
  python3 scripts/generate_apply_checkpoint.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_promotion_decision import build_promotion_decision
from promote_packet import build_promotion_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS apply checkpoint")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_apply_checkpoint(goal: str, current_wp: dict) -> dict:
    decision = build_promotion_decision(goal, current_wp)
    promotion_report, promoted_packet = build_promotion_report(goal, current_wp)
    return {
        "schema_version": "1",
        "goal": goal,
        "decision_gate": decision.get("gate_status", "review"),
        "ready_to_apply": bool(decision.get("ready_to_apply", False)),
        "current_wp": {
            "id": current_wp.get("id", ""),
            "status": current_wp.get("status", ""),
        },
        "post_apply_preview": {
            "promoted_packet_id": promoted_packet.get("id", ""),
            "promoted_packet_goal": promoted_packet.get("goal", ""),
            "promoted_packet_type": promoted_packet.get("type", ""),
            "promoted_packet_stage": promoted_packet.get("stage", ""),
        },
        "locked_context_budget": promotion_report.get("locked_context_budget", {}),
        "reasons": decision.get("reasons", []),
        "commands": {
            "apply_checkpoint_json": "python3 scripts/generate_apply_checkpoint.py --json",
            "decision_apply_json": f"python3 scripts/run_decision_apply.py --goal {goal} --json",
            "decision_apply_execute_json": f"python3 scripts/run_decision_apply.py --goal {goal} --apply --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_apply_checkpoint(goal, current_wp)

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
