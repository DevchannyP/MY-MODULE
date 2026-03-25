#!/usr/bin/env python3
"""
Generate a capability-scoped packet hierarchy lens for the current or selected packet.

Usage:
  python3 scripts/generate_packet_hierarchy.py --json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import yaml

from export_context_bundle import CURRENT_WP_PATH, load_yaml
from wp_scheduler import QUEUE_FILE, collect_all_wps, get_done_ids


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Workflow OS packet hierarchy lens")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of YAML")
    parser.add_argument("--current-wp-path", default=str(CURRENT_WP_PATH))
    parser.add_argument("--wp-id", help="Optional explicit work packet id")
    return parser.parse_args()


def build_packet_hierarchy(current_wp_id: str, queue: dict) -> dict:
    all_wps = collect_all_wps(queue)
    wp_index = {wp.get("id"): wp for wp in all_wps}
    done_ids = get_done_ids(all_wps)
    current = wp_index.get(current_wp_id, {})
    cap_name = current.get("_cap_name", "unknown")
    cap_priority = current.get("_cap_priority", 99)
    cap_wps = [wp for wp in all_wps if wp.get("_cap_name") == cap_name and wp.get("_cap_priority") == cap_priority]

    ready_in_cap = []
    blocked_in_cap = []
    for wp in cap_wps:
        if wp.get("status") != "pending":
            continue
        unmet = [dependency for dependency in wp.get("depends_on", []) if dependency not in done_ids]
        target = {
            "id": wp.get("id", ""),
            "goal": wp.get("goal", ""),
            "tier": wp.get("tier", ""),
            "unmet_dependencies": unmet,
        }
        if unmet:
            blocked_in_cap.append(target)
        else:
            ready_in_cap.append(target)

    downstream = [
        {
            "id": wp.get("id", ""),
            "status": wp.get("status", ""),
            "goal": wp.get("goal", ""),
        }
        for wp in all_wps
        if current_wp_id in (wp.get("depends_on") or [])
    ]

    return {
        "schema_version": "1",
        "current_wp_id": current_wp_id,
        "capability": {
            "name": cap_name,
            "priority": cap_priority,
            "total_packets": len(cap_wps),
            "done_packets": sum(1 for wp in cap_wps if wp.get("status") == "done"),
            "pending_packets": sum(1 for wp in cap_wps if wp.get("status") == "pending"),
        },
        "current_packet": {
            "goal": current.get("goal", ""),
            "status": current.get("status", ""),
            "tier": current.get("tier", ""),
            "depends_on": current.get("depends_on", []),
        },
        "ready_in_capability": ready_in_cap,
        "blocked_in_capability": blocked_in_cap,
        "downstream_packets": downstream,
        "learning_path": [
            {
                "id": wp.get("id", ""),
                "status": wp.get("status", ""),
                "tier": wp.get("tier", ""),
                "goal": wp.get("goal", ""),
            }
            for wp in cap_wps
        ],
        "commands": {
            "packet_hierarchy_json": "python3 scripts/generate_packet_hierarchy.py --json",
            "wp_status": "python3 scripts/wp_scheduler.py --all",
        },
    }


def main() -> None:
    args = parse_args()
    current_wp = load_yaml(Path(args.current_wp_path).resolve())
    queue = load_yaml(Path(QUEUE_FILE).resolve())
    target_id = args.wp_id or current_wp.get("id", "")
    hierarchy = build_packet_hierarchy(target_id, queue)

    if args.json:
        print(json.dumps(hierarchy, indent=2, ensure_ascii=False))
        return

    print(yaml.dump(hierarchy, allow_unicode=True, default_flow_style=False, sort_keys=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
