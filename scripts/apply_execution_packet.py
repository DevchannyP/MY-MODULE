#!/usr/bin/env python3
"""
Apply an exported execution packet draft to memory/current-wp.yaml.

Usage:
  python3 scripts/apply_execution_packet.py --input packet.yaml
  python3 scripts/apply_execution_packet.py --input packet.json --apply
  python3 scripts/apply_execution_packet.py --input packet.yaml --json
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, date, datetime
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CURRENT_WP = ROOT / "memory" / "current-wp.yaml"
DEFAULT_NEXT_ACTIONS = ROOT / "memory" / "next-actions.yaml"

ALLOWED_TYPE_VALUES = {"planning", "policy", "domain", "shell", "executor", "governance", "arch", "infra", "meta"}
ALLOWED_STAGE_VALUES = {"A", "B", "C", "D", "E"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply execution packet draft to memory/current-wp.yaml")
    parser.add_argument("--input", required=True, help="Path to exported execution packet YAML/JSON")
    parser.add_argument("--apply", action="store_true", help="Write to memory/current-wp.yaml and next-actions.yaml")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON report")
    parser.add_argument("--current-wp-path", default=str(DEFAULT_CURRENT_WP), help="Override current-wp target path")
    parser.add_argument("--next-actions-path", default=str(DEFAULT_NEXT_ACTIONS), help="Override next-actions target path")
    return parser.parse_args()


def load_structured_file(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        raw = handle.read()
    if path.suffix.lower() == ".json":
        return json.loads(raw)
    return yaml.safe_load(raw) or {}


def save_yaml(path: Path, payload: dict) -> None:
    with path.open("w", encoding="utf-8") as handle:
        yaml.dump(payload, handle, allow_unicode=True, default_flow_style=False, sort_keys=False)


def ensure_list(value) -> list:
    return value if isinstance(value, list) else []


def sanitize_packet(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("execution packet must be an object")

    packet = dict(payload)
    packet_type = packet.get("type", "planning")
    if packet_type not in ALLOWED_TYPE_VALUES:
        raise ValueError(f"invalid packet type: {packet_type}")

    stage = packet.get("stage", "A")
    if stage not in ALLOWED_STAGE_VALUES:
        raise ValueError(f"invalid stage: {stage}")

    packet_id = packet.get("id")
    if not isinstance(packet_id, str) or not packet_id:
        raise ValueError("packet id is required")

    goal = packet.get("goal")
    if not isinstance(goal, str) or not goal.strip():
        raise ValueError("packet goal is required")

    sanitized = {
        "id": packet_id,
        "goal": goal.strip(),
        "type": packet_type,
        "stage": stage,
        "status": packet.get("status") if isinstance(packet.get("status"), str) and packet.get("status") else "in_progress",
        "scope_in": ensure_list(packet.get("scope_in")),
        "scope_out": ensure_list(packet.get("scope_out")),
        "constraints": ensure_list(packet.get("constraints")),
        "done_when": ensure_list(packet.get("done_when")),
        "fail_if": ensure_list(packet.get("fail_if")),
        "rollback": packet.get("rollback", ""),
        "subtasks": ensure_list(packet.get("subtasks")),
        "validation": ensure_list(packet.get("validation")),
        "evidence": ensure_list(packet.get("evidence")),
        "next_unlock": packet.get("next_unlock", ""),
        "contracts": packet.get("contracts", {}) if isinstance(packet.get("contracts", {}), dict) else {},
        "context_budget": packet.get("context_budget", {}) if isinstance(packet.get("context_budget", {}), dict) else {},
        "template_id": packet.get("template_id", ""),
        "planning_mode": packet.get("planning_mode", ""),
        "generated_at": packet.get("generated_at", datetime.now(UTC).isoformat()),
        "applied_at": datetime.now(UTC).isoformat(),
    }
    return sanitized


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def derive_queue_entry(packet: dict) -> dict:
    context_budget = packet.get("context_budget", {}) if isinstance(packet.get("context_budget", {}), dict) else {}
    return {
        "id": packet["id"],
        "goal": packet["goal"],
        "status": "in_progress",
        "tier": packet.get("type", "planning"),
        "depends_on": [],
        "context_budget": context_budget,
    }


def update_next_actions(next_actions: dict, packet: dict) -> dict:
    updated = dict(next_actions)
    updated["as_of"] = date.today().isoformat()
    updated["selection_policy"] = (
        "planner-applied execution packet becomes the active packet while preserving queue-driven scheduling"
    )
    updated["next_wp"] = packet["id"]

    queue = ensure_list(updated.get("queue"))
    replaced = False
    new_queue = []
    for item in queue:
        if isinstance(item, dict) and item.get("id") == packet["id"]:
            new_queue.append(derive_queue_entry(packet))
            replaced = True
        else:
            new_queue.append(item)
    if not replaced:
        new_queue.insert(0, derive_queue_entry(packet))
    updated["queue"] = new_queue
    return updated


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    current_wp_path = Path(args.current_wp_path).resolve()
    next_actions_path = Path(args.next_actions_path).resolve()

    raw_payload = load_structured_file(input_path)
    packet = sanitize_packet(raw_payload)
    next_actions_before = load_yaml(next_actions_path)
    next_actions_after = update_next_actions(next_actions_before, packet)

    report = {
        "input": str(input_path),
        "apply": args.apply,
        "current_wp_path": str(current_wp_path),
        "next_actions_path": str(next_actions_path),
        "packet_id": packet["id"],
        "packet_goal": packet["goal"],
        "context_budget": {
            "tier_reads": len(ensure_list(packet.get("context_budget", {}).get("tier_reads"))),
            "context_reads": len(ensure_list(packet.get("context_budget", {}).get("context_reads"))),
        },
        "next_actions_next_wp": next_actions_after.get("next_wp"),
    }

    if args.apply:
        save_yaml(current_wp_path, packet)
        save_yaml(next_actions_path, next_actions_after)
        report["result"] = "applied"
    else:
        report["result"] = "dry-run"

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    print(f"[apply_execution_packet] {report['result']}")
    print(f"  packet: {packet['id']} — {packet['goal']}")
    print(f"  current-wp: {current_wp_path}")
    print(f"  next-actions next_wp: {next_actions_after.get('next_wp')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
