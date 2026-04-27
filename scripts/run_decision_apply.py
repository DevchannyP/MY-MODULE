#!/usr/bin/env python3
"""
Execute the promotion pipeline only when the promotion decision gate is ready.

Usage:
  python3 scripts/run_decision_apply.py --json
  python3 scripts/run_decision_apply.py --apply --json
"""

from __future__ import annotations

import argparse
import json
import datetime
from pathlib import Path
import sys

import yaml

from apply_execution_packet import DEFAULT_NEXT_ACTIONS, save_yaml, update_next_actions
from compose_handoff_bundle import build_handoff_bundle
from export_context_bundle import CONSTRAINTS_PATH, CURRENT_WP_PATH, ROUTING_PATH, infer_goal_from_current_wp, load_yaml
from export_context_lock import build_context_lock
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from generate_blueprint_launch_deck import build_blueprint_launch_deck
from generate_promotion_decision import build_promotion_decision
from generate_starter_preset import build_starter_preset
from promote_packet import build_promotion_report


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ARTIFACT_ROOT = ROOT / "artifacts" / "decision-apply"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Workflow OS decision apply bridge")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--apply", action="store_true", help="Apply promoted packet only when decision gate is ready")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--artifact-dir", default=str(DEFAULT_ARTIFACT_ROOT / "latest"))
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    parser.add_argument("--next-actions-path", default=str(DEFAULT_NEXT_ACTIONS))
    return parser.parse_args()


def render(payload: dict, as_json: bool) -> str:
    if as_json:
        return json.dumps(payload, indent=2, ensure_ascii=False)
    return yaml.dump(payload, allow_unicode=True, default_flow_style=False, sort_keys=False)


def main() -> None:
    args = parse_args()
    current_wp_path = Path(args.current_wp_path).resolve()
    next_actions_path = Path(args.next_actions_path).resolve()
    current_wp = load_yaml(current_wp_path)
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    decision = build_promotion_decision(goal, current_wp)
    artifact_dir = Path(args.artifact_dir).resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    history_dir = artifact_dir.parent / "history"
    history_dir.mkdir(parents=True, exist_ok=True)

    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    benchmark_catalog = load_yaml(BENCHMARK_PATH)
    context_lock = build_context_lock(goal, current_wp, routing_catalog, constraints)
    handoff_bundle = build_handoff_bundle(goal, current_wp)
    benchmark_pack = build_benchmark_pack(goal, current_wp, benchmark_catalog)
    starter_preset = build_starter_preset(goal, current_wp)
    blueprint_launch = build_blueprint_launch_deck(goal, current_wp)
    promotion_report, promoted_packet = build_promotion_report(goal, current_wp)

    context_lock_path = artifact_dir / "context-lock.json"
    handoff_bundle_path = artifact_dir / "handoff-bundle.json"
    benchmark_pack_path = artifact_dir / "benchmark-pack.json"
    promoted_packet_path = artifact_dir / "promoted-packet.yaml"
    bridge_report_path = artifact_dir / "decision-apply-report.json"

    context_lock_path.write_text(json.dumps(context_lock, indent=2, ensure_ascii=False), encoding="utf-8")
    handoff_bundle_path.write_text(json.dumps(handoff_bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    benchmark_pack_path.write_text(json.dumps(benchmark_pack, indent=2, ensure_ascii=False), encoding="utf-8")
    promoted_packet_path.write_text(yaml.dump(promoted_packet, allow_unicode=True, default_flow_style=False, sort_keys=False), encoding="utf-8")

    report = {
        "schema_version": "1",
        "recorded_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "decision_gate": decision.get("gate_status", "review"),
        "ready_to_apply": bool(decision.get("ready_to_apply", False)),
        "starter_signature": {
            "planning_mode_id": starter_preset.get("planning_mode", {}).get("id", ""),
            "routing_profile_id": starter_preset.get("routing_profile", {}).get("id", ""),
            "execution_template_id": starter_preset.get("execution_template_id", ""),
            "blueprint_id": blueprint_launch.get("blueprint", {}).get("id", ""),
        },
        "recommended_next_command": decision.get("recommended_next_command", ""),
        "artifacts": {
            "context_lock": str(context_lock_path),
            "handoff_bundle": str(handoff_bundle_path),
            "benchmark_pack": str(benchmark_pack_path),
            "promoted_packet": str(promoted_packet_path),
            "decision_apply_report": str(bridge_report_path),
        },
        "commands": {
            "decision_json": "python3 scripts/generate_promotion_decision.py --json",
            "decision_apply_json": f"python3 scripts/run_decision_apply.py --goal {goal} --json",
            "decision_apply_execute_json": f"python3 scripts/run_decision_apply.py --goal {goal} --apply --json",
        },
    }

    if args.apply:
        if not decision.get("ready_to_apply", False):
            report["result"] = "blocked"
            report["reason"] = "promotion decision gate is not ready"
        else:
            save_yaml(current_wp_path, promoted_packet)
            next_actions_after = update_next_actions(load_yaml(next_actions_path), promoted_packet)
            save_yaml(next_actions_path, next_actions_after)
            report["result"] = "applied"
            report["next_actions_next_wp"] = next_actions_after.get("next_wp")
            report["promoted_packet_id"] = promoted_packet.get("id")
    else:
        report["result"] = "dry-run"

    bridge_report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    history_path = history_dir / f"{report['recorded_at'].replace(':', '-').replace('.', '-')}.json"
    history_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(render(report, args.json))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
