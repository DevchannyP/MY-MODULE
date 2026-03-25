#!/usr/bin/env python3
"""
Generate a single ready/review/blocked gate for kickoff surfaces.

Usage:
  python3 scripts/generate_kickoff_ready_gate.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_kickoff_evidence_bundle import build_kickoff_evidence_bundle


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS kickoff ready gate")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_kickoff_ready_gate(goal: str, current_wp: dict) -> dict:
    evidence = build_kickoff_evidence_bundle(goal, current_wp)
    readiness = evidence.get("execution_readiness", {})
    score = int(readiness.get("score", 0))
    current_gate = readiness.get("current_gate", "review")

    gate_status = "ready"
    reasons = []
    if current_gate == "blocked" or score < 70:
        gate_status = "blocked"
        reasons.append("현재 kickoff evidence 기준으로 ready gate가 부족합니다.")
    elif current_gate != "ready" or score < 85:
        gate_status = "review"
        reasons.append("kickoff evidence는 충분하지만 바로 시작 전 한 번 더 검토하는 편이 안전합니다.")
    else:
        reasons.append("adaptive starter, kickoff step, readiness score가 모두 허용 범위 안입니다.")

    if len(evidence.get("kickoff_steps", [])) < 3:
        gate_status = "review" if gate_status == "ready" else gate_status
        reasons.append("kickoff step이 아직 짧아 launch brief 보강이 필요합니다.")

    next_actions = []
    if gate_status == "ready":
        next_actions.append("adaptive starter를 Planning Studio에 적용하고 launch brief를 export합니다.")
    else:
        next_actions.append("kickoff evidence와 adaptive starter section을 먼저 보강합니다.")
    if score < 85:
        next_actions.append("apply outcome scorecard와 kickoff evidence bundle을 다시 확인합니다.")

    return {
        "schema_version": "1",
        "goal": goal,
        "gate_status": gate_status,
        "score": score,
        "current_gate": current_gate,
        "reasons": reasons,
        "next_actions": next_actions,
        "commands": {
            "kickoff_ready_gate_json": "python3 scripts/generate_kickoff_ready_gate.py --json",
            "kickoff_evidence_json": evidence.get("commands", {}).get("kickoff_evidence_json", ""),
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_kickoff_ready_gate(goal, current_wp)

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
