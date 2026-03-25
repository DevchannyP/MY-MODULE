#!/usr/bin/env python3
"""
Promote the current planning/replay state into a validated execution packet.

Usage:
  python3 scripts/promote_packet.py --goal plan-and-learn --json
  python3 scripts/promote_packet.py --goal module-extension --apply --output promoted-packet.yaml
"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path
import sys

import yaml

from apply_execution_packet import (
    DEFAULT_NEXT_ACTIONS,
    sanitize_packet,
    save_yaml,
    update_next_actions,
)
from check_planning_fit import (
    ADAPTER_COMPATIBILITY_PATH,
    ADAPTER_REGISTRY_PATH,
    GOAL_TO_ARCH_PROFILE,
    build_fit_report,
)
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
EXECUTION_TEMPLATE_PATH = ROOT / "master-shell" / "catalog" / "execution-packet-templates.yaml"

GOAL_TO_TEMPLATE_ID = {
    "plan-and-learn": "planner-implementation",
    "module-extension": "module-extension-packet",
    "stateful-ops": "ops-hardening-packet",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Promote Workflow OS packet with fit checks")
    parser.add_argument("--goal", choices=sorted(GOAL_TO_ARCH_PROFILE.keys()), default=None)
    parser.add_argument("--apply", action="store_true", help="Write promoted packet to current-wp and next-actions")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output packet file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    parser.add_argument("--next-actions-path", default=str(DEFAULT_NEXT_ACTIONS))
    return parser.parse_args()


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def load_execution_template(goal: str) -> dict:
    catalog = load_yaml(EXECUTION_TEMPLATE_PATH)
    template_id = GOAL_TO_TEMPLATE_ID[goal]
    for template in catalog.get("templates", []):
        if isinstance(template, dict) and template.get("id") == template_id:
            return template
    return {}


def derive_packet_id(goal: str) -> str:
    goal_suffix = {
        "plan-and-learn": "PLAN",
        "module-extension": "MOD",
        "stateful-ops": "OPS",
    }[goal]
    return f"WP-PROMOTE-{datetime.date.today().isoformat()}-{goal_suffix}"


def build_promoted_packet(goal: str, current_wp: dict, context_bundle: dict, fit_report: dict, replay_packet: dict, template: dict) -> dict:
    template_defaults = template.get("packet_defaults", {}) if isinstance(template.get("packet_defaults", {}), dict) else {}
    validation = dedupe_strings(
        list(template_defaults.get("validation", []))
        + list(replay_packet.get("validation", []))
        + [f"python3 scripts/check_planning_fit.py --goal {goal} --json"]
    )
    constraints = dedupe_strings(
        list(template_defaults.get("constraints", []))
        + list(context_bundle.get("core_guardrails", []))
        + ["primary/secondary context lock이 예산 안에 있는 packet만 승격한다"]
    )
    fail_if = dedupe_strings(
        list(current_wp.get("fail_if", []))
        + [
            "scope_out이 비어 코어 보호 범위가 흐려진다",
            "primary 또는 locked context token budget이 허용치를 초과한다",
        ]
    )
    scope_out = dedupe_strings(list(current_wp.get("scope_out", [])) + ["system OS core", "unrelated domains"])
    read_first = context_bundle.get("read_first", [])
    read_next = context_bundle.get("read_next", [])
    budget = context_bundle.get("budget", {})

    packet = {
        "id": derive_packet_id(goal),
        "goal": replay_packet.get("goal") or current_wp.get("goal") or "validated promotion packet을 실행한다",
        "type": template_defaults.get("type", "planning"),
        "stage": template_defaults.get("stage", "A"),
        "status": "in_progress",
        "scope_in": dedupe_strings(list(read_first) + list(read_next[:3])),
        "scope_out": scope_out,
        "constraints": constraints,
        "done_when": dedupe_strings([
            "replay에서 제안된 goal이 evidence와 함께 정리된다",
            f"primary read bundle {len(read_first)}개만으로 1차 구현/검증을 끝낸다",
            *[f"{command} 통과" for command in validation[:2]],
        ]),
        "fail_if": fail_if,
        "rollback": current_wp.get("rollback") or "승격 packet을 폐기하고 직전 current-wp 기준으로 되돌린다.",
        "subtasks": dedupe_strings([
            "context lock으로 exact read manifest를 고정한다",
            "fit report를 다시 확인하고 risk 0 상태를 유지한다",
            "필요 시 handoff bundle을 저장하고 apply 전에 dry-run을 확인한다",
        ]),
        "validation": validation,
        "evidence": dedupe_strings(list(current_wp.get("evidence", []))),
        "next_unlock": "승격 packet 완료 후 다음 adapter/module/runtime 확장 packet으로 넘긴다.",
        "contracts": {},
        "context_budget": {
            "tier_reads": read_first,
            "context_reads": read_next,
            "estimated_turns": template_defaults.get("context_budget", {}).get("estimated_turns", 3),
            "max_new_files": template_defaults.get("context_budget", {}).get("max_new_files", 3),
            "max_modified_files": template_defaults.get("context_budget", {}).get("max_modified_files", 6),
            "budget_primary_tokens": budget.get("primary", {}).get("estimated_tokens", 0),
            "budget_total_tokens": budget.get("total_estimated_tokens", 0),
        },
        "template_id": template.get("id", ""),
        "planning_mode": "",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
    }
    return sanitize_packet(packet)


def build_promotion_report(goal: str, current_wp: dict) -> tuple[dict, dict]:
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    adapter_registry = load_yaml(ADAPTER_REGISTRY_PATH)
    compatibility_catalog = load_yaml(ADAPTER_COMPATIBILITY_PATH)
    context_bundle = build_bundle(goal, current_wp, routing_catalog, constraints)
    fit_report = build_fit_report(goal, current_wp, routing_catalog, constraints, adapter_registry, compatibility_catalog)
    replay_packet = build_replay_packet(current_wp)
    template = load_execution_template(goal)
    promoted_packet = build_promoted_packet(goal, current_wp, context_bundle, fit_report, replay_packet, template)
    primary_tokens = context_bundle.get("budget", {}).get("primary", {}).get("estimated_tokens", 0)
    secondary_tokens = context_bundle.get("budget", {}).get("secondary", {}).get("estimated_tokens", 0)
    locked_total_tokens = primary_tokens + secondary_tokens
    promotion_ready = primary_tokens <= 6000 and locked_total_tokens <= 18000 and bool(promoted_packet.get("scope_out"))

    report = {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "promotion_ready": promotion_ready,
        "fit_counts": fit_report.get("counts", {}),
        "current_wp": {
            "id": current_wp.get("id", ""),
            "status": current_wp.get("status", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
        },
        "promoted_packet": promoted_packet,
        "context_budget": context_bundle.get("budget", {}),
        "locked_context_budget": {
            "primary_estimated_tokens": primary_tokens,
            "secondary_estimated_tokens": secondary_tokens,
            "locked_total_estimated_tokens": locked_total_tokens,
        },
        "replay_goal": replay_packet.get("goal", ""),
        "commands": {
            "fit_report_json": f"python3 scripts/check_planning_fit.py --goal {goal} --json",
            "context_lock_json": f"python3 scripts/export_context_lock.py --goal {goal} --json",
            "promote_json": f"python3 scripts/promote_packet.py --goal {goal} --json",
            "promote_apply_json": f"python3 scripts/promote_packet.py --goal {goal} --apply --json",
        },
        "guardrails": dedupe_strings([
            "primary/secondary lock manifest가 예산 안에 있을 때만 apply한다",
            "deferred read는 승격 판정에서 제외하고 primary/secondary lock manifest만 본다",
            *list(context_bundle.get("core_guardrails", [])),
            *list(current_wp.get("scope_out", [])),
        ]),
    }
    return report, promoted_packet


def render_output(payload: dict, as_json: bool) -> str:
    if as_json:
        return json.dumps(payload, indent=2, ensure_ascii=False)
    return yaml.dump(payload, allow_unicode=True, default_flow_style=False, sort_keys=False)


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    next_actions_path = Path(args.next_actions_path).resolve()
    goal = infer_goal_from_current_wp(current_wp, args.goal)
    report, promoted_packet = build_promotion_report(goal, current_wp)

    if args.output:
        output_path = Path(args.output).resolve()
        rendered_packet = render_output(promoted_packet, output_path.suffix.lower() == ".json")
        output_path.write_text(rendered_packet, encoding="utf-8")
        report["output_packet_path"] = str(output_path)

    if args.apply:
        if not report["promotion_ready"]:
            report["result"] = "blocked"
            report["reason"] = "fit report contains risk"
        else:
            save_yaml(Path(args.current_wp_path).resolve(), promoted_packet)
            next_actions_after = update_next_actions(load_yaml(next_actions_path), promoted_packet)
            save_yaml(next_actions_path, next_actions_after)
            report["result"] = "applied"
            report["next_actions_next_wp"] = next_actions_after.get("next_wp")
    else:
        report["result"] = "dry-run"

    print(render_output(report, args.json))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
