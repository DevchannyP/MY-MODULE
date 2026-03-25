#!/usr/bin/env python3
"""
Generate a mapped planning-studio tuning patch from capability seed, apply history,
and repeated exception routing signals.

Usage:
  python3 scripts/generate_capability_seed_tuning.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, infer_goal_from_current_wp, load_yaml
from generate_apply_timeline import build_apply_timeline
from generate_capability_planning_seed import build_capability_planning_seed
from generate_exception_routing_patch import build_exception_routing_patch


SECTION_LABELS = {
    "master-prd": {
        "problem": "문제 정의",
        "north_star": "성공 지표",
        "module_boundary": "모듈 경계",
        "adapter_strategy": "어댑터 전략",
        "operator_view": "운영자/학습자 화면",
    },
    "cycle-brief": {
        "cycle_goal": "이번 사이클 목표",
        "must_not_slip": "밀리면 안 되는 것",
        "review_cadence": "리뷰 리듬",
        "evidence": "증적",
    },
    "change-control": {
        "change_request": "변경 요청",
        "core_guardrail": "코어 가드레일",
        "risk_and_observability": "리스크와 관측",
        "rollback": "롤백",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS capability seed tuning patch")
    parser.add_argument("--goal", choices=["plan-and-learn", "module-extension", "stateful-ops"], default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def join_preview(items: list[str], fallback: str, limit: int = 2) -> str:
    values = [item for item in items if isinstance(item, str) and item]
    if not values:
        return fallback
    return ", ".join(values[:limit])


def map_seed_sections(mode_id: str, seed_map: dict[str, str], latest_apply: dict, routing_patch: dict) -> list[dict]:
    promote = routing_patch.get("promote_to_must_read", [])
    keep_expand = routing_patch.get("keep_expand_if_needed", [])
    review_later = routing_patch.get("review_later", [])
    latest_gate = latest_apply.get("decision_gate", "review") or "review"
    latest_result = latest_apply.get("result", "dry-run") or "dry-run"
    promoted_packet_id = latest_apply.get("promoted_packet_id", "") or "다음 packet 미확정"

    benchmark_focus = seed_map.get("benchmark_focus", "benchmark focus를 적는다.")
    capability_goal = seed_map.get("capability_goal", "현재 capability 흐름을 적는다.")
    next_ready = seed_map.get("next_ready", "다음 ready packet을 적는다.")
    blocked_risk = seed_map.get("blocked_risk", "현재 blocked packet 없음")
    routing_summary = (
        f"must-read 승격 후보: {join_preview(promote, '없음')}; "
        f"expand 유지: {join_preview(keep_expand, '없음')}; "
        f"review later: {join_preview(review_later, '없음')}"
    )
    timeline_summary = f"최근 apply gate {latest_gate} / result {latest_result} / packet {promoted_packet_id}"

    if mode_id == "cycle-brief":
        section_values = {
            "cycle_goal": capability_goal,
            "must_not_slip": f"{blocked_risk}. 코어 경계와 최소 문맥 원칙은 유지한다.",
            "review_cadence": f"{timeline_summary}. review 시 {join_preview(promote, '예외 승격 후보 없음')}를 먼저 점검한다.",
            "evidence": f"{benchmark_focus}. routing 보정: {join_preview(promote, '없음')}",
        }
    elif mode_id == "change-control":
        section_values = {
            "change_request": capability_goal,
            "core_guardrail": f"{blocked_risk}. promote_to_must_read는 edge routing에만 반영한다.",
            "risk_and_observability": f"{timeline_summary}. {routing_summary}",
            "rollback": "gate가 ready가 아니면 최근 snapshot과 planning studio 기본값으로 즉시 되돌린다.",
        }
    else:
        section_values = {
            "problem": capability_goal,
            "north_star": f"{benchmark_focus}. 최근 gate는 {latest_gate} 상태를 유지해야 한다.",
            "module_boundary": f"next ready: {next_ready}. blocked risk: {blocked_risk}",
            "adapter_strategy": routing_summary,
            "operator_view": f"{timeline_summary}. GUI에서는 apply timeline, readiness, exception replay를 함께 본다.",
        }

    labels = SECTION_LABELS.get(mode_id, {})
    return [
        {"id": section_id, "label": labels.get(section_id, section_id), "value": value}
        for section_id, value in section_values.items()
        if value
    ]


def build_capability_seed_tuning(goal: str, current_wp: dict) -> dict:
    seed = build_capability_planning_seed(goal, current_wp)
    timeline = build_apply_timeline()
    routing_patch = build_exception_routing_patch(goal, current_wp)
    seed_map = {
        item.get("id", ""): item.get("value", "")
        for item in seed.get("seed_sections", [])
        if isinstance(item, dict) and item.get("id")
    }
    latest_apply = (timeline.get("timeline") or [{}])[0]
    mode_id = seed.get("planning_mode", {}).get("id", "")

    return {
        "schema_version": "1",
        "goal": goal,
        "capability": seed.get("capability", {}),
        "planning_mode": seed.get("planning_mode", {}),
        "latest_apply": latest_apply,
        "routing_patch": routing_patch.get("routing_patch", {}),
        "mapped_sections": map_seed_sections(mode_id, seed_map, latest_apply, routing_patch.get("routing_patch", {})),
        "notes": [
            "capability seed를 Planning Studio 실제 section id에 맞게 다시 매핑합니다.",
            "최근 apply gate/result와 repeated exception routing 후보를 planning 기본값에 반영합니다.",
            "반복 예외는 section text에서 must-read/expand-if-needed 보정 근거로 남깁니다.",
        ],
        "commands": {
            "capability_seed_tuning_json": "python3 scripts/generate_capability_seed_tuning.py --json",
            "capability_seed_json": "python3 scripts/generate_capability_planning_seed.py --json",
            "apply_timeline_json": "python3 scripts/generate_apply_timeline.py --json",
            "exception_routing_json": "python3 scripts/generate_exception_routing_patch.py --json",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    payload = build_capability_seed_tuning(goal, current_wp)

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
