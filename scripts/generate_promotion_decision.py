#!/usr/bin/env python3
"""
Generate a single promotion decision deck from readiness, fit, and reread state.

Usage:
  python3 scripts/generate_promotion_decision.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_readiness_brief import build_readiness_brief
from promote_packet import build_promotion_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS promotion decision deck")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_promotion_decision(goal: str, current_wp: dict) -> dict:
    readiness = build_readiness_brief(current_wp)
    promotion_report, _ = build_promotion_report(goal, current_wp)
    fit_counts = promotion_report.get("fit_counts", {})
    risk_count = int(fit_counts.get("risk", 0))
    warn_count = int(fit_counts.get("warn", 0))
    reread_count = int((readiness.get("reread_queue") or {}).get("reread_count", 0))
    promotion_ready = bool(promotion_report.get("promotion_ready"))

    gate_status = "ready"
    reasons = []
    if risk_count > 0:
        gate_status = "blocked"
        reasons.append(f"fit report risk {risk_count}건이 남아 있어 바로 승격할 수 없습니다")
    if not promotion_ready and gate_status != "blocked":
        gate_status = "review"
        reasons.append("locked context budget 또는 scope boundary를 다시 확인해야 합니다")
    if reread_count > 0 and gate_status != "blocked":
        gate_status = "review"
        reasons.append(f"changed/missing 파일 {reread_count}개를 reread queue 기준으로 먼저 재확인해야 합니다")
    if gate_status == "ready":
        reasons.append("primary/secondary lock, fit, reread 상태가 모두 허용 범위 안입니다")

    if gate_status == "ready":
        next_command = f"python3 scripts/run_promotion_pipeline.py --goal {goal} --apply --json"
    elif reread_count > 0:
        next_command = "python3 scripts/generate_reread_queue.py --json"
    else:
        next_command = f"python3 scripts/run_promotion_pipeline.py --goal {goal} --json"

    return {
        "schema_version": "1",
        "goal": goal,
        "gate_status": gate_status,
        "ready_to_apply": gate_status == "ready",
        "current_wp": {
            "id": current_wp.get("id", ""),
            "status": current_wp.get("status", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "fit_counts": fit_counts,
        "locked_tokens": int((promotion_report.get("locked_context_budget") or {}).get("locked_total_estimated_tokens", 0)),
        "reread_count": reread_count,
        "reasons": reasons,
        "recommended_next_command": next_command,
        "commands": {
            "decision_json": "python3 scripts/generate_promotion_decision.py --json",
            "promote_pipeline_json": f"python3 scripts/run_promotion_pipeline.py --goal {goal} --json",
            "promote_pipeline_apply_json": f"python3 scripts/run_promotion_pipeline.py --goal {goal} --apply --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    decision = build_promotion_decision(goal, current_wp)

    if args.json:
        print(json.dumps(decision, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(decision, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
