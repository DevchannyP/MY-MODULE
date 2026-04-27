#!/usr/bin/env python3
"""
Generate an apply outcome scorecard from decision/apply history and current context state.

Usage:
  python3 scripts/generate_apply_outcome_scorecard.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from check_context_drift import ROOT, build_drift_report
from export_context_bundle import CONSTRAINTS_PATH, CURRENT_WP_PATH, ROUTING_PATH, infer_goal_from_current_wp, load_yaml
from export_context_lock import build_context_lock
from generate_apply_timeline import build_apply_timeline
from generate_exception_routing_patch import build_exception_routing_patch
from generate_promotion_decision import build_promotion_decision
from generate_reread_queue import build_reread_queue


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS apply outcome scorecard")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_apply_outcome_scorecard(goal: str, current_wp: dict) -> dict:
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    context_lock = build_context_lock(goal, current_wp, routing_catalog, constraints)
    drift_report = build_drift_report(context_lock, ROOT)
    reread_queue = build_reread_queue(drift_report)
    timeline = build_apply_timeline()
    decision = build_promotion_decision(goal, current_wp)
    exception_routing = build_exception_routing_patch(goal, current_wp)

    entries = timeline.get("timeline", [])
    entry_count = len(entries)
    ready_count = sum(1 for item in entries if item.get("decision_gate") == "ready")
    review_count = sum(1 for item in entries if item.get("decision_gate") == "review")
    blocked_count = sum(1 for item in entries if item.get("decision_gate") == "blocked")
    applied_count = sum(1 for item in entries if item.get("result") == "applied")

    primary_tokens = int((context_lock.get("summary") or {}).get("primary", {}).get("estimated_tokens", 0))
    secondary_tokens = int((context_lock.get("summary") or {}).get("secondary", {}).get("estimated_tokens", 0))
    locked_tokens = int((context_lock.get("summary") or {}).get("total", {}).get("estimated_tokens", 0))
    reread_tokens = sum(int(item.get("estimated_tokens", 0)) for item in reread_queue.get("reread_queue", []))
    reread_ratio = round(reread_tokens / max(1, locked_tokens), 2)
    promote_candidates = len((exception_routing.get("routing_patch") or {}).get("promote_to_must_read", []))

    score = 100
    if decision.get("gate_status") != "ready":
        score -= 10
    score -= min(20, int(reread_ratio * 20))
    score -= min(10, blocked_count * 2)
    score += min(10, applied_count * 2)
    score = max(0, min(100, score))

    action_items = []
    if reread_queue.get("reread_count", 0) > 0:
        action_items.append("changed/missing reread queue를 먼저 비우고 나서 apply 판단을 다시 한다.")
    if promote_candidates > 0:
        action_items.append("반복 exception 경로를 capability seed tuning 또는 routing profile 보정으로 올린다.")
    if decision.get("gate_status") != "ready":
        action_items.append("promotion decision gate를 ready로 바꾸는 fit/lock 조건부터 정리한다.")
    if not action_items:
        action_items.append("현재 score가 안정 범위이므로 다음 execution packet 승격과 smoke 검증을 이어간다.")

    return {
        "schema_version": "1",
        "goal": goal,
        "score": score,
        "current_gate": decision.get("gate_status", "review"),
        "history_window": {
            "entry_count": entry_count,
            "ready_count": ready_count,
            "review_count": review_count,
            "blocked_count": blocked_count,
            "applied_count": applied_count,
        },
        "token_efficiency": {
            "primary_tokens": primary_tokens,
            "secondary_tokens": secondary_tokens,
            "locked_tokens": locked_tokens,
            "reread_tokens": reread_tokens,
            "reread_ratio": reread_ratio,
        },
        "routing_feedback": {
            "promote_to_must_read": (exception_routing.get("routing_patch") or {}).get("promote_to_must_read", []),
            "keep_expand_if_needed": (exception_routing.get("routing_patch") or {}).get("keep_expand_if_needed", []),
        },
        "action_items": action_items,
        "commands": {
            "apply_outcome_scorecard_json": "python3 scripts/generate_apply_outcome_scorecard.py --json",
            "decision_apply_json": "python3 scripts/run_decision_apply.py --json",
            "promotion_decision_json": "python3 scripts/generate_promotion_decision.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_apply_outcome_scorecard(goal, current_wp)

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
