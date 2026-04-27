#!/usr/bin/env python3
"""
Session Health Metrics — DORA-inspired performance indicators for Workflow OS.

Inspired by: DORA 4 Key Metrics (Forsgren et al., Accelerate),
             Google SRE Error Budget, SPACE framework (developer productivity).

DORA Proxies mapped to WP lifecycle:
  - Deployment Frequency  → WPs completed per session
  - Change Failure Rate   → partial/failed WPs / total WPs
  - Lead Time             → WPs blocked vs WPs immediately ready
  - MTTR                  → corrective WPs triggered by failed gates

Usage:
  python3 scripts/session_metrics.py          # text report
  python3 scripts/session_metrics.py --json   # machine-readable
  python3 scripts/session_metrics.py --trend  # multi-session breakdown
"""

from __future__ import annotations

import json
import sys
import glob
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_worklogs() -> list[dict]:
    wls: list[dict] = []
    for path in sorted(glob.glob(str(ROOT / "worklog" / "*.yaml"))):
        try:
            data = load_yaml(Path(path))
            if data:
                wls.append(data)
        except Exception:
            pass
    return wls


def load_checkpoint() -> dict:
    p = ROOT / "memory" / "checkpoint.yaml"
    return load_yaml(p) if p.exists() else {}


def session_date_from_id(wp_id: str) -> str:
    """Extract YYYY-MM-DD from WP-YYYY-MM-DD-NN format."""
    parts = wp_id.split("-")
    if len(parts) >= 4:
        return "-".join(parts[1:4])
    return "unknown"


def compute_metrics(wls: list[dict], checkpoint: dict) -> dict:
    if not wls:
        return {"error": "no worklogs found", "total_wps": 0}

    total_wps = len(wls)
    completed = sum(1 for w in wls if w.get("completed") is True)
    partial = total_wps - completed

    # Gate pass rate from checkpoint verification_summary
    ver = checkpoint.get("verification_summary", {})
    total_gates = ver.get("total_commands_run", 0)
    passed_gates = ver.get("passed", 0)
    failed_gates = ver.get("failed", 0)
    gate_pass_rate = (passed_gates / total_gates * 100) if total_gates else 0.0

    # File change volume
    total_created = sum(
        len(w.get("files_created", [])) for w in wls
        if isinstance(w.get("files_created"), list)
    )
    total_modified = sum(
        len(w.get("files_modified", [])) for w in wls
        if isinstance(w.get("files_modified"), list)
    )
    avg_files_per_wp = (total_created + total_modified) / total_wps

    # Session grouping
    session_wps: dict[str, list] = defaultdict(list)
    for w in wls:
        sid = session_date_from_id(w.get("wp_id", ""))
        session_wps[sid].append(w)

    sessions = len(session_wps)
    avg_wps_per_session = total_wps / max(sessions, 1)

    # Corrective WP detection (goals containing "fix", "correct", "rollback")
    corrective_keywords = ("fix", "correct", "rollback", "revert", "hot", "patch")
    corrective_wps = sum(
        1 for w in wls
        if any(kw in w.get("goal", "").lower() for kw in corrective_keywords)
    )

    return {
        "schema_version": "2",
        "total_wps": total_wps,
        "completed_wps": completed,
        "partial_wps": partial,
        "change_failure_rate_pct": round(partial / total_wps * 100, 1),
        "total_gate_runs": total_gates,
        "passed_gates": passed_gates,
        "failed_gates": failed_gates,
        "gate_pass_rate_pct": round(gate_pass_rate, 1),
        "total_files_created": total_created,
        "total_files_modified": total_modified,
        "avg_files_per_wp": round(avg_files_per_wp, 1),
        "sessions_tracked": sessions,
        "avg_wps_per_session": round(avg_wps_per_session, 1),
        "corrective_wps": corrective_wps,
        "session_breakdown": {
            sid: len(wps) for sid, wps in session_wps.items()
        },
    }


def health_rating(m: dict) -> tuple[str, list[str]]:
    """Rate overall health ELITE/HIGH/MEDIUM/LOW with actionable notes."""
    score = 0
    notes: list[str] = []

    gpr = m.get("gate_pass_rate_pct", 0)
    if gpr >= 95:
        score += 3
    elif gpr >= 85:
        score += 2
        notes.append(f"gate pass rate {gpr}% — target 95%")
    elif gpr >= 70:
        score += 1
        notes.append(f"gate pass rate {gpr}% — investigate failing gates")
    else:
        notes.append(f"gate pass rate {gpr}% — CRITICAL, stop new features")

    cfr = m.get("change_failure_rate_pct", 100)
    if cfr <= 5:
        score += 3
    elif cfr <= 15:
        score += 2
    elif cfr <= 30:
        score += 1
        notes.append(f"change failure rate {cfr}% — improve done_when definitions")
    else:
        notes.append(f"change failure rate {cfr}% — tighten WP scoping")

    wps_s = m.get("avg_wps_per_session", 0)
    if wps_s >= 6:
        score += 2
    elif wps_s >= 3:
        score += 1
    else:
        notes.append(f"avg {wps_s} WPs/session — decompose WPs smaller")

    if score >= 7:
        return "ELITE", notes
    if score >= 5:
        return "HIGH", notes
    if score >= 3:
        return "MEDIUM", notes
    return "LOW", notes


def main() -> None:
    as_json = "--json" in sys.argv
    show_trend = "--trend" in sys.argv

    wls = load_worklogs()
    checkpoint = load_checkpoint()
    metrics = compute_metrics(wls, checkpoint)
    rating, notes = health_rating(metrics)

    if as_json:
        metrics["health_rating"] = rating
        metrics["improvement_notes"] = notes
        print(json.dumps(metrics, indent=2, ensure_ascii=False))
        return

    W = 62
    print(f"\n{'='*W}")
    print(f"  Session Health Metrics  [DORA-Inspired]")
    print(f"{'='*W}")
    print(f"  Health Rating     : {rating}")
    print()

    if "error" in metrics:
        print(f"  {metrics['error']}")
        return

    print(f"  WP Throughput  (Deployment Frequency proxy)")
    print(f"    Total WPs         : {metrics['total_wps']}")
    print(f"    Completed         : {metrics['completed_wps']}")
    print(f"    Partial/Failed    : {metrics['partial_wps']}")
    print(f"    Avg WPs/Session   : {metrics['avg_wps_per_session']}")
    print(f"    Sessions Tracked  : {metrics['sessions_tracked']}")
    print()

    print(f"  Change Failure Rate")
    print(f"    Rate              : {metrics['change_failure_rate_pct']}%  (target: ≤15%)")
    print(f"    Corrective WPs    : {metrics['corrective_wps']}")
    print()

    print(f"  Quality Gate Health")
    print(f"    Total Gate Runs   : {metrics['total_gate_runs']}")
    print(f"    Passed            : {metrics['passed_gates']}")
    print(f"    Failed            : {metrics['failed_gates']}")
    print(f"    Pass Rate         : {metrics['gate_pass_rate_pct']}%  (target: ≥95%)")
    print()

    print(f"  File Change Volume")
    print(f"    Files Created     : {metrics['total_files_created']}")
    print(f"    Files Modified    : {metrics['total_files_modified']}")
    print(f"    Avg Files/WP      : {metrics['avg_files_per_wp']}  (target: ≤8)")
    print()

    if notes:
        print(f"  Improvement Notes:")
        for note in notes:
            print(f"    · {note}")
        print()

    if show_trend and "session_breakdown" in metrics:
        print(f"  Session Breakdown:")
        for sid, count in sorted(metrics["session_breakdown"].items()):
            print(f"    {sid}: {count} WPs")
        print()

    print(f"{'='*W}\n")


if __name__ == "__main__":
    main()
