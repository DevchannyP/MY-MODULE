#!/usr/bin/env python3
"""
Generate a benchmark-backed starter preset for the current goal.

Usage:
  python3 scripts/generate_starter_preset.py --goal plan-and-learn --json
"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_benchmark_pack import BENCHMARK_PATH, build_benchmark_pack
from promote_packet import GOAL_TO_TEMPLATE_ID


ROOT = Path(__file__).resolve().parent.parent
PLANNING_MODES_PATH = ROOT / "master-shell" / "catalog" / "planning-studio-modes.yaml"
ROUTING_PATH = ROOT / "master-shell" / "catalog" / "context-routing-profiles.yaml"

GOAL_TO_PLANNING_MODE = {
    "plan-and-learn": "master-prd",
    "module-extension": "cycle-brief",
    "stateful-ops": "change-control",
}

GOAL_TO_ROUTING_PROFILE = {
    "plan-and-learn": "plan-and-learn-routing",
    "module-extension": "module-extension-routing",
    "stateful-ops": "stateful-ops-routing",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS starter preset")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def select_mode(mode_id: str, catalog: dict) -> dict:
    for mode in catalog.get("modes", []):
        if isinstance(mode, dict) and mode.get("id") == mode_id:
            return mode
    return {}


def select_routing(profile_id: str, catalog: dict) -> dict:
    for profile in catalog.get("profiles", []):
        if isinstance(profile, dict) and profile.get("id") == profile_id:
            return profile
    return {}


def build_starter_preset(goal: str, current_wp: dict) -> dict:
    planning_mode_catalog = load_yaml(PLANNING_MODES_PATH)
    routing_catalog = load_yaml(ROUTING_PATH)
    benchmark_catalog = load_yaml(BENCHMARK_PATH)
    benchmark_pack = build_benchmark_pack(goal, current_wp, benchmark_catalog)

    mode = select_mode(GOAL_TO_PLANNING_MODE[goal], planning_mode_catalog)
    routing = select_routing(GOAL_TO_ROUTING_PROFILE[goal], routing_catalog)
    recommended_focuses = benchmark_pack.get("recommended_focuses", [])
    section_defaults = {
        "master-prd": {
            "problem": mode.get("summary", ""),
            "north_star": recommended_focuses[0]["title"] if recommended_focuses else "",
            "module_boundary": f"{current_wp.get('type', 'planning')} / {current_wp.get('stage', 'A')}",
            "adapter_strategy": "benchmark-backed focus와 current profile을 유지하며 필요한 adapter만 추가한다.",
            "operator_view": "Launch Brief, Context Lock, Promotion Readiness, Live Ops Feed를 함께 본다.",
        },
        "cycle-brief": {
            "cycle_goal": recommended_focuses[0]["title"] if recommended_focuses else "",
            "must_not_slip": mode.get("preserve_essence", ""),
            "review_cadence": "short packet -> fit check -> promote pipeline -> smoke",
            "evidence": ", ".join(item.get("title", "") for item in recommended_focuses[:2]),
        },
        "change-control": {
            "change_request": recommended_focuses[0]["title"] if recommended_focuses else "",
            "core_guardrail": mode.get("preserve_essence", ""),
            "risk_and_observability": "promotion readiness와 context drift를 함께 확인한다.",
            "rollback": current_wp.get("rollback", ""),
        },
    }
    selected_sections = section_defaults.get(mode.get("id", ""), {})

    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "current_wp": {
            "id": current_wp.get("id", ""),
            "status": current_wp.get("status", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "planning_mode": {
            "id": mode.get("id", ""),
            "title": mode.get("title", ""),
            "summary": mode.get("summary", ""),
        },
        "routing_profile": {
            "id": routing.get("id", ""),
            "objective": routing.get("objective", ""),
            "max_primary_files": routing.get("max_primary_files", 0),
            "max_secondary_files": routing.get("max_secondary_files", 0),
        },
        "execution_template_id": GOAL_TO_TEMPLATE_ID[goal],
        "recommended_focus_ids": [item.get("id", "") for item in recommended_focuses],
        "recommended_focuses": [
            {
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "score": item.get("score", 0),
                "reasons": item.get("reasons", []),
            }
            for item in recommended_focuses
        ],
        "commands": {
            "benchmark_pack_json": benchmark_pack.get("commands", {}).get("benchmark_pack_json", ""),
            "promote_json": benchmark_pack.get("commands", {}).get("promote_json", ""),
            "starter_preset_json": f"python3 scripts/generate_starter_preset.py --goal {goal} --json",
        },
        "editable_defaults": {
            "project_frame": mode.get("summary", ""),
            "preserve_essence": mode.get("preserve_essence", ""),
            "focus_now": recommended_focuses[0]["title"] if recommended_focuses else "",
            "focus_next": recommended_focuses[1]["title"] if len(recommended_focuses) > 1 else "",
        },
        "planning_sections": [
            {"id": section_id, "value": value}
            for section_id, value in selected_sections.items()
            if value
        ],
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    preset = build_starter_preset(goal, current_wp)

    if args.json:
        rendered = json.dumps(preset, indent=2, ensure_ascii=False)
    else:
        rendered = yaml.dump(preset, allow_unicode=True, default_flow_style=False, sort_keys=False)

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
