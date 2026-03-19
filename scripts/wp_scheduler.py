#!/usr/bin/env python3
"""
WP Scheduler — DAG-aware Work Packet execution planner.

Inspired by: Netflix Conductor (typed tasks + DAG), Apache Airflow (dependency resolution),
             GitHub Actions (needs: syntax), Toyota TPS (pull-based, WIP limits).

Usage:
  python3 scripts/wp_scheduler.py            # next ready WPs
  python3 scripts/wp_scheduler.py --all      # full DAG status
  python3 scripts/wp_scheduler.py --json     # machine-readable output
  python3 scripts/wp_scheduler.py --validate # check queue integrity
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
QUEUE_FILE = ROOT / "memory" / "wp-queue.yaml"

# Tier execution order: infra runs first, meta runs last
TIER_ORDER = {"infra": 0, "arch": 1, "governance": 2, "domain": 3, "meta": 4}


def load_queue() -> dict:
    with open(QUEUE_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def collect_all_wps(queue: dict) -> list[dict]:
    """Flatten all WPs from all capability groups, preserving cap metadata."""
    wps: list[dict] = []
    for cap in queue.get("capabilities", []):
        for wp in cap.get("work_packets", []):
            wp = dict(wp)
            wp["_cap_name"] = cap.get("name", "unknown")
            wp["_cap_priority"] = cap.get("priority", 99)
            wps.append(wp)
    return wps


def get_done_ids(wps: list[dict]) -> set[str]:
    return {wp["id"] for wp in wps if wp.get("status") == "done"}


def get_ready_wps(wps: list[dict], done_ids: set[str]) -> list[dict]:
    """Return pending WPs whose entire depends_on set is satisfied."""
    ready = []
    for wp in wps:
        if wp.get("status") != "pending":
            continue
        deps = wp.get("depends_on", [])
        if all(d in done_ids for d in deps):
            ready.append(wp)

    ready.sort(key=lambda w: (
        TIER_ORDER.get(w.get("tier", "domain"), 5),
        w.get("_cap_priority", 99),
    ))
    return ready


def validate_dag(wps: list[dict]) -> list[str]:
    """Detect referential integrity issues in the DAG."""
    errors: list[str] = []
    all_ids = {wp["id"] for wp in wps}
    for wp in wps:
        for dep in wp.get("depends_on", []):
            if dep not in all_ids:
                errors.append(f"{wp['id']} depends on unknown WP: {dep}")
    # Detect cycles (simple DFS)
    index = {wp["id"]: wp for wp in wps}
    visited: set[str] = set()
    in_stack: set[str] = set()

    def has_cycle(node: str) -> bool:
        visited.add(node)
        in_stack.add(node)
        for dep in index.get(node, {}).get("depends_on", []):
            if dep not in visited:
                if has_cycle(dep):
                    return True
            elif dep in in_stack:
                return True
        in_stack.discard(node)
        return False

    for wp in wps:
        if wp["id"] not in visited:
            if has_cycle(wp["id"]):
                errors.append(f"Cycle detected involving: {wp['id']}")
    return errors


def main() -> None:
    show_all = "--all" in sys.argv
    as_json = "--json" in sys.argv
    do_validate = "--validate" in sys.argv

    queue = load_queue()
    all_wps = collect_all_wps(queue)
    done_ids = get_done_ids(all_wps)
    ready = get_ready_wps(all_wps, done_ids)
    blocked = [w for w in all_wps if w.get("status") == "pending" and w not in ready]

    if do_validate:
        errors = validate_dag(all_wps)
        if errors:
            print("DAG INTEGRITY ERRORS:")
            for e in errors:
                print(f"  - {e}")
            sys.exit(1)
        else:
            print("DAG OK — no referential integrity issues.")
            return

    if as_json:
        print(json.dumps({
            "schema_version": "2",
            "total": len(all_wps),
            "done": len(done_ids),
            "ready": [
                {"id": w["id"], "goal": w["goal"], "tier": w.get("tier"),
                 "estimated_turns": w.get("context_budget", {}).get("estimated_turns")}
                for w in ready
            ],
            "blocked": len(blocked),
        }, indent=2, ensure_ascii=False))
        return

    W = 62
    print(f"\n{'='*W}")
    print(f"  WP Scheduler v2  [DAG-Aware]")
    print(f"{'='*W}")
    print(f"  Total   : {len(all_wps)}  |  Done : {len(done_ids)}  |"
          f"  Ready : {len(ready)}  |  Blocked : {len(blocked)}")
    print()

    if ready:
        print("  READY TO EXECUTE (priority order):")
        for i, wp in enumerate(ready, 1):
            budget = wp.get("context_budget", {})
            est = budget.get("estimated_turns", "?")
            tier = wp.get("tier", "—")
            deps = wp.get("depends_on", [])
            print(f"    [{i}] {wp['id']}  [tier:{tier}]  ~{est} turns")
            print(f"         {wp['goal']}")
            if deps:
                print(f"         deps: {deps}")
        print()
    else:
        print("  No WPs ready. Check blocked list with --all.")
        print()

    if show_all and blocked:
        print("  BLOCKED (unmet dependencies):")
        all_done = get_done_ids(all_wps)
        for wp in blocked:
            missing = [d for d in wp.get("depends_on", []) if d not in all_done]
            print(f"    - {wp['id']} ← waiting: {missing}")
        print()

    print(f"  Run:  npm run wp:next     → next ready WP")
    print(f"        npm run wp:gaps     → requirements gap report")
    print(f"        npm run wp:health   → session health metrics")
    print(f"{'='*W}\n")


if __name__ == "__main__":
    main()
