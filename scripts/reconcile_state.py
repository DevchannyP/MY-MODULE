#!/usr/bin/env python3
"""
State Reconciler — Kubernetes-style desired vs actual capability reconciliation.

Compares current-state.yaml desired_state against working_capabilities,
checks wp-queue.yaml coverage, and optionally appends missing WPs.

Inspired by: Kubernetes controller reconciliation loop (desired spec → actual status),
             GitOps (state declared in git, agent reconciles), Argo CD sync.

Usage:
  python3 scripts/reconcile_state.py           # dry-run reconciliation report
  python3 scripts/reconcile_state.py --json    # machine-readable output
  python3 scripts/reconcile_state.py --apply   # append uncovered WPs to wp-queue.yaml
  python3 scripts/reconcile_state.py --strict  # exit 1 if any uncovered gap
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "memory" / "current-state.yaml"
QUEUE_FILE = ROOT / "memory" / "wp-queue.yaml"

# Map desired capability IDs to the CAP group they belong to in wp-queue.yaml
CAPABILITY_CAP_GROUP: dict[str, str] = {
    "dag-wp-scheduler": "CAP-08",
    "requirements-gap-detector": "CAP-08",
    "session-health-metrics": "CAP-08",
    "release-evidence-automation": "CAP-09",
    "video-domain-stage-a": "CAP-07",
    "billing-domain-contracts": "CAP-10",
    "cross-domain-event-bus": "CAP-10",
    "self-improvement-loop": "CAP-11",
    "deployment-environment-smoke-runner": "CAP-12",
    "deployment-environment-binding": "CAP-14",
    "deployment-environment-provisioning-audit": "CAP-15",
}


def load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def working_ids(state: dict) -> set[str]:
    return {c["id"] for c in state.get("working_capabilities", []) if "id" in c}


def all_wps(queue: dict) -> list[dict]:
    wps: list[dict] = []
    for cap in queue.get("capabilities", []):
        for wp in cap.get("work_packets", []):
            wp = dict(wp)
            wp["_cap_id"] = cap.get("id", "")
            wps.append(wp)
    return wps


def find_covering_wp(cap_id: str, description: str, wps: list[dict]) -> dict | None:
    """
    Find a WP that covers this capability.
    Priority:
      1. Explicit `covers_capability: cap_id` field (most reliable)
      2. English keyword match on goal (fallback)
    """
    # 1. Explicit coverage declaration
    for wp in wps:
        covers = wp.get("covers_capability")
        if isinstance(covers, str) and covers == cap_id:
            return wp
        if isinstance(covers, list) and cap_id in covers:
            return wp

    # 2. English keyword fallback (only reliable for English goals)
    kw = [k for k in cap_id.replace("-", " ").lower().split() if len(k) > 3]
    for wp in wps:
        goal_lower = wp.get("goal", "").lower()
        if kw and all(k in goal_lower for k in kw):
            return wp

    return None


def reconcile(state: dict, queue: dict) -> list[dict]:
    """
    Returns a list of reconciliation records:
      status: "satisfied" | "scheduled" | "uncovered"
    """
    desired = state.get("desired_state", {})
    working = working_ids(state)
    wps = all_wps(queue)

    records: list[dict] = []
    for cap_id, description in desired.items():
        if cap_id in working:
            records.append({
                "capability": cap_id,
                "status": "satisfied",
                "description": description,
                "action": None,
            })
            continue

        covering = find_covering_wp(cap_id, description, wps)
        if covering:
            records.append({
                "capability": cap_id,
                "status": "scheduled",
                "description": description,
                "wp_id": covering["id"],
                "wp_status": covering.get("status"),
                "action": None,
            })
        else:
            records.append({
                "capability": cap_id,
                "status": "uncovered",
                "description": description,
                "action": "generate_wp",
            })

    return records


def generate_wp_for_cap(cap_id: str, description: str) -> dict:
    today = date.today().isoformat()
    cap_group = CAPABILITY_CAP_GROUP.get(cap_id, "CAP-XX")
    return {
        "id": f"WP-{today}-RECON-{cap_id[:8].upper()}",
        "goal": f"{cap_id} 구현 — {description}",
        "status": "pending",
        "tier": "domain",
        "depends_on": [],
        "context_budget": {
            "tier_reads": ["memory/checkpoint.yaml", "memory/current-state.yaml"],
            "context_reads": ["requirements/requirements.yaml", "memory/wp-queue.yaml"],
            "estimated_turns": 3,
            "max_new_files": 3,
            "max_modified_files": 4,
        },
        "source": "reconcile_auto",
        "covers_capability": cap_id,
        "_target_cap_group": cap_group,
    }


def apply_to_queue(new_wps: list[dict], queue: dict, queue_path: Path) -> int:
    """Append new WPs into their target CAP group. Returns count appended."""
    appended = 0
    for wp in new_wps:
        target = wp.pop("_target_cap_group", None)
        for cap in queue.get("capabilities", []):
            if cap.get("id") == target:
                cap.setdefault("work_packets", []).append(wp)
                appended += 1
                break
        else:
            # Fallback: append to last capability
            queue["capabilities"][-1].setdefault("work_packets", []).append(wp)
            appended += 1

    with open(queue_path, "w", encoding="utf-8") as f:
        yaml.dump(queue, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    return appended


def main() -> None:
    as_json = "--json" in sys.argv
    do_apply = "--apply" in sys.argv
    strict = "--strict" in sys.argv

    state = load_yaml(STATE_FILE)
    queue = load_yaml(QUEUE_FILE)

    records = reconcile(state, queue)

    satisfied = [r for r in records if r["status"] == "satisfied"]
    scheduled = [r for r in records if r["status"] == "scheduled"]
    uncovered = [r for r in records if r["status"] == "uncovered"]

    new_wps: list[dict] = []
    if uncovered:
        new_wps = [
            generate_wp_for_cap(r["capability"], r["description"])
            for r in uncovered
        ]

    if do_apply and new_wps:
        # Re-load queue to get mutable copy for writing
        queue_mutable = load_yaml(QUEUE_FILE)
        count = apply_to_queue([dict(wp) for wp in new_wps], queue_mutable, QUEUE_FILE)
        apply_note = f"Appended {count} WP(s) to wp-queue.yaml"
    else:
        apply_note = None

    if as_json:
        print(json.dumps({
            "satisfied": len(satisfied),
            "scheduled": len(scheduled),
            "uncovered": len(uncovered),
            "records": records,
            "generated_wps": [
                {k: v for k, v in wp.items() if not k.startswith("_")}
                for wp in new_wps
            ],
            "apply_note": apply_note,
        }, indent=2, ensure_ascii=False))
        if strict and uncovered:
            sys.exit(1)
        return

    W = 62
    print(f"\n{'='*W}")
    print(f"  State Reconciler  [Kubernetes-Style]")
    print(f"{'='*W}")
    print(f"  Satisfied : {len(satisfied)}  |  Scheduled : {len(scheduled)}  |  Uncovered : {len(uncovered)}")
    print()

    if satisfied:
        print(f"  SATISFIED ({len(satisfied)}):")
        for r in satisfied:
            print(f"    ✓ {r['capability']}")
        print()

    if scheduled:
        print(f"  SCHEDULED — WP exists, not yet complete ({len(scheduled)}):")
        for r in scheduled:
            status = r.get("wp_status", "?")
            print(f"    ⏳ {r['capability']}")
            print(f"       WP: {r.get('wp_id')}  [{status}]")
        print()

    if uncovered:
        print(f"  UNCOVERED — no WP covers these ({len(uncovered)}):")
        for r in uncovered:
            print(f"    ✗ {r['capability']}")
            print(f"      {r['description']}")
        print()
        if new_wps:
            print(f"  Run with --apply to auto-insert {len(new_wps)} skeleton WP(s).")
            if not do_apply:
                print(f"  Preview of generated WP IDs:")
                for wp in new_wps:
                    print(f"    → {wp['id']}  [{wp['tier']}]")
            print()

    if apply_note:
        print(f"  ✓ {apply_note}")
        print()

    drift = len(scheduled) + len(uncovered)
    if drift == 0:
        print(f"  ✓ State fully reconciled. No drift detected.")
    else:
        print(f"  {drift} capability gap(s) remain until full reconciliation.")

    print(f"{'='*W}\n")

    if strict and uncovered:
        sys.exit(1)


if __name__ == "__main__":
    main()
