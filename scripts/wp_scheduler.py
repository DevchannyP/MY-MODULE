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
import os
import sys
from pathlib import Path
import hashlib

import yaml

ROOT = Path(__file__).resolve().parent.parent
QUEUE_FILE = ROOT / "memory" / "wp-queue.yaml"
PROMOTION_ARTIFACT_DIR = ROOT / "artifacts" / "promotion-pipeline" / "latest"

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


def estimate_tokens_from_bytes(byte_count: int) -> int:
    # 3 bytes/token: conservative estimate for Korean/English mixed content.
    if byte_count <= 0:
        return 0
    return max(1, round(byte_count / 3))


def collect_path_metric(relative_path: str) -> dict:
    if not relative_path:
        return {"path": "", "file_count": 0, "estimated_tokens": 0}

    target = ROOT / relative_path.rstrip("/")
    if not target.exists():
        return {"path": relative_path, "file_count": 0, "estimated_tokens": 0}

    if target.is_file():
        total_bytes = target.stat().st_size
        return {
            "path": relative_path,
            "file_count": 1,
            "estimated_tokens": estimate_tokens_from_bytes(total_bytes),
        }

    file_count = 0
    total_bytes = 0
    for base, _, files in os.walk(target):
        for file_name in files:
            file_count += 1
            try:
                total_bytes += (Path(base) / file_name).stat().st_size
            except OSError:
                continue
    return {
        "path": relative_path,
        "file_count": file_count,
        "estimated_tokens": estimate_tokens_from_bytes(total_bytes),
    }


def summarize_budget(context_budget: dict) -> dict:
    tier_reads = context_budget.get("tier_reads", []) if isinstance(context_budget, dict) else []
    context_reads = context_budget.get("context_reads", []) if isinstance(context_budget, dict) else []

    def total(paths: list[str]) -> tuple[int, int]:
        files = 0
        tokens = 0
        for metric in (collect_path_metric(path) for path in paths):
            files += metric["file_count"]
            tokens += metric["estimated_tokens"]
        return files, tokens

    tier_files, tier_tokens = total(tier_reads)
    context_files, context_tokens = total(context_reads)
    return {
        "tier_reads_count": len(tier_reads),
        "context_reads_count": len(context_reads),
        "tier_files": tier_files,
        "context_files": context_files,
        "estimated_tokens": tier_tokens + context_tokens,
    }


def load_json_file(path: Path):
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def sha256_for_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize_pipeline_readiness() -> dict:
    pipeline_report = load_json_file(PROMOTION_ARTIFACT_DIR / "pipeline-report.json")
    context_lock = load_json_file(PROMOTION_ARTIFACT_DIR / "context-lock.json")
    locked_files = []
    for tier in ("primary", "secondary"):
        for item in context_lock.get("locked_files", {}).get(tier, []):
            if isinstance(item, dict) and item.get("exists", True):
                locked_files.append(item)

    changed = 0
    missing = 0
    for item in locked_files:
        relative_path = item.get("path", "")
        target = ROOT / relative_path
        if not target.exists():
            missing += 1
            continue
        if sha256_for_file(target) != item.get("sha256", ""):
            changed += 1

    return {
        "available": bool(pipeline_report or context_lock),
        "promotion_ready": bool(pipeline_report.get("promotion_ready")),
        "locked_tokens": int((pipeline_report.get("locked_context_budget") or {}).get("locked_total_estimated_tokens", 0)),
        "locked_files": len(locked_files),
        "drift_status": "drifted" if changed or missing else "clean",
        "changed_files": changed,
        "missing_files": missing,
    }


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
        readiness = summarize_pipeline_readiness()
        print(json.dumps({
            "schema_version": "2",
            "total": len(all_wps),
            "done": len(done_ids),
            "promotion_pipeline": readiness,
            "ready": [
                {"id": w["id"], "goal": w["goal"], "tier": w.get("tier"),
                 "estimated_turns": w.get("context_budget", {}).get("estimated_turns"),
                 "tier_reads": w.get("context_budget", {}).get("tier_reads", []),
                 "context_reads": w.get("context_budget", {}).get("context_reads", []),
                 **summarize_budget(w.get("context_budget", {}))}
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
    readiness = summarize_pipeline_readiness()
    if readiness["available"]:
        print("  PROMOTION READINESS:")
        print(
            f"    ready={str(readiness['promotion_ready']).lower()} | drift={readiness['drift_status']}"
            f" | locked files {readiness['locked_files']} | locked tokens {readiness['locked_tokens']}"
        )
        if readiness["changed_files"] or readiness["missing_files"]:
            print(
                f"    changed {readiness['changed_files']} | missing {readiness['missing_files']}"
                "  → context-drift 우선 확인"
            )
        print()

    if ready:
        print("  READY TO EXECUTE (priority order):")
        for i, wp in enumerate(ready, 1):
            budget = wp.get("context_budget", {})
            est = budget.get("estimated_turns", "?")
            tier = wp.get("tier", "—")
            deps = wp.get("depends_on", [])
            tier_reads = budget.get("tier_reads", [])
            context_reads = budget.get("context_reads", [])
            budget_summary = summarize_budget(budget)
            print(f"    [{i}] {wp['id']}  [tier:{tier}]  ~{est} turns")
            print(f"         {wp['goal']}")
            if tier_reads or context_reads:
                print(
                    f"         reads: tier {len(tier_reads)} / context {len(context_reads)}"
                    f" | est tokens {budget_summary['estimated_tokens']}"
                    f"{' | first tier: ' + ', '.join(tier_reads[:2]) if tier_reads else ''}"
                )
                if readiness["available"]:
                    print(
                        f"         promotion: {'ready' if readiness['promotion_ready'] else 'review'}"
                        f" | drift {readiness['drift_status']} | locked {readiness['locked_tokens']} tok"
                    )
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
