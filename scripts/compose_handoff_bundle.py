#!/usr/bin/env python3
"""
Compose a reusable handoff bundle from current packet, context bundle,
planning fit report, and replay-driven next packet recommendation.

Usage:
  python3 scripts/compose_handoff_bundle.py --json
"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path
import sys

import yaml

from check_planning_fit import GOAL_TO_ARCH_PROFILE, build_fit_report
from export_context_bundle import (
    CONSTRAINTS_PATH,
    CURRENT_WP_PATH,
    ROUTING_PATH,
    build_bundle,
    infer_goal_from_current_wp,
    load_yaml,
)
from generate_replay_packet import build_replay_packet


ROOT = Path(__file__).resolve().parent.parent
ADAPTER_REGISTRY_PATH = ROOT / "master-shell" / "catalog" / "adapter-registry.yaml"
ADAPTER_COMPATIBILITY_PATH = ROOT / "master-shell" / "catalog" / "adapter-compatibility-matrix.yaml"
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compose Workflow OS handoff bundle")
    parser.add_argument("--goal", choices=sorted(GOAL_TO_ARCH_PROFILE.keys()), default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def build_handoff_bundle(goal: str, current_wp: dict) -> dict:
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    adapter_registry = load_yaml(ADAPTER_REGISTRY_PATH)
    compatibility_catalog = load_yaml(ADAPTER_COMPATIBILITY_PATH)
    context_bundle = build_bundle(goal, current_wp, routing_catalog, constraints)
    fit_report = build_fit_report(goal, current_wp, routing_catalog, constraints, adapter_registry, compatibility_catalog)
    replay_packet = build_replay_packet(current_wp)
    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "current_packet": {
            "id": current_wp.get("id", ""),
            "goal": current_wp.get("goal", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
            "status": current_wp.get("status", ""),
        },
        "context_bundle": context_bundle,
        "fit_report": fit_report,
        "replay_next_packet": replay_packet,
        "commands": {
            "context_bundle_json": f"python3 scripts/export_context_bundle.py --goal {goal} --json",
            "fit_report_json": f"python3 scripts/check_planning_fit.py --goal {goal} --json",
            "replay_packet_json": "python3 scripts/generate_replay_packet.py --json",
            "handoff_bundle_json": f"python3 scripts/compose_handoff_bundle.py --goal {goal} --json",
        },
        "sequence": [
            "context bundle을 export해 최소 읽기 묶음을 고정한다",
            "fit report로 코어 제약과 adapter 적합성을 점검한다",
            "replay next packet으로 다음 실행 초안을 읽는다",
            "필요 시 execution packet export/apply 흐름으로 current-wp를 갱신한다",
        ],
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    bundle = build_handoff_bundle(goal, current_wp)

    if args.json:
        rendered = json.dumps(bundle, indent=2, ensure_ascii=False)
    else:
        rendered = yaml.dump(bundle, allow_unicode=True, default_flow_style=False, sort_keys=False)

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.write_text(rendered, encoding="utf-8")
        print(str(output_path))
        return

    print(rendered)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
