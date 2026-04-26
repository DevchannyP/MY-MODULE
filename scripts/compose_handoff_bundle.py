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
VALIDATION_PROFILES_PATH = ROOT / "requirements" / "validation-profiles.yaml"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compose Workflow OS handoff bundle")
    parser.add_argument("--goal", choices=sorted(GOAL_TO_ARCH_PROFILE.keys()), default=None)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--output", help="Optional output file")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    return parser.parse_args()


def ensure_list(value) -> list:
    return value if isinstance(value, list) else []


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value.strip():
            continue
        normalized = value.strip()
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def normalize_packet_type(packet_type: str, aliases: dict) -> dict:
    requested = str(packet_type or "planning").strip().lower() or "planning"
    canonical = str(aliases.get(requested, requested)).strip().lower() or "planning"
    return {
        "requested": requested,
        "canonical": canonical,
        "used_alias": requested != canonical,
    }


def build_handoff_contract(profile_doc: dict) -> dict:
    contract = profile_doc.get("handoff_contract") if isinstance(profile_doc.get("handoff_contract"), dict) else {}
    return {
        "schema_version": str(contract.get("schema_version") or "1"),
        "required_fields": ensure_list(contract.get("required_fields")),
        "merge_order": ensure_list(contract.get("merge_order")),
        "pass_criteria_default": str(contract.get("pass_criteria_default") or "exit code 0"),
        "notes": ensure_list(contract.get("notes")),
    }


def build_validation_profile(current_wp: dict) -> dict:
    profile_doc = load_yaml(VALIDATION_PROFILES_PATH)
    handoff_contract = build_handoff_contract(profile_doc)
    pass_criteria = handoff_contract.get("pass_criteria_default") or "exit code 0"
    normalized = normalize_packet_type(current_wp.get("type", "planning"), profile_doc.get("aliases", {}))
    stage = str(current_wp.get("stage", "")).strip().upper()
    profiles = profile_doc.get("profiles", {}) if isinstance(profile_doc.get("profiles", {}), dict) else {}
    profile = profiles.get(normalized["canonical"], profiles.get("planning", {}))
    defaults = ensure_list((profile_doc.get("defaults") or {}).get("commands"))
    profile_commands = ensure_list(profile.get("commands"))
    stage_adds = ensure_list(((profile_doc.get("stage_overrides") or {}).get(stage) or {}).get("add"))
    packet_commands = ensure_list(current_wp.get("validation"))
    commands = dedupe_strings([*defaults, *profile_commands, *stage_adds, *packet_commands])
    return {
        "path": str(VALIDATION_PROFILES_PATH.relative_to(ROOT)),
        "requested_packet_type": normalized["requested"],
        "packet_type": normalized["canonical"],
        "resolved_from_alias": normalized["used_alias"],
        "stage": stage,
        "description": str(profile.get("description") or (profile_doc.get("defaults") or {}).get("description") or ""),
        "focus_tags": ensure_list(profile.get("focus_tags")),
        "success_criteria": ensure_list(profile.get("success_criteria")),
        "commands": commands,
        "required": [
            {
                "command": command,
                "pass_criteria": pass_criteria,
            }
            for command in commands
        ],
        "optional": [],
        "handoff_contract": handoff_contract,
        "source_breakdown": {
            "defaults": defaults,
            "profile": profile_commands,
            "stage_overrides": stage_adds,
            "packet_validation": packet_commands,
        },
    }


def build_intake_packet(current_wp: dict, validation_profile: dict) -> dict:
    return {
        "goal": current_wp.get("goal", ""),
        "context": dedupe_strings([
            *ensure_list((current_wp.get("context_budget") or {}).get("tier_reads")),
            *ensure_list((current_wp.get("context_budget") or {}).get("context_reads")),
        ]),
        "constraints": ensure_list(current_wp.get("constraints")),
        "done_when": ensure_list(current_wp.get("done_when") or current_wp.get("success_criteria")),
        "work_mode": [
            "먼저 현재 packet과 context drift를 확인한다",
            "change point를 scope_in 내부로 제한한다",
            "작은 change set 뒤 validation_profile.required를 실행한다",
        ],
        "verification": ensure_list(current_wp.get("verification")) or validation_profile.get("commands", []),
    }


def build_scope(current_wp: dict, context_bundle: dict) -> dict:
    return {
        "scope_in": ensure_list(current_wp.get("scope_in")),
        "scope_out": ensure_list(current_wp.get("scope_out")),
        "protected_core": ensure_list(context_bundle.get("protected_core")),
        "core_guardrails": ensure_list(context_bundle.get("core_guardrails")),
        "context_budget": current_wp.get("context_budget", {}),
    }


def build_next_action(current_wp: dict, replay_packet: dict) -> dict:
    return {
        "next_unlock": current_wp.get("next_unlock", ""),
        "replay_goal": replay_packet.get("goal", ""),
        "replay_type": replay_packet.get("type", ""),
        "replay_stage": replay_packet.get("stage", ""),
        "read_first": ensure_list(replay_packet.get("read_first")),
        "validation": ensure_list(replay_packet.get("validation")),
    }


def build_handoff_bundle(goal: str, current_wp: dict) -> dict:
    routing_catalog = load_yaml(ROUTING_PATH)
    constraints = load_yaml(CONSTRAINTS_PATH)
    adapter_registry = load_yaml(ADAPTER_REGISTRY_PATH)
    compatibility_catalog = load_yaml(ADAPTER_COMPATIBILITY_PATH)
    context_bundle = build_bundle(goal, current_wp, routing_catalog, constraints)
    fit_report = build_fit_report(goal, current_wp, routing_catalog, constraints, adapter_registry, compatibility_catalog)
    replay_packet = build_replay_packet(current_wp)
    validation_profile = build_validation_profile(current_wp)
    return {
        "schema_version": "1",
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "goal": goal,
        "intake_packet": build_intake_packet(current_wp, validation_profile),
        "current_packet": {
            "id": current_wp.get("id", ""),
            "goal": current_wp.get("goal", ""),
            "type": current_wp.get("type", ""),
            "stage": current_wp.get("stage", ""),
            "status": current_wp.get("status", ""),
        },
        "scope": build_scope(current_wp, context_bundle),
        "context_bundle": context_bundle,
        "fit_report": fit_report,
        "validation_profile": validation_profile,
        "rollback_plan": current_wp.get("rollback_plan", ""),
        "next_action": build_next_action(current_wp, replay_packet),
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
