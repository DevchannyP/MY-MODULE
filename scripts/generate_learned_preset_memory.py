#!/usr/bin/env python3
"""
Summarize learned starter preset patterns from decision/apply history.

Usage:
  python3 scripts/generate_learned_preset_memory.py --json
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_blueprint_launch_deck import build_blueprint_launch_deck
from generate_starter_preset import build_starter_preset


ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "artifacts" / "decision-apply" / "history"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS learned preset memory")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def load_history() -> list[dict]:
    items: list[dict] = []
    if not HISTORY_DIR.exists():
        return items
    for path in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
        payload = json.loads(path.read_text(encoding="utf-8"))
        items.append(payload)
    return items


def build_learning_sections(mode_id: str, starter_preset: dict, summary: dict) -> list[dict]:
    planning_sections = starter_preset.get("planning_sections", [])
    if not planning_sections:
        return []

    proven_path = (
        f"proven path: {summary.get('blueprint_id', '')} / "
        f"{summary.get('planning_mode_id', '')} / {summary.get('routing_profile_id', '')}"
    )
    ready_rate = f"ready {summary.get('ready_count', 0)}/{summary.get('entry_count', 0)}"
    applied_rate = f"applied {summary.get('applied_count', 0)}/{summary.get('entry_count', 0)}"
    adjustment = f"{proven_path}; {ready_rate}; {applied_rate}"

    updated_sections = []
    for index, section in enumerate(planning_sections):
        value = section.get("value", "")
        if index == 0:
            value = f"{value} {adjustment}".strip()
        elif section.get("id") in {"review_cadence", "risk_and_observability", "operator_view"}:
            value = f"{value} | learned memory: {adjustment}".strip()
        updated_sections.append({"id": section.get("id", ""), "value": value})
    return updated_sections


def build_learned_preset_memory(goal: str, current_wp: dict) -> dict:
    history = [item for item in load_history() if item.get("goal") == goal]
    starter_preset = build_starter_preset(goal, current_wp)
    blueprint_launch = build_blueprint_launch_deck(goal, current_wp)
    fallback = {
        "planning_mode_id": starter_preset.get("planning_mode", {}).get("id", ""),
        "routing_profile_id": starter_preset.get("routing_profile", {}).get("id", ""),
        "execution_template_id": starter_preset.get("execution_template_id", ""),
        "blueprint_id": blueprint_launch.get("blueprint", {}).get("id", ""),
        "entry_count": 0,
        "ready_count": 0,
        "applied_count": 0,
    }
    grouped: dict[tuple[str, str, str, str], dict] = defaultdict(lambda: {
        "entry_count": 0,
        "ready_count": 0,
        "applied_count": 0,
    })

    for item in history:
        signature = item.get("starter_signature", {}) if isinstance(item.get("starter_signature", {}), dict) else {}
        key = (
            signature.get("planning_mode_id") or fallback["planning_mode_id"],
            signature.get("routing_profile_id") or fallback["routing_profile_id"],
            signature.get("execution_template_id") or fallback["execution_template_id"],
            signature.get("blueprint_id") or fallback["blueprint_id"],
        )
        grouped[key]["entry_count"] += 1
        grouped[key]["ready_count"] += int(item.get("decision_gate") == "ready")
        grouped[key]["applied_count"] += int(item.get("result") == "applied")

    ranked = []
    for key, counts in grouped.items():
        ranked.append({
            "planning_mode_id": key[0],
            "routing_profile_id": key[1],
            "execution_template_id": key[2],
            "blueprint_id": key[3],
            **counts,
        })
    ranked.sort(
        key=lambda item: (
            -item["applied_count"],
            -item["ready_count"],
            -item["entry_count"],
            item["planning_mode_id"],
        )
    )

    best = ranked[0] if ranked else fallback

    return {
        "schema_version": "1",
        "goal": goal,
        "history_entries": len(history),
        "recommended_signature": best,
        "learning_sections": build_learning_sections(
            starter_preset.get("planning_mode", {}).get("id", ""),
            starter_preset,
            best,
        ),
        "top_signatures": ranked[:3] if ranked else [fallback],
        "commands": {
            "learned_preset_memory_json": "python3 scripts/generate_learned_preset_memory.py --json",
            "starter_preset_json": starter_preset.get("commands", {}).get("starter_preset_json", ""),
            "blueprint_launch_json": "python3 scripts/generate_blueprint_launch_deck.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_learned_preset_memory(goal, current_wp)

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
