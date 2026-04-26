#!/usr/bin/env python3
"""
Run the end-to-end promotion pipeline: handoff, context lock, benchmark pack,
promoted packet export, and optional apply.

Usage:
  python3 scripts/run_promotion_pipeline.py --goal plan-and-learn --json
  python3 scripts/run_promotion_pipeline.py --goal module-extension --apply --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from apply_execution_packet import DEFAULT_NEXT_ACTIONS, save_yaml, update_next_actions
from check_context_drift import build_drift_report
from compose_handoff_bundle import build_handoff_bundle
from export_context_bundle import CURRENT_WP_PATH, CONSTRAINTS_PATH, ROUTING_PATH, infer_goal_from_current_wp, load_yaml
from export_context_lock import build_context_lock
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from promote_packet import build_promotion_report


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ARTIFACT_ROOT = ROOT / "artifacts" / "promotion-pipeline"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Workflow OS promotion pipeline")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--apply", action="store_true", help="Apply the promoted packet if the pipeline is ready")
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
    artifact_dir = Path(args.artifact_dir).resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)

    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    benchmark_catalog = load_yaml(BENCHMARK_PATH)

    context_lock = build_context_lock(goal, current_wp, routing_catalog, constraints)
    handoff_bundle = build_handoff_bundle(goal, current_wp)
    benchmark_pack = build_benchmark_pack(goal, current_wp, benchmark_catalog)
    promotion_report, promoted_packet = build_promotion_report(goal, current_wp)
    drift_report = build_drift_report(context_lock, ROOT)

    context_lock_path = artifact_dir / "context-lock.json"
    handoff_bundle_path = artifact_dir / "handoff-bundle.json"
    benchmark_pack_path = artifact_dir / "benchmark-pack.json"
    promoted_packet_path = artifact_dir / "promoted-packet.yaml"
    pipeline_report_path = artifact_dir / "pipeline-report.json"

    context_lock_path.write_text(json.dumps(context_lock, indent=2, ensure_ascii=False), encoding="utf-8")
    handoff_bundle_path.write_text(json.dumps(handoff_bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    benchmark_pack_path.write_text(json.dumps(benchmark_pack, indent=2, ensure_ascii=False), encoding="utf-8")
    promoted_packet_path.write_text(yaml.dump(promoted_packet, allow_unicode=True, default_flow_style=False, sort_keys=False), encoding="utf-8")

    fit_counts = promotion_report.get("fit_counts", {})
    budget_risk = handoff_bundle.get("fit_report", {}).get("budget_risk", {})
    evidence_status = (
        "risk" if budget_risk.get("status") == "risk" or fit_counts.get("risk", 0) > 0
        else "warn" if budget_risk.get("status") == "warn" or fit_counts.get("warn", 0) > 0
        else "pass"
    )
    promotion_ready = promotion_report.get("promotion_ready", False)
    handoff_ready = evidence_status != "risk" and fit_counts.get("pass", 0) > 0

    report = {
        "schema_version": "1",
        "goal": goal,
        "promotion_ready": promotion_ready,
        "handoff_ready": handoff_ready,
        "handoff_bundle_path": str(handoff_bundle_path),
        "evidence_status": evidence_status,
        "drift_status": drift_report.get("drift_status", "unknown"),
        "promotion_handoff_conflict": promotion_ready != handoff_ready,
        "artifacts": {
            "context_lock": str(context_lock_path),
            "handoff_bundle": str(handoff_bundle_path),
            "benchmark_pack": str(benchmark_pack_path),
            "promoted_packet": str(promoted_packet_path),
            "pipeline_report": str(pipeline_report_path),
        },
        "fit_counts": fit_counts,
        "locked_context_budget": promotion_report.get("locked_context_budget", {}),
        "commands": {
            "context_drift_json": f"python3 scripts/check_context_drift.py --input {context_lock_path} --json",
            "promote_pipeline_json": f"python3 scripts/run_promotion_pipeline.py --goal {goal} --json",
            "promote_pipeline_apply_json": f"python3 scripts/run_promotion_pipeline.py --goal {goal} --apply --json",
        },
    }

    if args.apply:
        if not promotion_report.get("promotion_ready", False):
            report["result"] = "blocked"
            report["reason"] = "promotion pipeline is not ready"
        else:
            save_yaml(current_wp_path, promoted_packet)
            next_actions_after = update_next_actions(load_yaml(next_actions_path), promoted_packet)
            save_yaml(next_actions_path, next_actions_after)
            report["result"] = "applied"
            report["next_actions_next_wp"] = next_actions_after.get("next_wp")
    else:
        report["result"] = "dry-run"

    pipeline_report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(render(report, args.json))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
