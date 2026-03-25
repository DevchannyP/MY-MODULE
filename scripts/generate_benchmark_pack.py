#!/usr/bin/env python3
"""
Generate a benchmark-backed improvement pack for the current goal.

Usage:
  python3 scripts/generate_benchmark_pack.py --goal plan-and-learn --json
"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml


ROOT = Path(__file__).resolve().parent.parent
BENCHMARK_PATH = ROOT / "master-shell" / "catalog" / "benchmark-signals.yaml"

GOAL_TO_FOCUS_BOOSTS = {
    "plan-and-learn": {
        "master-planning-truth-surface": 5,
        "minimum-context-routing-performance": 5,
        "guided-learning-live-ops-cockpit": 5,
    },
    "module-extension": {
        "master-planning-truth-surface": 4,
        "minimum-context-routing-performance": 5,
        "guided-learning-live-ops-cockpit": 4,
    },
    "stateful-ops": {
        "master-planning-truth-surface": 4,
        "minimum-context-routing-performance": 5,
        "guided-learning-live-ops-cockpit": 5,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS benchmark action pack")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def ensure_list_of_strings(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def build_benchmark_pack(goal: str, current_wp: dict, catalog: dict) -> dict:
    signal_map = {
        signal.get("id"): signal
        for signal in catalog.get("signals", [])
        if isinstance(signal, dict) and isinstance(signal.get("id"), str)
    }
    focus_map = {
        focus.get("id"): focus
        for focus in catalog.get("improvement_focuses", [])
        if isinstance(focus, dict) and isinstance(focus.get("id"), str)
    }
    focuses = []
    type_value = current_wp.get("type", "")
    status_value = current_wp.get("status", "")
    boosts = GOAL_TO_FOCUS_BOOSTS.get(goal, {})

    for focus in catalog.get("essential_improvements", []):
        if not isinstance(focus, dict) or not isinstance(focus.get("id"), str):
            continue

        score = boosts.get(focus["id"], 1)
        reasons: list[str] = []
        if focus["id"] in boosts:
            reasons.append(f"{goal} 목표에 직접 맞는 focus입니다.")
        if type_value in {"governance", "infra", "executor"} and focus["id"] == "minimum-context-routing-performance":
            score += 1
            reasons.append("운영/검증형 current-wp에서 context lock과 reread 흐름의 ROI가 특히 큽니다.")
        if status_value == "completed" and focus["id"] == "master-planning-truth-surface":
            score += 1
            reasons.append("직전 packet이 completed 상태라 다음 계획 선택과 launch brief 고도화에 바로 이어지기 좋습니다.")
        if type_value in {"governance", "arch", "meta"} and focus["id"] == "guided-learning-live-ops-cockpit":
            score += 1
            reasons.append("코어 운영 흐름을 학습과 로그 surface로 같이 보여줄 가치가 큽니다.")

        benchmark_refs = ensure_list_of_strings(focus.get("benchmark_refs"))
        related_focuses = []
        for focus_id in ensure_list_of_strings(focus.get("related_focus_ids")):
            related = focus_map.get(focus_id)
            if not related:
                continue
            related_focuses.append({
                "id": focus_id,
                "title": related.get("title", ""),
            })
        focuses.append({
            "id": focus["id"],
            "title": focus.get("title", ""),
            "outcome": focus.get("objective", ""),
            "preserve_essence": focus.get("preserve_essence", ""),
            "delivered_by": ensure_list_of_strings(focus.get("delivered_by")),
            "why_now": ensure_list_of_strings(focus.get("why_now")),
            "related_focuses": related_focuses,
            "benchmark_signals": [signal_map[ref] for ref in benchmark_refs if ref in signal_map],
            "score": score,
            "reasons": reasons or ["현재 goal에서 재사용 가치가 높은 focus입니다."],
        })

    focuses.sort(key=lambda item: (-item["score"], item["id"]))
    recommended = focuses[:3]
    unique_sources: dict[str, dict] = {}
    for focus in recommended:
        for signal in focus["benchmark_signals"]:
            unique_sources.setdefault(signal["id"], {
                "id": signal["id"],
                "product": signal.get("product", ""),
                "region": signal.get("region", ""),
                "source_url": signal.get("source_url", ""),
            })

    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "current_wp": {
            "id": current_wp.get("id", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
            "status": current_wp.get("status", ""),
        },
        "benchmark_review": catalog.get("benchmark_review", {}),
        "recommended_focuses": recommended,
        "commands": {
            "benchmark_pack_json": f"python3 scripts/generate_benchmark_pack.py --goal {goal} --json",
            "check_fit_json": f"python3 scripts/check_planning_fit.py --goal {goal} --json",
            "context_lock_json": f"python3 scripts/export_context_lock.py --goal {goal} --json",
            "promote_json": f"python3 scripts/promote_packet.py --goal {goal} --json",
        },
        "benchmark_sources": list(unique_sources.values()),
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    catalog = load_yaml(BENCHMARK_PATH)
    pack = build_benchmark_pack(goal, current_wp, catalog)

    if args.json:
        rendered = json.dumps(pack, indent=2, ensure_ascii=False)
    else:
        rendered = yaml.dump(pack, allow_unicode=True, default_flow_style=False, sort_keys=False)

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
